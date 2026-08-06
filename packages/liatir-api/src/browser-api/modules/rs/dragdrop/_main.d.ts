/**
 * Drag-and-drop payload plumbing. The subscription itself is exposed through
 * `Liatir.desktop.events.onDragDrop`, which subscribes to the whole enter/drop/cancel sequence at once.
 */
import { DragDropPayload } from "../../../types";
export declare function buildDragDrop(): {
    on: (handler: (name: string, payload: DragDropPayload) => void, options?: {
        includeHover?: boolean;
    }) => Promise<() => void>;
};
