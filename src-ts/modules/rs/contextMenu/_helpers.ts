import { normalizeString } from "../../../helpers";
import { CmListenerCallback, CmListenerCallbackPlayload, CmNode, CmType } from "../../../types";
import { validate } from "../../../utils";

// Keep CM_TYPES as a readonly tuple and assert it matches CmType[]
export const CM_TYPES = [
  "item",
  "check",
  "separator",
  "submenu",
  "predefined",
]!;

// Narrow to CmType by inclusion
export function isCmType(value: unknown): value is CmType {
  return (
    typeof value === "string" && (CM_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Normalize any unknown value into a CmType if possible:
 * - must be a non-empty string
 * - lowercased
 * - whitespace removed
 * - must be one of CM_TYPES
 */
export function parseCmType(value: unknown): CmType | null {
  if (!validate.nonEmptyString(value)) return null;
  const normalized = normalizeString(value);
  return isCmType(normalized) ? normalized : null;
}

/**
 * Return only entries with a valid, normalized type.
 * Does not mutate input entries.
 */
export function normalizeEntries(entries: ReadonlyArray<CmNode>): CmNode[] {
  const out: CmNode[] = [];
  for (const entry of entries) {
    const t = parseCmType((entry as any)?.type);
    if (!t) continue;
    out.push({ ...entry, type: t } as CmNode);
  }
  return out;
}

const onCmClick = (ev: MouseEvent, callback: CmListenerCallback, preventDefault: boolean = true) => {
  try {
    // Prevent the native context menu when showing the custom one.
    if(preventDefault) ev.preventDefault();

    // Actual event target; text nodes are cast to HTMLElement for simplicity.
    const target = ev.target as HTMLElement | null;

    // Walk up to the nearest actionable element.
    const ancestorActionable =
      target?.closest<HTMLElement>("[data-lia-contextmenu]") ?? null;
    const descendantActionable =
      target?.querySelector<HTMLElement>("[data-lia-contextmenu]") ?? null;

    const info = {
      targetTag: target?.tagName ?? null,
      targetId: target?.id ?? null,
      targetClasses: target?.className ?? null,
      ancestorActionable,
      descendantActionable,
      // coordinate
      pageX: ev.pageX, // rispetto al documento (scorrimento incluso)
      pageY: ev.pageY,
      clientX: ev.clientX, // rispetto alla viewport
      clientY: ev.clientY,
      screenX: ev.screenX, // coordinate dello schermo
      screenY: ev.screenY,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      metaKey: ev.metaKey,
    };
    if (!window?.Liatir)
      throw new Error("[contextmenu listener] Liatir not found");
    window.Liatir.desktop.events.emit("cm:click", info);
    const callbackPlayload: CmListenerCallbackPlayload = {
        event: ev,
        ...info
      };
    if(callback) callback(callbackPlayload);
  } catch (error) {
    console.error(error);
  }
};

export const initContextMenuListener = (callback: CmListenerCallback, preventDefault: boolean = true) => {
  if (!window?.Liatir)
    throw new Error("[contextmenu listener] Liatir not found");
  const listening = window.Liatir.desktop.contextMenu.listening;
  if (listening) return console.warn("[contextmenu listener] already initialized");
  // listener globale: intercetta i click col destro su qualunque elemento della pagina
  const listener = (ev: MouseEvent) => onCmClick(ev, callback, preventDefault);
  window.Liatir.desktop.contextMenu.listener = listener as EventListenerOrEventListenerObject;
  document.addEventListener("contextmenu", listener);
  window.Liatir.desktop.contextMenu.listening = true;
};

export const removeContextMenuListener = () => {
  if (!window?.Liatir) throw new Error("[contextmenu listener] Liatir not found");
  const listening = window.Liatir.desktop.contextMenu.listening;
  if(!listening) return;
  const listener = window.Liatir.desktop.contextMenu.listener ?? (()=>{});
  document.removeEventListener("contextmenu", listener);
  window.Liatir.desktop.contextMenu.listening = false;
  window.Liatir.desktop.contextMenu.listener = undefined;
}
