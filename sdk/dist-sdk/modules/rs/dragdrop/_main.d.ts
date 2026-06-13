import { DragDropPayload } from "../../../types";
export declare function buildDragDrop(): {
    on: (handler: (name: string, payload: DragDropPayload) => void, options?: {
        includeHover?: boolean;
    }) => Promise<() => void>;
};
