export interface ClipboardInterface {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
}
