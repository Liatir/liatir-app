import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

// ── Syntax highlight colours ────────────────────────────────────────────────

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                          color: '#a09af9', fontWeight: '500' },
  { tag: tags.controlKeyword,                   color: '#a09af9', fontWeight: '500' },
  { tag: tags.operatorKeyword,                  color: '#a09af9' },
  { tag: tags.operator,                         color: '#d4d4d8' },
  { tag: tags.punctuation,                      color: '#71717a' },
  { tag: tags.bracket,                          color: '#a1a1aa' },
  { tag: tags.comment,                          color: '#52525e', fontStyle: 'italic' },
  { tag: tags.lineComment,                      color: '#52525e', fontStyle: 'italic' },
  { tag: tags.blockComment,                     color: '#52525e', fontStyle: 'italic' },
  { tag: tags.string,                           color: '#6ee7b7' },
  { tag: tags.special(tags.string),             color: '#6ee7b7' },
  { tag: tags.number,                           color: '#fbbf24' },
  { tag: tags.bool,                             color: '#fb923c' },
  { tag: tags.null,                             color: '#fb923c' },
  { tag: tags.regexp,                           color: '#6ee7b7' },
  { tag: tags.variableName,                     color: '#e4e4e8' },
  { tag: tags.definition(tags.variableName),    color: '#c4bffb' },
  { tag: tags.function(tags.variableName),      color: '#93c5fd' },
  { tag: tags.function(tags.propertyName),      color: '#93c5fd' },
  { tag: tags.propertyName,                     color: '#86efac' },
  { tag: tags.typeName,                         color: '#c4bffb' },
  { tag: tags.className,                        color: '#c4bffb' },
  { tag: tags.namespace,                        color: '#c4bffb' },
  { tag: tags.self,                             color: '#fb923c' },
  { tag: tags.atom,                             color: '#fb923c' },
  { tag: tags.invalid,                          color: '#f87171' },
]);

// ── Editor view theme ───────────────────────────────────────────────────────

const viewTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    lineHeight: '1.75',
    overflow: 'auto',
  },
  '.cm-content': { padding: '14px 0', caretColor: '#4f39f6' },
  '.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#4f39f6', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(79, 57, 246, 0.25)',
  },
  '::selection': { backgroundColor: 'rgba(79, 57, 246, 0.3)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-gutters': {
    backgroundColor: '#17171a',
    borderRight: '1px solid #2e2e35',
    color: '#52525e',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 16px 0 8px',
    minWidth: '44px',
    textAlign: 'right',
    fontSize: '12px',
  },
  '.cm-tooltip': {
    backgroundColor: '#1f1f23',
    border: '1px solid #2e2e35',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    color: '#e4e4e8',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: '12px',
    maxHeight: '200px',
  },
  '.cm-tooltip-autocomplete ul li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(79, 57, 246, 0.22)',
    color: '#c4bffb',
  },
  '.cm-completionLabel': { color: '#e4e4e8' },
  '.cm-completionDetail': {
    color: '#71717a',
    fontStyle: 'italic',
    paddingLeft: '10px',
    fontSize: '11px',
  },
  '.cm-completionMatchedText': {
    color: '#a09af9',
    textDecoration: 'none',
    fontWeight: 'bold',
  },
  '.cm-completionInfo': {
    padding: '8px 12px',
    backgroundColor: '#28282e',
    borderTop: '1px solid #2e2e35',
    color: '#a1a1aa',
    fontSize: '11px',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: '320px',
    lineHeight: '1.5',
  },
  '.cm-matchingBracket': {
    color: '#c4bffb !important',
    fontWeight: 'bold',
    outline: '1px solid rgba(79, 57, 246, 0.4)',
    borderRadius: '2px',
  },
}, { dark: true });

// ── Offlab API completion tree ──────────────────────────────────────────────

type ApiNode = {
  type: 'property' | 'method' | 'variable';
  detail: string;
  info?: string;
  children?: Record<string, ApiNode>;
};

const FS_SCOPE_CHILDREN: Record<string, ApiNode> = {
  listContent:  { type: 'method', detail: '(rel: string) => Promise<FsEntry[]>' },
  readText:     { type: 'method', detail: '(rel: string) => Promise<string>' },
  writeText:    { type: 'method', detail: '(rel, contents, opts?) => Promise<void>' },
  readBytes:    { type: 'method', detail: '(rel: string) => Promise<string>' },
  writeBytes:   { type: 'method', detail: '(rel, base64, opts?) => Promise<void>' },
  exists:       { type: 'method', detail: '(rel: string) => Promise<boolean>' },
  stat:         { type: 'method', detail: '(rel: string) => Promise<FsEntry>' },
  newDirectory: { type: 'method', detail: '(rel: string) => Promise<void>' },
  remove:       { type: 'method', detail: '(rel, recursive?) => Promise<void>' },
  move:         { type: 'method', detail: '(src, dest, opts?) => Promise<void>' },
  copy:         { type: 'method', detail: '(src, dest, opts?) => Promise<void>' },
  clear:        { type: 'method', detail: '() => Promise<void>' },
  path:         { type: 'method', detail: '() => Promise<string>' },
};

const OFFLAB_API: Record<string, ApiNode> = {
  // ── Top-level primitives ──────────────────────────────────────────────────
  isAvailable:  { type: 'property', detail: 'boolean',         info: 'true when running inside Tauri/Offlab' },
  isDesktop:    { type: 'property', detail: 'boolean',         info: 'true when running as a desktop app' },
  apiVersion:   { type: 'property', detail: 'string',          info: 'Bridge API version string' },
  invoke:       { type: 'method',   detail: '<T>(cmd, payload?) => Promise<T>', info: 'Raw Tauri command invocation' },
  openBrowser:  { type: 'method',   detail: '(url: string) => Promise<void>',  info: 'Open a URL in the system browser' },
  onReady:      { type: 'method',   detail: '(callback: () => void) => void',  info: 'Run callback once the bridge is ready' },

  // ── desktop ──────────────────────────────────────────────────────────────
  desktop: {
    type: 'property', detail: 'DesktopInterface',
    children: {
      notifications: {
        type: 'property', detail: 'NotificationsInterface',
        children: {
          state:   { type: 'method', detail: '() => Promise<"granted" | "denied" | "default">', info: 'Current notification permission state' },
          request: { type: 'method', detail: '() => Promise<"granted" | "denied">',             info: 'Request notification permission from the OS' },
          show:    { type: 'method', detail: '(title: string, body: string) => Promise<void>',  info: 'Show a native OS notification' },
        },
      },
      clipboard: {
        type: 'property', detail: 'ClipboardInterface',
        children: {
          readText:  { type: 'method', detail: '() => Promise<string>',          info: 'Read text from the system clipboard' },
          writeText: { type: 'method', detail: '(text: string) => Promise<void>', info: 'Write text to the system clipboard' },
        },
      },
      files: {
        type: 'property', detail: 'FilesInterface',
        children: {
          open:          { type: 'method', detail: '(options?) => Promise<{paths: string[]}>',       info: 'Open a native file picker dialog' },
          openWithBytes: { type: 'method', detail: '(options?) => Promise<{files: FileWithBytes[]}>', info: 'Open file picker and return raw bytes (base64)' },
          save:          { type: 'method', detail: '(defaultName?) => Promise<string>',              info: 'Open a native save-file dialog' },
        },
      },
      app: {
        type: 'property', detail: 'AppInterface',
        children: {
          info: { type: 'method', detail: '() => Promise<AppInfo>', info: 'Get app info: version, os, pid, screens, windows…' },
          exit: { type: 'method', detail: '(code?: number) => Promise<void>', info: 'Exit the application with an optional exit code' },
        },
      },
      window: {
        type: 'property', detail: 'WindowInterface',
        children: {
          new:             { type: 'method', detail: '(options?) => Promise<void>',          info: 'Open a new app window' },
          close:           { type: 'method', detail: '(label: string) => Promise<void>',     info: 'Close a window by its label' },
          minimize:        { type: 'method', detail: '() => Promise<void>',                  info: 'Minimize the current window' },
          maximizeToggle:  { type: 'method', detail: '() => Promise<void>',                  info: 'Toggle maximize state of the current window' },
          fullscreen:      { type: 'method', detail: '(enable: boolean) => Promise<void>',   info: 'Enter or exit fullscreen mode' },
          getInfo:         { type: 'method', detail: '(label?) => Promise<WindowInfo>',      info: 'Get size, position, state of a window' },
        },
      },
      events: {
        type: 'property', detail: 'EventsInterface',
        children: {
          emit:            { type: 'method', detail: '(event, payload?) => Promise<void>',                 info: 'Emit an event to all windows and backend' },
          emitToAll:       { type: 'method', detail: '(event, payload?) => Promise<void>',                 info: 'Emit to all windows' },
          emitTo:          { type: 'method', detail: '(windowLabel, event, payload?) => Promise<void>',    info: 'Emit to a specific window' },
          on:              { type: 'method', detail: '(event, handler) => Promise<Unlisten>',              info: 'Subscribe to an event. Call the returned fn to unsubscribe.' },
          once:            { type: 'method', detail: '(event) => Promise<any>',                            info: 'Await a single event emission' },
          onMany:          { type: 'method', detail: '(events[], handler) => Promise<Unlisten>',           info: 'Subscribe to multiple events at once' },
          onNetworkStatus: { type: 'method', detail: '(handler) => Promise<Unlisten>',                     info: 'Listen for network connectivity changes' },
          onDeeplink:      { type: 'method', detail: '(handler) => Promise<Unlisten>',                     info: 'Listen for deep-link URL activations' },
          onShortcut:      { type: 'method', detail: '(handler) => Promise<Unlisten>',                     info: 'Listen for global shortcut triggers' },
          onDragDrop:      { type: 'method', detail: '(handler, opts?) => Promise<Unlisten>',              info: 'Listen for file drag-drop events (paths in payload)' },
          onMenuEvent:     { type: 'method', detail: '(handler) => Promise<Unlisten>',                     info: 'Listen for native menu item clicks' },
          onTrayIconEvent: { type: 'method', detail: '(handler) => Promise<Unlisten>',                     info: 'Listen for tray icon interactions' },
        },
      },
      globalShortcut: {
        type: 'property', detail: 'ShortcutsInterface',
        children: {
          register:      { type: 'method', detail: '(accelerator, cb, opts?) => Promise<void>', info: 'Register a global keyboard shortcut (e.g. "CmdOrCtrl+Shift+P")' },
          unregister:    { type: 'method', detail: '(accelerator: string) => Promise<void>',    info: 'Unregister a global shortcut' },
          unregisterAll: { type: 'method', detail: '() => Promise<void>',                       info: 'Unregister all global shortcuts' },
          isRegistered:  { type: 'method', detail: '(accelerator: string) => Promise<boolean>', info: 'Check if an accelerator is currently registered' },
        },
      },
      fs: {
        type: 'property', detail: 'FsInterface',
        info: 'Sandboxed filesystem under ~/.offlab — use cache or data scopes',
        children: {
          cache:     { type: 'property', detail: 'FsScopeMethods', info: 'Cache-scoped storage (cleared on update)', children: FS_SCOPE_CHILDREN },
          data:      { type: 'property', detail: 'FsScopeMethods', info: 'Persistent data storage',                  children: FS_SCOPE_CHILDREN },
          pluginFs:  { type: 'method',   detail: '(plugin: string) => FsPluginMethods', info: 'Get a scoped fs for a named plugin' },
          paths:     { type: 'method',   detail: '() => Promise<{cache, data}>',        info: 'Get absolute paths to cache and data dirs' },
          trash:     {
            type: 'property', detail: 'FsTrashMethods',
            children: {
              clear:       { type: 'method', detail: '() => Promise<void>' },
              recover:     { type: 'method', detail: '() => Promise<void>' },
              listContent: { type: 'method', detail: '(rel?) => Promise<FsEntry[]>' },
              readText:    { type: 'method', detail: '(rel: string) => Promise<string>' },
              exists:      { type: 'method', detail: '(rel?) => Promise<boolean>' },
            },
          },
        },
      },
      menu: {
        type: 'property', detail: 'MenuInterface',
        children: {
          setEnabled: { type: 'method', detail: '(id: string, enabled: boolean) => Promise<void>', info: 'Enable or disable a menu item by ID' },
          setChecked: { type: 'method', detail: '(id: string, checked: boolean) => Promise<void>', info: 'Set check state of a checkable menu item' },
          init: {
            type: 'property', detail: '{ fromConfig, fromJsonFile }',
            children: {
              fromConfig:   { type: 'method', detail: '(config: MenuConfig) => Promise<void>',    info: 'Apply a menu config object' },
              fromJsonFile: { type: 'method', detail: '(filePath: string) => Promise<void>',      info: 'Load menu from a JSON file path' },
            },
          },
        },
      },
      network: {
        type: 'property', detail: 'NetworkInterface',
        children: {
          status:            { type: 'method', detail: '() => Promise<void>',                             info: 'Get current network status' },
          ping:              { type: 'method', detail: '(url, timeout?) => Promise<void>',                info: 'Ping a URL and get response time' },
          resolve:           { type: 'method', detail: '(host: string) => Promise<void>',                 info: 'DNS-resolve a hostname' },
          estimateBandwidth: { type: 'method', detail: '(url?, sizeHintBytes?, timeout?) => Promise<void>', info: 'Estimate download bandwidth' },
          setMonitor:        { type: 'method', detail: '(interval, targets?) => Promise<void>',           info: 'Start periodic network monitoring' },
          stopMonitor:       { type: 'method', detail: '() => Promise<void>',                             info: 'Stop network monitoring' },
        },
      },
      autostart: {
        type: 'property', detail: 'AutostartInterface',
        children: {
          enable:    { type: 'method', detail: '() => Promise<void>',              info: 'Enable app launch at login' },
          disable:   { type: 'method', detail: '() => Promise<void>',              info: 'Disable app launch at login' },
          isEnabled: { type: 'method', detail: '() => Promise<void>',              info: 'Check if autostart is enabled' },
          mode: {
            type: 'property', detail: '{ get, set }',
            children: {
              get: { type: 'method', detail: '() => Promise<AutostartMode>' },
              set: { type: 'method', detail: '(mode: "shown" | "minimized" | "hidden") => Promise<void>' },
            },
          },
        },
      },
      badge: {
        type: 'property', detail: 'BadgeInterface | undefined',
        info: 'macOS dock badge — undefined on non-macOS platforms',
        children: {
          set:   { type: 'method', detail: '(count: number) => Promise<void>', info: 'Set the dock badge count' },
          clear: { type: 'method', detail: '() => Promise<void>',              info: 'Clear the dock badge' },
        },
      },
      contextMenu: {
        type: 'property', detail: 'ContextMenuInterface',
        children: {
          show:    { type: 'method', detail: '(entries: CmNode[], options: CmPopupOptions) => Promise<string>', info: 'Show a native context menu, returns the selected item ID' },
          handler: {
            type: 'property', detail: '{ init, remove }',
            children: {
              init:   { type: 'method', detail: '(callback, preventDefault?) => void', info: 'Attach a right-click listener' },
              remove: { type: 'method', detail: '() => void',                          info: 'Remove the right-click listener' },
            },
          },
        },
      },
      globalVariables: {
        type: 'property', detail: 'GlobalVariablesInterface',
        info: 'Persistent key-value store shared across windows',
        children: {
          get:    { type: 'method', detail: '(key: string) => Promise<string>',           info: 'Get a global variable value' },
          set:    { type: 'method', detail: '(key, value: string) => Promise<void>',      info: 'Set a global variable (persists across windows)' },
          remove: { type: 'method', detail: '(key: string) => Promise<void>',             info: 'Delete a global variable' },
          list:   { type: 'method', detail: '(key: string) => Promise<Record<string, string>>', info: 'List all global variables' },
        },
      },
    },
  },

  // ── plugins ──────────────────────────────────────────────────────────────
  plugins: {
    type: 'property', detail: 'PluginsInterface',
    children: {
      list:   { type: 'method', detail: '() => Promise<string[]>',                          info: 'List loaded WASM plugin names' },
      call:   { type: 'method', detail: '(name: string, payload: object) => Promise<any>',  info: 'Call a WASM plugin function with a JSON payload' },
      add:    { type: 'method', detail: '(path?: string) => Promise<{name: string}>',        info: 'Add a WASM plugin. Opens file picker if path is empty.' },
      remove: { type: 'method', detail: '(name: string) => Promise<void>',                  info: 'Remove a loaded WASM plugin' },
    },
  },

  // ── sidecar ──────────────────────────────────────────────────────────────
  sidecar: {
    type: 'property', detail: 'SidecarInterface',
    children: {
      run: { type: 'method', detail: '(name: string, args: string[]) => Promise<SidecarResult>', info: 'Run a bundled native sidecar binary. Returns stdout, stderr, exitCode.' },
    },
  },

  // ── pipeline ─────────────────────────────────────────────────────────────
  pipeline: {
    type: 'property', detail: 'PipelineInterface',
    children: {
      run: { type: 'method', detail: '(steps: PipelineStep[], opts?) => Promise<PipelineResult>', info: 'Execute a sequence of WASM and/or sidecar steps in order' },
    },
  },

  // ── jobs ─────────────────────────────────────────────────────────────────
  jobs: {
    type: 'property', detail: 'JobsInterface',
    children: {
      list:      { type: 'method', detail: '() => Promise<JobEntry[]>',               info: 'List all jobs (running + completed)' },
      spawn:     { type: 'method', detail: '(cmd, args, opts?) => Promise<{jobId}>',  info: 'Spawn a new system process asynchronously' },
      kill:      { type: 'method', detail: '(jobId: string) => Promise<void>',        info: 'Kill a running job by ID' },
      clearDone: { type: 'method', detail: '() => Promise<void>',                     info: 'Remove all completed jobs from history' },
    },
  },

  // ── deps ─────────────────────────────────────────────────────────────────
  deps: {
    type: 'property', detail: 'DepsInterface',
    children: {
      check:     { type: 'method', detail: '(binary: string) => Promise<DepResult>',       info: 'Check if a binary is available on PATH and get its version' },
      checkMany: { type: 'method', detail: '(binaries: string[]) => Promise<DepResult[]>', info: 'Check multiple binaries at once' },
    },
  },

  // ── qc ───────────────────────────────────────────────────────────────────
  qc: {
    type: 'property', detail: 'QcInterface',
    children: {
      fastqc: {
        type: 'property', detail: 'FastqcAPI',
        children: {
          run: { type: 'method', detail: '({input, maxReads?}) => Promise<FastqcResult>', info: 'Run FastQC quality control on a FASTQ file. Returns per-position quality, GC content, read stats.' },
        },
      },
    },
  },
};

// ── Completion resolution ───────────────────────────────────────────────────

function resolveNode(parts: string[]): Record<string, ApiNode> | null {
  if (parts.length === 0) return OFFLAB_API;
  let node: ApiNode | undefined = OFFLAB_API[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (!node?.children) return null;
    node = node.children[parts[i]];
  }
  return node?.children ?? null;
}

function offlabCompletionSource(context: CompletionContext) {
  const dotMatch = context.matchBefore(/Offlab(\.\w*)*/);

  if (!dotMatch) {
    const word = context.matchBefore(/\w+/);
    if (!word || !word.text.startsWith('Off')) return null;
    return {
      from: word.from,
      options: [{ label: 'Offlab', type: 'variable' as const, detail: 'Offlab bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const text = dotMatch.text;
  const lastDot = text.lastIndexOf('.');

  if (lastDot === -1) {
    return {
      from: dotMatch.from,
      options: [{ label: 'Offlab', type: 'variable' as const, detail: 'Offlab bridge API' }],
      validFor: /^\w*$/,
    };
  }

  const prefix = text.slice(0, lastDot);      // e.g. "Offlab.desktop.fs"
  const from   = dotMatch.from + lastDot + 1; // position right after the last dot

  const parts    = prefix.split('.').slice(1); // drop "Offlab" → ["desktop", "fs"]
  const children = resolveNode(parts);
  if (!children) return null;

  const options: Completion[] = Object.entries(children).map(([key, node]) => ({
    label:  key,
    type:   node.type,
    detail: node.detail,
    info:   node.info,
    boost:  node.type === 'method' ? 1 : 0,
  }));

  return { from, options, validFor: /^\w*$/ };
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const offlabTheme = [viewTheme, syntaxHighlighting(highlightStyle)];

export const offlabCompletions = autocompletion({
  override: [offlabCompletionSource],
  defaultKeymap: true,
  activateOnTyping: true,
});
