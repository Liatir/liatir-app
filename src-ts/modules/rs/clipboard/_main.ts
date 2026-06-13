import type { DesktoprAPI, ClipboardInterface } from "../../../types";

export function buildClipboard(core: { invoke: DesktoprAPI["invoke"] }): ClipboardInterface {
  return {
    readText: (): Promise<string> => core.invoke("dtr_clipboard_read"),
    writeText: (text: string): Promise<void> => core.invoke("dtr_clipboard_write", { text }),
  };
}
