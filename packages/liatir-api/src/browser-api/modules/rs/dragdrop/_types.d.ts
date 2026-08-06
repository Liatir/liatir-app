/** The payload delivered with each drag-and-drop event (enter, hover, drop, cancel). */
export type DragDropPayload = {
    kind: "enter" | "hover" | "drop" | "cancel" | string;
    paths: string[];
    position?: {
        x: number;
        y: number;
    };
    [k: string]: any;
};
