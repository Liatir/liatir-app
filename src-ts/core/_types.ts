export type TauriCore = {
    invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    convertFileSrc(filePath: string, protocol?: string): string;
  };
  
  export type TauriGlobal = TauriCore | { core: TauriCore };
  

  // Shared helper types for events and invoke calls.
type TauriArgs = Record<string, unknown>;

interface EventCallback<T> {
  event: string;
  windowLabel: string;
  id: number;
  payload: T;
}

type UnlistenFn = () => void;

type TauriEvent = {
  /**
   * Listen to an event emitted by the backend or another window.
   */
  listen<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;
  
  /**
   * Listen to an event once.
   */
  once<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;
  
  /**
   * Emit an event to the backend and all Tauri windows.
   */
  emit(event: string, payload?: unknown): Promise<void>;
}

type TauriWindow = {
  /**
   * Return the current window label.
   */
  getCurrent(): any; // Returns the current Window object, simplified here.
  getAll(): any[];
}

type TauriMock = {
    /**
     * Used to mock IPC calls during tests.
     */
    mockIPC(handler: (cmd: string, args: TauriArgs) => any): void;
}

// Extension of the global Window interface.
export interface WindowTauri {
    /**
     * Main Tauri APIs (invoke, convertFileSrc).
     * In v2, invoke lives here instead of at the root.
     */
    core: TauriCore;

    /**
     * Event handling (listen, emit).
     */
    event: TauriEvent;

    /**
     * Window management (often requires @tauri-apps/api/window).
     */
    window: TauriWindow;
    
    /**
     * Mocking utilities, when enabled.
     */
    mocks?: TauriMock;
    
    /**
     * Note: plugins (fs, os, http) are not exposed here by default in v2.
     * If main.js/ts exposes them manually, extend this interface.
     */
    [key: string]: any; 
}
