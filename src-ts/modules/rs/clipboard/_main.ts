import type { LiatirAPI, ClipboardInterface } from "../../../types";

export function buildClipboard(core: { invoke: LiatirAPI["invoke"] }): ClipboardInterface {
  return {
    readText: (): Promise<string> => core.invoke("lia_clipboard_read"),
    writeText: (text: string): Promise<void> => core.invoke("lia_clipboard_write", { text }),
  };
}
