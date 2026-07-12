/**
 * Ollama backend for Quenta — one implementation of the `QuentaRuntime` interface.
 *
 * Every call goes through the Rust bridge rather than `fetch`. That is deliberate: the backend owns
 * the request, so a chat **survives the UI**. The user can navigate away, or close the panel, while
 * a model is still generating; the request keeps running in Rust, and `chatStatus` lets the UI
 * reattach to it afterwards and recover the partial text — hence the explicit request lifecycle
 * (`chat` → `chatStatus` → `cancelChat` / `forgetChat`) instead of a single fire-and-forget promise.
 *
 * Ollama's wire format is snake_case; `LiatirQuentaProviderModel` and friends are camelCase. The
 * normalisation happens here, at the boundary, so nothing above this file has to know or care.
 */
import { liatir } from '$lib/api';
import { Channel } from '@tauri-apps/api/core';
import type {
  LiatirQuentaChatRequest,
  LiatirQuentaChatRequestSnapshot,
  LiatirQuentaChatResponse,
  LiatirQuentaProviderModel,
  LiatirQuentaProviderStatus,
  LiatirQuentaStreamEvent,
} from '@liatir/core';
import type { QuentaRuntime } from './runtime';

/** Ollama's own model shape, as it comes off the wire. Mapped in `normalizeModels`. */

interface OllamaModel {
  name?: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export class OllamaQuentaRuntime implements QuentaRuntime {
  constructor(private readonly baseUrl: string) {}

  private api() {
    const api = liatir();
    if (!api) throw new Error('The Liatir native bridge is unavailable');
    return api;
  }

  /**
   * Is Ollama running and reachable? A failure is *not* thrown — it is the expected answer when the
   * user simply has not started Ollama, and the UI needs to say so rather than surface an error.
   */
  async status(): Promise<LiatirQuentaProviderStatus> {
    try {
      const response = await this.api().invoke('lia_quenta_ollama_status', {
        baseUrl: this.baseUrl,
      }) as { version?: string };
      return { available: true, version: response.version };
    } catch (error) {
      return { available: false, error: String(error) };
    }
  }

  async models(): Promise<LiatirQuentaProviderModel[]> {
    const response = await this.api().invoke('lia_quenta_ollama_models', {
      baseUrl: this.baseUrl,
    }) as { models?: OllamaModel[] };
    return this.normalizeModels(response.models ?? []);
  }

  /**
   * One round trip that gets Quenta usable: check Ollama is up, pull the model if it is missing, and
   * list what is available. Bundled into a single backend call because the model pull can take
   * minutes, and doing it as three separate round trips would leave the UI guessing about the state
   * in between.
   *
   * `downloaded` reports whether a pull actually happened, so the UI can explain the wait.
   */
  async bootstrap(model: string): Promise<{
    status: LiatirQuentaProviderStatus;
    models: LiatirQuentaProviderModel[];
    model: string;
    downloaded: boolean;
  }> {
    const response = await this.api().invoke('lia_quenta_ollama_bootstrap', {
      baseUrl: this.baseUrl,
      model,
    }) as {
      available?: boolean;
      version?: string;
      model?: string;
      downloaded?: boolean;
      models?: OllamaModel[];
    };
    return {
      status: { available: Boolean(response.available), version: response.version },
      models: this.normalizeModels(response.models ?? []),
      model: response.model ?? model,
      downloaded: Boolean(response.downloaded),
    };
  }

  /** Maps Ollama's snake_case fields onto the shared camelCase contract. */
  private normalizeModels(models: OllamaModel[]): LiatirQuentaProviderModel[] {
    return models.map((model) => ({
      // Ollama has used both `name` and `model` for this across versions; accept either.
      name: model.name ?? model.model ?? 'unknown',
      modifiedAt: model.modified_at,
      sizeBytes: model.size,
      digest: model.digest,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantization: model.details?.quantization_level,
    }));
  }

  /**
   * Sends a chat request and resolves with the complete answer, streaming tokens via `onEvent`.
   *
   * `requestId` is supplied by the *caller*, not generated here — that is what lets the UI look the
   * request up again with `chatStatus` after a remount, or cancel it, without having had to hold on
   * to this promise.
   */
  async chat(
    request: LiatirQuentaChatRequest,
    requestId: string,
    onEvent?: (event: LiatirQuentaStreamEvent) => void,
  ): Promise<LiatirQuentaChatResponse> {
    // A Tauri Channel carries the token stream from Rust as it arrives. Only delta events with an
    // actual string payload are forwarded, so the UI's incremental renderer never has to defend
    // against a malformed or empty event.
    const eventChannel = new Channel<LiatirQuentaStreamEvent>((event) => {
      if (
        (event.type === 'thinking-delta' || event.type === 'content-delta')
        && typeof event.delta === 'string'
      ) {
        onEvent?.(event);
      }
    });
    const response = await this.api().invoke('lia_quenta_ollama_chat', {
      requestId,
      baseUrl: this.baseUrl,
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      thinkingEnabled: request.thinkingEnabled ?? false,
      format: request.format ?? null,
      onEvent: eventChannel,
    }) as {
      model?: string;
      message?: { content?: string; thinking?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    };
    // An empty completion is a failure, not a valid answer: rendering a blank reply would leave the
    // user with no indication that anything went wrong.
    const content = response.message?.content?.trim();
    if (!content) throw new Error('Ollama returned an empty Quenta response');
    return {
      model: response.model ?? request.model,
      content,
      thinking: response.message?.thinking?.trim() || undefined,
      promptTokens: response.prompt_eval_count,
      completionTokens: response.eval_count,
      totalDurationNs: response.total_duration,
    };
  }

  /**
   * Looks up a request the backend is (or was) running, including whatever it has generated so far.
   *
   * This is how the UI reattaches after being unmounted: the panel closes mid-answer, the generation
   * carries on in Rust, and on reopening the panel this restores the partial `thinking`/`content`
   * instead of showing the user a blank conversation. `null` means the backend has never heard of
   * this request.
   */
  async chatStatus(requestId: string): Promise<LiatirQuentaChatRequestSnapshot | null> {
    const snapshot = await this.api().invoke('lia_quenta_ollama_chat_status', {
      requestId,
    }) as null | {
      requestId: string;
      status: LiatirQuentaChatRequestSnapshot['status'];
      model: string;
      thinking: string;
      content: string;
      response?: {
        model?: string;
        message?: { content?: string; thinking?: string };
        prompt_eval_count?: number;
        eval_count?: number;
        total_duration?: number;
      };
      error?: string;
      updatedAt: number;
    };
    if (!snapshot) return null;
    // The finished response is only surfaced when it actually has content — a snapshot carrying an
    // empty completion is treated as "no response yet" rather than as a valid, blank answer.
    const responseContent = snapshot.response?.message?.content?.trim();
    return {
      requestId: snapshot.requestId,
      status: snapshot.status,
      model: snapshot.model,
      thinking: snapshot.thinking,
      content: snapshot.content,
      response: snapshot.response && responseContent ? {
        model: snapshot.response.model ?? snapshot.model,
        content: responseContent,
        thinking: snapshot.response.message?.thinking?.trim() || undefined,
        promptTokens: snapshot.response.prompt_eval_count,
        completionTokens: snapshot.response.eval_count,
        totalDurationNs: snapshot.response.total_duration,
      } : undefined,
      error: snapshot.error,
      updatedAt: snapshot.updatedAt,
    };
  }

  /** Stops a generation that is still running in the backend. */
  async cancelChat(requestId: string): Promise<boolean> {
    return await this.api().invoke('lia_quenta_ollama_cancel_chat', {
      requestId,
    }) as boolean;
  }

  /**
   * Drops a finished request from the backend's memory. Distinct from cancelling: the answer has
   * already been consumed by the UI, and this releases what the backend was holding for reattachment.
   */
  async forgetChat(requestId: string): Promise<boolean> {
    return await this.api().invoke('lia_quenta_ollama_forget_chat', {
      requestId,
    }) as boolean;
  }

  /**
   * Embeds a batch of strings.
   *
   * The length check is the important line: embeddings are positional, so a response with a
   * different count than the input cannot be safely matched back to its inputs. Failing loudly beats
   * silently pairing each text with the wrong vector.
   */
  async embed(model: string, input: string[]): Promise<number[][]> {
    const response = await this.api().invoke('lia_quenta_ollama_embed', {
      baseUrl: this.baseUrl,
      model,
      input,
    }) as { embeddings?: number[][] };
    if (!Array.isArray(response.embeddings) || response.embeddings.length !== input.length) {
      throw new Error('Ollama returned an invalid embedding response');
    }
    return response.embeddings;
  }
}
