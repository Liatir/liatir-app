/**
 * Window helpers, plus the bridge's Tauri-readiness wait.
 *
 * Windows are identified by a *label*, and every open label is tracked in a global variable so a window can be
 * found again after the page that opened it is gone.
 */
import { Liatir } from "../../../sdk";
import { WINDOWS_LABELS_TRACKER_VARIABLE_NAME } from "../../../constants";
import { LiatirAPI } from "../../../liatir/_types";
import type { NewWindowOptions } from "./_types";
import { wait } from "../../../utils";

/** Both must be present: Tauri's own runtime, *and* the bridge that was injected on top of it. */
export const tauriReadyCheck = (): boolean =>
  typeof window !== "undefined" &&
  (window as any).__TAURI__ &&
  (window as any).Liatir;

/**
 * Polls until Tauri is ready, giving up after 30 seconds.
 *
 * A poll rather than an event, because there is nothing to listen *to* before Tauri exists. The timeout is what
 * distinguishes "still starting" from "not a desktop app at all" — in a plain browser this simply expires, and
 * `bridge.ts` treats that as the expected outcome rather than an error.
 */
export const waitTauri = async () => {
  const interval: number = 500;
  let counter: number = 0;
  while (counter <= 30000 && !tauriReadyCheck()) {
    await wait(interval);
    counter = counter + interval;
  }
};

/**
 * Opens a window, generating a label when the caller does not supply one.
 *
 * `main` is reserved for the app's own window: allowing a caller to claim it would let a plugin address — or
 * replace — the main window, so the name is refused outright.
 */
export const newWindow = async (
  core: { invoke: LiatirAPI["invoke"] },
  options?: NewWindowOptions
) => {
  if (options?.label){    
    if(options.label.trim().toLowerCase().startsWith("main")) throw new Error(`[Reserved window label] 'main' is an app reserved label`);
  }
  const randomWindowLabel: string = `w_${Math.random()
    .toString(36)
    .substring(2, 2 + 8)}`;

  const labelToSet = (options?.label) ?? randomWindowLabel;

  try {
    const usedLabelsJSON = await Liatir.desktop.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
    let usedLabelsObj = await JSON.parse(usedLabelsJSON);
    usedLabelsObj[labelToSet] = true;
    const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
    await Liatir.desktop.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }

  await core.invoke("lia_win_open", {
    label: labelToSet,
    fullscreen: (options?.fullscreen) || false,
    url: (options?.url) ?? "",
    width: options?.width ?? null,
    height: options?.height ?? null,
  });
};


export const closeWindow = async (
  core: { invoke: LiatirAPI["invoke"] },
  label: string
) => {

  const trimmedLabel = (label?.trim()) ?? "";
  const _label = trimmedLabel ?? "main";

  try {
    if(trimmedLabel) {
      const usedLabelsJSON = await Liatir.desktop.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
      let usedLabelsObj = await JSON.parse(usedLabelsJSON);
      delete usedLabelsObj[trimmedLabel];
      const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
      await Liatir.desktop.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
    }
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }

  core.invoke("lia_win_close", { label: _label });
};
