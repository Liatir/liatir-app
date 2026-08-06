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

/**
 * The contract every Quenta backend must satisfy.
 *
 * Ollama is the only implementation today, but the rest of the app talks to *this* interface rather
 * than to Ollama, so adding another provider means writing one class — not touching the UI.
 *
 * The request-lifecycle methods (`chatStatus` / `cancelChat` / `forgetChat`) are part of the contract
 * rather than an Ollama detail: a generation that outlives the component that started it is a
 * property of how Quenta works, so any provider has to support reattaching to one.
 *
 * `bootstrap` and `embed` are optional — a provider that has nothing to install, or offers no
 * embedding endpoint, simply omits them.
 */
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

/**
 * Builds the runtime for a configured provider.
 *
 * The `switch` has no default on purpose: `provider` is a closed union, so adding a new provider to
 * it makes TypeScript flag this function as non-exhaustive — the compiler, not a runtime error, is
 * what reminds you to wire it up.
 */
export function createQuentaRuntime(config: LiatirQuentaProviderConfig): QuentaRuntime {
  switch (config.provider) {
    case 'ollama':
      return new OllamaQuentaRuntime(config.baseUrl);
  }
}
