import type {
  LiatirTutorChatRequest,
  LiatirTutorChatResponse,
  LiatirTutorProviderConfig,
  LiatirTutorProviderModel,
  LiatirTutorProviderStatus,
} from '@liatir/core';
import { OllamaTutorRuntime } from './runtime-ollama';

export interface TutorRuntime {
  status(): Promise<LiatirTutorProviderStatus>;
  models(): Promise<LiatirTutorProviderModel[]>;
  chat(request: LiatirTutorChatRequest): Promise<LiatirTutorChatResponse>;
  embed?(model: string, input: string[]): Promise<number[][]>;
}

export function createTutorRuntime(config: LiatirTutorProviderConfig): TutorRuntime {
  switch (config.provider) {
    case 'ollama':
      return new OllamaTutorRuntime(config.baseUrl);
  }
}
