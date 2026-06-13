import type { NotificationsInterface } from "../modules/rs/notifications/_types";
import type { ClipboardInterface } from "../modules/rs/clipboard/_types";
import type { FilesInterface } from "../modules/rs/files/_types";
import type { AppInterface } from "../modules/rs/app/_types";
import type { WindowInterface } from "../modules/rs/window/_types";
import type { EventsInterface } from "../modules/rs/events/_types";
import type { ShortcutsInterface } from "../modules/rs/shortcuts/_types";
import type { FsInterface } from "../modules/rs/fs/_types";
import type { MenuInterface } from "../modules/rs/menu/_types";
import type { DiagnosticsInterface } from "../modules/rs/diagnostics/_types";
import type { BadgeInterface } from "../modules/rs/badge/_types";
import type { WorkerInterface } from "../modules/rs/worker/_types";
import type { ContextMenuInterface } from "../modules/rs/contextMenu/_types";
// import type { CompanionInterface } from "../modules/rs/companion/_types";
import type { AutostartInterface } from "../modules/rs/autostart/_types";
import type { NetworkInterface } from "../modules/rs/network/_types";
import type { GlobalVariablesInterface } from "../modules/rs/globalVariables/_types";
import { WindowTauri } from "../core/_types";
import { PluginsInterface } from "../modules/rs/plugins/_types";

export type DtrPlatform = "macos" | "linux" | "windows";

/**
 * Desktopr API exposed in the webview.
 *
 * Each property corresponds to a bridge module backed by Tauri commands.
 * The API is globally mounted on `window.Desktopr` when the runtime is ready.
 *
 * Notes:
 * - `badge` is supported **only on macOS**. On Windows and Linux this field
 *   will be `undefined` and must be checked before use.
 * - All other modules are cross-platform.
 */
export type DesktoprAPI = {
  readonly isAvailable: boolean;
  readonly apiVersion: string;
  readonly ready: Promise<true>;
  invoke<T = unknown>(
    cmd: string,
    payload?: Record<string, unknown>
  ): Promise<T>;
  isDesktop: boolean;
  notifications: NotificationsInterface;
  clipboard: ClipboardInterface;
  files: FilesInterface;
  app: AppInterface;
  window: WindowInterface;
  events: EventsInterface;
  globalShortcut: ShortcutsInterface;
  fs: FsInterface;
  menu: MenuInterface;
  diagnostics: DiagnosticsInterface;
  network: NetworkInterface;
  autostart: AutostartInterface;
  badge?: BadgeInterface;
  plugins: PluginsInterface;
  tauri?: WindowTauri;
  onReady: (callback: Function) => void;
  globalVariables: GlobalVariablesInterface;
  contextMenu: ContextMenuInterface & {listening?: boolean, listener?: EventListenerOrEventListenerObject};
  openBrowser: (url: string) => Promise<void>;
  // companion: CompanionInterface; DEPRECATED
  // worker: WorkerInterface; DEPRECATED
};

export interface DesktoprInstanceInterface {
  ready: () => boolean;
  get: () => DesktoprAPI;
}
