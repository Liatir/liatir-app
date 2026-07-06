export type MenuCustomItemEventPlayload = {
    id: string;
    [key: string]: any;
};
export interface MenuInterface {
    setEnabled: (id: string, enabled: boolean) => Promise<void>;
    setChecked: (id: string, checked: boolean) => Promise<void>;
    init: {
        fromConfig: (config: MenuConfig) => Promise<void>;
        fromJsonFile: (filePath: string) => Promise<void>;
    };
}
/** Supported platforms */
export type MenuPlatform = "macos" | "windows" | "linux";
/** Interaction model for custom items */
export type MenuInteraction = "click" | "check";
/** Known predefined items mapped in Rust */
export type PredefinedItem = "quit" | "close_window" | "copy" | "cut" | "paste" | "select_all" | "minimize" | "maximize" | "about" | "services" | "hide" | "hide_others" | "show_all";
/** Allowed section identifiers (mirrors your builder and Rust enum) */
export type MenuSectionId = "macosRoot" | "file" | "edit" | "view" | "window" | "tray";
/** Custom clickable or checkable item */
export interface MenuCustomItem {
    /** Discriminator */
    type: "custom";
    /** Unique id you’ll receive on click/check events */
    id: string;
    /** Visible label */
    label: string;
    /** Enable/disable item (default: true) */
    enabled?: boolean;
    /** "click" or "check" (default: "click") */
    interaction?: MenuInteraction;
    /** Initial check state (only for interaction: "check") */
    checked?: boolean;
    /** Optional accelerator, e.g. "CmdOrCtrl+R" */
    accelerator?: string;
}
/** Predefined native item provided by Tauri */
export interface MenuPredefinedItem {
    type: "predefined";
    /** One of the known predefined items */
    item: PredefinedItem;
    /** Optional custom label to override default (where applicable) */
    customLabel?: string;
}
/** Visual separator */
export interface MenuSeparatorItem {
    type: "separator";
}
/** Submenu (recursive) */
export interface MenuSubmenuItem {
    type: "submenu";
    /** Optional id for the submenu */
    id?: string;
    /** Submenu label */
    label: string;
    /** Nested items (recursive) */
    items: MenuItem[];
}
/** Any possible item */
export type MenuItem = MenuCustomItem | MenuPredefinedItem | MenuSeparatorItem | MenuSubmenuItem;
/** A section corresponds to a top-level menu (e.g., File, Edit, View, etc.) */
export interface MenuSectionConfig {
    /** Section identifier (e.g., "file", "edit", "view", "window", "macosRoot", "tray") */
    section: MenuSectionId;
    /** Items inside this section */
    items: MenuItem[];
}
/** Full menu configuration (runtime-applied or build-time equivalent) */
export interface MenuConfig {
    /** Master switch for the whole menu */
    enabled: boolean;
    /** Platforms where this menu should be active */
    platforms: MenuPlatform[];
    /** macOS application menu (only shown on macOS) */
    macosRoot?: MenuSectionConfig;
    /** Standard sections */
    file?: MenuSectionConfig;
    edit?: MenuSectionConfig;
    view?: MenuSectionConfig;
    window?: MenuSectionConfig;
    /** Tray section (interpreted by your tray builder) */
    tray?: MenuSectionConfig;
}
