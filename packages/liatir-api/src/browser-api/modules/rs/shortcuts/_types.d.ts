/** Shapes for OS-wide keyboard shortcuts. */
export type ShortcutEventPayload = {
    accelerator: string;
    shortcut: string;
    id: number;
    state: "Pressed" | "Released" | string;
    [key: string]: any;
};
export interface ShortcutsInterface {
    register: (accelerator: string, cb: (e: any) => void, options?: {
        emitEvent?: boolean;
    }) => Promise<void>;
    unregister: (accelerator: string) => Promise<void>;
    unregisterAll: () => Promise<void>;
    isRegistered: (accelerator: string) => Promise<boolean>;
}
