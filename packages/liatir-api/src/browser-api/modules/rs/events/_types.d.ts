/**
 * Event payloads and the events interface. Every subscription returns an unsubscribe function, which is what
 * makes a listener's lifetime the caller's to control.
 */
import type { DragDropPayload } from "../dragdrop/_types";
import type { Unlisten } from "./_helpers";
export interface EventsInterface {
    emit: (event: string, payload?: unknown) => Promise<unknown>;
    emitToAll: (event: string, payload?: unknown) => Promise<unknown>;
    emitTo: (windowLabel: string, event: string, payload?: unknown) => Promise<unknown>;
    on: (event: string, handler: (payload: any) => void) => Promise<Unlisten>;
    once: (event: string) => Promise<any>;
    onMany: (events: string[], handler: (name: string, payload: any) => void) => Promise<Unlisten>;
    onNetworkStatus: (handler: (payload: any) => void) => Promise<Unlisten>;
    onDeeplink: (handler: (payload: any) => void) => Promise<Unlisten>;
    onShortcut: (handler: (payload: any) => void) => Promise<Unlisten>;
    onDragDrop: (handler: (name: string, payload: DragDropPayload) => void, options?: {
        includeHover?: boolean;
    }) => Promise<Unlisten>;
    onMenuEvent: (handler: (payload: any) => void) => Promise<Unlisten>;
    onTrayIconEvent: (handler: (payload: any) => void) => Promise<Unlisten>;
}
