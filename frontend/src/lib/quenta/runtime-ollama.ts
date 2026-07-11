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

  private normalizeModels(models: OllamaModel[]): LiatirQuentaProviderModel[] {
    return models.map((model) => ({
      name: model.name ?? model.model ?? 'unknown',
      modifiedAt: model.modified_at,
      sizeBytes: model.size,
      digest: model.digest,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantization: model.details?.quantization_level,
    }));
  }

  async chat(
    request: LiatirQuentaChatRequest,
    requestId: string,
    onEvent?: (event: LiatirQuentaStreamEvent) => void,
  ): Promise<LiatirQuentaChatResponse> {
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

  async cancelChat(requestId: string): Promise<boolean> {
    return await this.api().invoke('lia_quenta_ollama_cancel_chat', {
      requestId,
    }) as boolean;
  }

  async forgetChat(requestId: string): Promise<boolean> {
    return await this.api().invoke('lia_quenta_ollama_forget_chat', {
      requestId,
    }) as boolean;
  }

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
