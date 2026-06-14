import type { OfflabAPI, ClipboardInterface } from "../../../types";

export function buildClipboard(core: { invoke: OfflabAPI["invoke"] }): ClipboardInterface {
  return {
    readText: (): Promise<string> => core.invoke("dtr_clipboard_read"),
    writeText: (text: string): Promise<void> => core.invoke("dtr_clipboard_write", { text }),
  };
}
