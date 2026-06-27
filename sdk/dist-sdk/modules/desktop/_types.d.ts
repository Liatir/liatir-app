import type { NotificationsInterface } from "../rs/notifications/_types";
import type { ClipboardInterface } from "../rs/clipboard/_types";
import type { FilesInterface } from "../rs/files/_types";
import type { AppInterface } from "../rs/app/_types";
import type { WindowInterface } from "../rs/window/_types";
import type { EventsInterface } from "../rs/events/_types";
import type { ShortcutsInterface } from "../rs/shortcuts/_types";
import type { FsInterface } from "../rs/fs/_types";
import type { MenuInterface } from "../rs/menu/_types";
import type { DiagnosticsInterface } from "../rs/diagnostics/_types";
import type { NetworkInterface } from "../rs/network/_types";
import type { AutostartInterface } from "../rs/autostart/_types";
import type { BadgeInterface } from "../rs/badge/_types";
import type { ContextMenuInterface } from "../rs/contextMenu/_types";
import type { GlobalVariablesInterface } from "../rs/globalVariables/_types";
export type DesktopInterface = {
    notifications: NotificationsInterface;
    clipboard: ClipboardInterface;
    /** File picker dialogs — use `files.open()` to get file paths for bio tools */
    files: FilesInterface;
    app: AppInterface;
    window: WindowInterface;
    events: EventsInterface;
    globalShortcut: ShortcutsInterface;
    /** Sandboxed persistent/cache storage under ~/.liatir */
    fs: FsInterface;
    menu: MenuInterface;
    diagnostics: DiagnosticsInterface;
    network: NetworkInterface;
    autostart: AutostartInterface;
    /** macOS only — undefined on other platforms */
    badge?: BadgeInterface;
    contextMenu: ContextMenuInterface & {
        listening?: boolean;
        listener?: EventListenerOrEventListenerObject;
    };
    globalVariables: GlobalVariablesInterface;
};
