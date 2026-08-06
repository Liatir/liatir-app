export type DragDropPayload = {
    kind: "enter" | "hover" | "drop" | "cancel" | string;
    paths: string[];
    position?: {
        x: number;
        y: number;
    };
    [k: string]: any;
};
