import { Liatir } from "../../../sdk";
import { WINDOWS_LABELS_TRACKER_VARIABLE_NAME } from "../../../constants";
import { LiatirAPI } from "../../../liatir/_types";
import { wait } from "../../../utils";

export const tauriReadyCheck = (): boolean =>
  typeof window !== "undefined" &&
  (window as any).__TAURI__ &&
  (window as any).Liatir;

export const waitTauri = async () => {
  const interval: number = 500;
  let counter: number = 0;
  while (counter <= 30000 && !tauriReadyCheck()) {
    await wait(interval);
    counter = counter + interval;
  }
};

export const newWindow = async (
  core: { invoke: LiatirAPI["invoke"] },
  options?: {
    label?: string;
    fullscreen?: boolean;
    url?: string;
  }
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
