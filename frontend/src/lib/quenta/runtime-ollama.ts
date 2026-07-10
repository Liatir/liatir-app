import { liatir } from '$lib/api';
import type {
  LiatirQuentaChatRequest,
  LiatirQuentaChatResponse,
  LiatirQuentaProviderModel,
  LiatirQuentaProviderStatus,
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

  async chat(request: LiatirQuentaChatRequest): Promise<LiatirQuentaChatResponse> {
    const response = await this.api().invoke('lia_quenta_ollama_chat', {
      baseUrl: this.baseUrl,
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      thinkingEnabled: request.thinkingEnabled ?? false,
      format: request.format ?? null,
    }) as {
      model?: string;
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
    };
    const content = response.message?.content?.trim();
    if (!content) throw new Error('Ollama returned an empty Quenta response');
    return {
      model: response.model ?? request.model,
      content,
      promptTokens: response.prompt_eval_count,
      completionTokens: response.eval_count,
      totalDurationNs: response.total_duration,
    };
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
