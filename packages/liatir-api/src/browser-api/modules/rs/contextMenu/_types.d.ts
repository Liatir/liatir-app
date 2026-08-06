/**
 * Shapes for native context menus: a menu is a tree of nodes (items, separators, submenus), so the type is
 * recursive — which is what lets a menu of arbitrary depth be described as plain data.
 */
export type CmType = "item" | "check" | "separator" | "submenu" | "predefined";
export type CmItem = {
    type: Extract<CmType, "item">;
    id: string;
    text: string;
    enabled?: boolean;
    shortcut?: string;
};
export type CmCheck = {
    type: Extract<CmType, "check">;
    id: string;
    text: string;
    checked?: boolean;
    enabled?: boolean;
};
export type CmSeparator = {
    type: Extract<CmType, "separator">;
};
export type CmSubmenu = {
    type: Extract<CmType, "submenu">;
    text: string;
    items: CmNode[];
};
export type CmPredefined = {
    type: Extract<CmType, "predefined">;
    kind: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "delete" | "minimize" | "closeWindow" | "zoom" | "hide" | "hideOthers" | "showAll" | "quit" | "services";
};
export type CmNode = CmItem | CmCheck | CmSeparator | CmSubmenu | CmPredefined;
export type CmPopupOptions = {
    window?: string;
    atLogical?: [number, number];
    atPhysical?: [number, number];
    dismissOutside?: boolean;
    timeoutMs?: number;
};
export type CmListenerCallbackPlayload = {
    event: MouseEvent;
    targetTag: string | null;
    targetId: string | null;
    targetClasses: string | null;
    ancestorActionable: HTMLElement | null;
    descendantActionable: HTMLElement | null;
    pageX: number;
    pageY: number;
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
};
export type CmListenerCallback = (playload: CmListenerCallbackPlayload) => (unknown | Promise<unknown>);
export interface ContextMenuInterface {
    show: (entries: CmNode[], options: CmPopupOptions) => Promise<string>;
    handler: {
        init: (callback: CmListenerCallback, preventDefault?: boolean) => void;
        remove: () => void;
    };
}
