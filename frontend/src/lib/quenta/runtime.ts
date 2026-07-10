import type {
  LiatirQuentaChatRequest,
  LiatirQuentaChatResponse,
  LiatirQuentaProviderConfig,
  LiatirQuentaProviderModel,
  LiatirQuentaProviderStatus,
} from '@liatir/core';
import { OllamaQuentaRuntime } from './runtime-ollama';

export interface QuentaRuntime {
  status(): Promise<LiatirQuentaProviderStatus>;
  models(): Promise<LiatirQuentaProviderModel[]>;
  bootstrap?(model: string): Promise<{
    status: LiatirQuentaProviderStatus;
    models: LiatirQuentaProviderModel[];
    model: string;
    downloaded: boolean;
  }>;
  chat(request: LiatirQuentaChatRequest): Promise<LiatirQuentaChatResponse>;
  embed?(model: string, input: string[]): Promise<number[][]>;
}

export function createQuentaRuntime(config: LiatirQuentaProviderConfig): QuentaRuntime {
  switch (config.provider) {
    case 'ollama':
      return new OllamaQuentaRuntime(config.baseUrl);
  }
}
