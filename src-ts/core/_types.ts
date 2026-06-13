export type TauriCore = {
    invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  };
  
  export type TauriGlobal = TauriCore | { core: TauriCore };
  

  // Tipi di supporto per eventi e invoke
type TauriArgs = Record<string, unknown>;

interface EventCallback<T> {
  event: string;
  windowLabel: string;
  id: number;
  payload: T;
}

type UnlistenFn = () => void;

type TauriCoreExtended = {
  /**
   * Invia un messaggio al backend (Rust).
   * @param cmd Il nome del comando definito in Rust (#[tauri::command])
   * @param args Argomenti opzionali da passare al comando
   */
  invoke<T = unknown>(cmd: string, args?: TauriArgs): Promise<T>;
  
  /**
   * Converte un percorso file locale in un URL asset utilizzabile nel webview.
   */
  convertFileSrc(filePath: string, protocol?: string): string;
}

type TauriEvent = {
  /**
   * Ascolta un evento emesso dal backend o da un'altra finestra.
   */
  listen<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;
  
  /**
   * Ascolta un evento una sola volta.
   */
  once<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>;
  
  /**
   * Emette un evento al backend e a tutte le finestre Tauri.
   */
  emit(event: string, payload?: unknown): Promise<void>;
}

type TauriWindow = {
  /**
   * Ottiene la label della finestra corrente.
   */
  getCurrent(): any; // Ritorna l'oggetto Window corrente (semplificato qui)
  getAll(): any[];
}

type TauriMock = {
    /**
     * Utilizzato per il mocking delle chiamate IPC durante i test.
     */
    mockIPC(handler: (cmd: string, args: TauriArgs) => any): void;
}

// Estensione dell'interfaccia globale Window
export interface WindowTauri {
    /**
     * Le API principali di Tauri (invoke, convertFileSrc).
     * In V2, invoke si trova qui, non più alla radice.
     */
    core: TauriCore;

    /**
     * Gestione eventi (listen, emit).
     */
    event: TauriEvent;

    /**
     * Gestione finestre (spesso richiede @tauri-apps/api/window).
     */
    window: TauriWindow;
    
    /**
     * Utility di mocking (se abilitate).
     */
    mocks?: TauriMock;
    
    /**
     * NOTA: I plugin (fs, os, http) NON sono qui di default in V2.
     * Se li esponi manualmente nel main.js/ts, puoi estendere questa interfaccia.
     */
    [key: string]: any; 
}