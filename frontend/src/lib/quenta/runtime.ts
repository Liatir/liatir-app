import type {
  LiatirQuentaChatRequest,
  LiatirQuentaChatRequestSnapshot,
  LiatirQuentaChatResponse,
  LiatirQuentaStreamEvent,
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
  chat(
    request: LiatirQuentaChatRequest,
    requestId: string,
    onEvent?: (event: LiatirQuentaStreamEvent) => void,
  ): Promise<LiatirQuentaChatResponse>;
  chatStatus(requestId: string): Promise<LiatirQuentaChatRequestSnapshot | null>;
  cancelChat(requestId: string): Promise<boolean>;
  forgetChat(requestId: string): Promise<boolean>;
  embed?(model: string, input: string[]): Promise<number[][]>;
}

export function createQuentaRuntime(config: LiatirQuentaProviderConfig): QuentaRuntime {
  switch (config.provider) {
    case 'ollama':
      return new OllamaQuentaRuntime(config.baseUrl);
  }
}
