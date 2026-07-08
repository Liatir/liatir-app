// This file is generated automatically — do not edit.
// Run:  npm run gen:sdk-types
// Source: src-ts/liatir/_types.ts → LiatirBrowserAPI  (liatir@0.2.1)

import type { ApiNode } from './liatir-editor';

export const LIATIR_API: Record<string, ApiNode> = {
  isAvailable: { type: "property", detail: "boolean" },
  apiVersion: { type: "property", detail: "string" },
  ready: { type: "property", detail: "Promise<true>" },
  invoke: { type: "method", detail: "<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>" },
  isDesktop: { type: "property", detail: "boolean" },
  desktop: { type: "property", detail: "DesktopInterface", info: "Native desktop bridge — window, fs, notifications, clipboard, etc.", children: {
      notifications: { type: "property", detail: "NotificationsInterface", children: {
          state: { type: "method", detail: "(): Promise<string>" },
          request: { type: "method", detail: "(): Promise<string>" },
          show: { type: "method", detail: "(title: string, body: string): Promise<void>" },
      } },
      clipboard: { type: "property", detail: "ClipboardInterface", children: {
          readText: { type: "method", detail: "(): Promise<string>" },
          writeText: { type: "method", detail: "(text: string): Promise<void>" },
      } },
      files: { type: "property", detail: "FilesInterface", info: "File picker dialogs — use `files.open()` to get file paths for bio tools", children: {
          open: { type: "method", detail: "(options?: { multi?: boolean; allowed?: string[]; maxBytes?: U64; }): Promise<OpenResult>" },
          openWithBytes: { type: "method", detail: "(options?: { multi?: boolean; allowed?: string[]; maxBytes?: U64; }): Promise<OpenResultWithBytes>" },
          save: { type: "method", detail: "(defaultName?: string): Promise<string>" },
      } },
      app: { type: "property", detail: "AppInterface", children: {
          info: { type: "method", detail: "(): Promise<AppInfo>" },
          exit: { type: "method", detail: "(code?: I32): Promise<void>" },
      } },
      window: { type: "property", detail: "WindowInterface", children: {
          new: { type: "method", detail: "(options?: NewWindowOptions): Promise<void>" },
          close: { type: "method", detail: "(label: string): Promise<void>" },
          minimize: { type: "method", detail: "(): Promise<void>" },
          maximizeToggle: { type: "method", detail: "(): Promise<void>" },
          fullscreen: { type: "method", detail: "(enable: boolean): Promise<void>" },
          getInfo: { type: "method", detail: "(label?: string): Promise<WindowInfo>" },
      } },
      events: { type: "property", detail: "EventsInterface", children: {
          emit: { type: "method", detail: "(event: string, payload?: unknown): Promise<unknown>" },
          emitToAll: { type: "method", detail: "(event: string, payload?: unknown): Promise<unknown>" },
          emitTo: { type: "method", detail: "(windowLabel: string, event: string, payload?: unknown): Promise<unknown>" },
          on: { type: "method", detail: "(event: string, handler: (payload: any) => void): Promise<Unlisten>" },
          once: { type: "method", detail: "(event: string): Promise<any>" },
          onMany: { type: "method", detail: "(events: string[], handler: (name: string, payload: any) => void): Promise<Unlisten>" },
          onNetworkStatus: { type: "method", detail: "(handler: (payload: any) => void): Promise<Unlisten>" },
          onDeeplink: { type: "method", detail: "(handler: (payload: any) => void): Promise<Unlisten>" },
          onShortcut: { type: "method", detail: "(handler: (payload: any) => void): Promise<Unlisten>" },
          onDragDrop: { type: "method", detail: "(handler: (name: string, payload: DragDropPayload) => void, options?: { includeHover?: boolean; }): Promise<Unlisten>" },
          onMenuEvent: { type: "method", detail: "(handler: (payload: any) => void): Promise<Unlisten>" },
          onTrayIconEvent: { type: "method", detail: "(handler: (payload: any) => void): Promise<Unlisten>" },
      } },
      globalShortcut: { type: "property", detail: "ShortcutsInterface", children: {
          register: { type: "method", detail: "(accelerator: string, cb: (e: any) => void, options?: { emitEvent?: boolean; }): Promise<void>" },
          unregister: { type: "method", detail: "(accelerator: string): Promise<void>" },
          unregisterAll: { type: "method", detail: "(): Promise<void>" },
          isRegistered: { type: "method", detail: "(accelerator: string): Promise<boolean>" },
      } },
      fs: { type: "property", detail: "FsInterface", info: "Sandboxed persistent/cache storage under ~/.liatir", children: {
          cache: { type: "property", detail: "FsScopeMethods", children: {
              listContent: { type: "method", detail: "(rel: string): Promise<FsEntry[]>" },
              newDirectory: { type: "method", detail: "(rel: string): Promise<void>" },
              remove: { type: "method", detail: "(rel: string, recursive?: boolean): Promise<void>" },
              stat: { type: "method", detail: "(rel: string): Promise<FsEntry>" },
              writeText: { type: "method", detail: "(rel: string, contents: string, opts?: { createDirs?: boolean; append?: boolean; }): Promise<void>" },
              readText: { type: "method", detail: "(rel: string): Promise<string>" },
              writeBytes: { type: "method", detail: "(rel: string, base64: string, opts?: { createDirs?: boolean; }): Promise<void>" },
              readBytes: { type: "method", detail: "(rel: string): Promise<string>" },
              exists: { type: "method", detail: "(rel: string): Promise<boolean>" },
              move: { type: "method", detail: "(src: string, dest: string, opts?: { createDirs?: boolean; overwrite?: boolean; }): Promise<void>" },
              copy: { type: "method", detail: "(src: string, dest: string, opts?: { recursive?: boolean; createDirs?: boolean; overwrite?: boolean; }): Promise<void>" },
              clear: { type: "method", detail: "(): Promise<void>" },
              path: { type: "method", detail: "(): Promise<string>" },
              base: { type: "property", detail: "string" },
          } },
          data: { type: "property", detail: "FsScopeMethods", children: {
              listContent: { type: "method", detail: "(rel: string): Promise<FsEntry[]>" },
              newDirectory: { type: "method", detail: "(rel: string): Promise<void>" },
              remove: { type: "method", detail: "(rel: string, recursive?: boolean): Promise<void>" },
              stat: { type: "method", detail: "(rel: string): Promise<FsEntry>" },
              writeText: { type: "method", detail: "(rel: string, contents: string, opts?: { createDirs?: boolean; append?: boolean; }): Promise<void>" },
              readText: { type: "method", detail: "(rel: string): Promise<string>" },
              writeBytes: { type: "method", detail: "(rel: string, base64: string, opts?: { createDirs?: boolean; }): Promise<void>" },
              readBytes: { type: "method", detail: "(rel: string): Promise<string>" },
              exists: { type: "method", detail: "(rel: string): Promise<boolean>" },
              move: { type: "method", detail: "(src: string, dest: string, opts?: { createDirs?: boolean; overwrite?: boolean; }): Promise<void>" },
              copy: { type: "method", detail: "(src: string, dest: string, opts?: { recursive?: boolean; createDirs?: boolean; overwrite?: boolean; }): Promise<void>" },
              clear: { type: "method", detail: "(): Promise<void>" },
              path: { type: "method", detail: "(): Promise<string>" },
              base: { type: "property", detail: "string" },
          } },
          pluginFs: { type: "method", detail: "(plugin: string): FsPluginMethods", info: "Scoped to the persistent storage of the selected plugin." },
          paths: { type: "method", detail: "(): Promise<FsPaths>" },
          base: { type: "property", detail: "{ cache: string; data: string; }", children: {
              cache: { type: "property", detail: "string" },
              data: { type: "property", detail: "string" },
          } },
          trash: { type: "property", detail: "FsTrashMethods", children: {
              clear: { type: "method", detail: "(): Promise<void>" },
              recover: { type: "method", detail: "(): Promise<void>" },
              listContent: { type: "method", detail: "(rel?: string): Promise<FsEntry[]>" },
              stat: { type: "method", detail: "(rel?: string): Promise<FsEntry>" },
              exists: { type: "method", detail: "(rel?: string): Promise<boolean>" },
              readText: { type: "method", detail: "(rel: string): Promise<string>" },
              readBytes: { type: "method", detail: "(rel: string): Promise<string>" },
          } },
          diagnostics: { type: "property", detail: "FsDiagnosticMethods", children: {
              clear: { type: "method", detail: "(): Promise<void>" },
              remove: { type: "method", detail: "(rel: string, recursive?: boolean): Promise<void>" },
              listContent: { type: "method", detail: "(rel?: string): Promise<FsEntry[]>" },
              stat: { type: "method", detail: "(rel?: string): Promise<FsEntry>" },
              exists: { type: "method", detail: "(rel?: string): Promise<boolean>" },
              readText: { type: "method", detail: "(rel: string): Promise<string>" },
              readBytes: { type: "method", detail: "(rel: string): Promise<string>" },
          } },
      } },
      menu: { type: "property", detail: "MenuInterface", children: {
          setEnabled: { type: "method", detail: "(id: string, enabled: boolean): Promise<void>" },
          setChecked: { type: "method", detail: "(id: string, checked: boolean): Promise<void>" },
          init: { type: "property", detail: "{ fromConfig: (config: MenuConfig) => Promise<void>; fromJsonFile: (filePath: string) => Promise<void>; }", children: {
              fromConfig: { type: "method", detail: "(config: MenuConfig): Promise<void>" },
              fromJsonFile: { type: "method", detail: "(filePath: string): Promise<void>" },
          } },
      } },
      diagnostics: { type: "property", detail: "DiagnosticsInterface", children: {
          settings: { type: "property", detail: "{ set: (settings?: PrivacySettings) => Promise<PrivacySettingsCamelCase>; get: () => Promise<PrivacySettingsCamelCase>; }", children: {
              set: { type: "method", detail: "(settings?: PrivacySettings): Promise<PrivacySettingsCamelCase>" },
              get: { type: "method", detail: "(): Promise<PrivacySettingsCamelCase>" },
          } },
          newRecord: { type: "method", detail: "(recordType: string, payload: AnalyticsPayload, env: string, appVersion?: string): Promise<void>" },
          newError: { type: "property", detail: "{ js: (payload: ErrorPayload, appVersion?: string) => Promise<void>; native: (payload: ErrorPayload, appVersion?: string) => Promise<void>; generic: (payload: ErrorPayload, env?: string, appVersion?: string) => Promise<void>; }", children: {
              js: { type: "method", detail: "(payload: ErrorPayload, appVersion?: string): Promise<void>" },
              native: { type: "method", detail: "(payload: ErrorPayload, appVersion?: string): Promise<void>" },
              generic: { type: "method", detail: "(payload: ErrorPayload, env?: string, appVersion?: string): Promise<void>" },
          } },
          readRecordsFile: { type: "method", detail: "(relPath: string): Promise<string>" },
          listRecordsFiles: { type: "method", detail: "(area: DiagnosticsArea): Promise<ListedFile[]>" },
          runRetention: { type: "method", detail: "(): Promise<void>" },
          export: { type: "method", detail: "(): Promise<string>" },
          test: { type: "property", detail: "DiagnosticsTestFunctions", children: {
              testGenerateRecords: { type: "method", detail: "(n?: number): Promise<void>" },
              testThrowJsError: { type: "method", detail: "(): Promise<never>" },
              testPanicRust: { type: "method", detail: "(): Promise<void>" },
              testExportZip: { type: "method", detail: "(): Promise<string>" },
              testForceRetention: { type: "method", detail: "(area: DiagnosticsArea): Promise<void>" },
          } },
      } },
      network: { type: "property", detail: "NetworkInterface", children: {
          status: { type: "method", detail: "(): Promise<void>" },
          ping: { type: "method", detail: "(url: string, timeout?: U64): Promise<void>" },
          resolve: { type: "method", detail: "(host: string): Promise<void>" },
          estimateBandwidth: { type: "method", detail: "(url?: string, sizeHintBytes?: U64, timeout?: U64): Promise<void>" },
          setMonitor: { type: "method", detail: "(interval: U64, targets?: string[]): Promise<void>" },
          stopMonitor: { type: "method", detail: "(): Promise<void>" },
      } },
      autostart: { type: "property", detail: "AutostartInterface", children: {
          enable: { type: "method", detail: "(): Promise<void>" },
          disable: { type: "method", detail: "(): Promise<void>" },
          isEnabled: { type: "method", detail: "(): Promise<void>" },
          mode: { type: "property", detail: "{ get: () => Promise<void>; set: (mode: AutostartMode) => Promise<void>; }", children: {
              get: { type: "method", detail: "(): Promise<void>" },
              set: { type: "method", detail: "(mode: AutostartMode): Promise<void>" },
          } },
      } },
      badge: { type: "property", detail: "BadgeInterface", info: "macOS only — undefined on other platforms", children: {
          set: { type: "method", detail: "(count: U32): Promise<void>" },
          clear: { type: "method", detail: "(): Promise<void>" },
      } },
      contextMenu: { type: "property", detail: "ContextMenuInterface & { listening?: boolean; listener?: EventListenerOrEventListenerObject; }" },
      globalVariables: { type: "property", detail: "GlobalVariablesInterface", children: {
          get: { type: "method", detail: "(key: string): Promise<string>" },
          set: { type: "method", detail: "(key: string, value: string): Promise<void>" },
          remove: { type: "method", detail: "(key: string): Promise<void>" },
          list: { type: "method", detail: "(key: string): Promise<{ [key: string]: string; }>" },
      } },
  } },
  jobs: { type: "property", detail: "JobsInterface", info: "Async process manager — spawn, stream, kill any system binary.", children: {
      spawn: { type: "method", detail: "(cmd: string, args: string[], opts?: SpawnOptions): Promise<SpawnResult>", info: "Spawn an async process. Returns immediately with a jobId.\nSubscribe to events via Liatir.desktop.events:\n  \"jobs:stdout:<jobId>\" → line: string\n  \"jobs:stderr:<jobId>\" → line: string\n  \"jobs:exit:<jobId>\"   → { jobId, exitCode, ok }" },
      kill: { type: "method", detail: "(jobId: string): Promise<boolean>" },
      status: { type: "method", detail: "(jobId: string): Promise<JobEntry>" },
      list: { type: "method", detail: "(): Promise<JobEntry[]>" },
      clearDone: { type: "method", detail: "(): Promise<number>", info: "Remove all completed/failed/killed jobs from the registry" },
  } },
  deps: { type: "property", detail: "DepsInterface", info: "Check whether system tools are installed and get their versions.", children: {
      check: { type: "method", detail: "(binary: string): Promise<DepCheckResult>", info: "Check if a single binary is available in PATH" },
      checkMany: { type: "method", detail: "(binaries: string[]): Promise<DepCheckResult[]>", info: "Check multiple binaries at once" },
  } },
  qc: { type: "property", detail: "QcInterface", children: {
      fastqc: { type: "property", detail: "FastqcInterface", children: {
          run: { type: "method", detail: "(args: FastqcArgs): Promise<LiatirToolOutput>" },
      } },
  } },
  tauri: { type: "property", detail: "WindowTauri", children: {
      core: { type: "property", detail: "TauriCore", info: "Main Tauri APIs (invoke, convertFileSrc).\nIn v2, invoke lives here instead of at the root.", children: {
          invoke: { type: "method", detail: "<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>" },
          convertFileSrc: { type: "method", detail: "(filePath: string, protocol?: string): string" },
      } },
      event: { type: "property", detail: "TauriEvent", info: "Event handling (listen, emit).", children: {
          listen: { type: "method", detail: "<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>", info: "Listen to an event emitted by the backend or another window." },
          once: { type: "method", detail: "<T>(event: string, handler: (event: EventCallback<T>) => void): Promise<UnlistenFn>", info: "Listen to an event once." },
          emit: { type: "method", detail: "(event: string, payload?: unknown): Promise<void>", info: "Emit an event to the backend and all Tauri windows." },
      } },
      window: { type: "property", detail: "TauriWindow", info: "Window management (often requires", children: {
          getCurrent: { type: "method", detail: "(): any", info: "Return the current window label." },
          getAll: { type: "method", detail: "(): any[]" },
      } },
      mocks: { type: "property", detail: "TauriMock", info: "Mocking utilities, when enabled.", children: {
          mockIPC: { type: "method", detail: "(handler: (cmd: string, args: TauriArgs) => any): void", info: "Used to mock IPC calls during tests." },
      } },
  } },
  onReady: { type: "method", detail: "(callback: Function): void" },
  openBrowser: { type: "method", detail: "(url: string): Promise<void>" },
};
