/** Shapes for system clipboard access. */
export interface ClipboardInterface {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
}
