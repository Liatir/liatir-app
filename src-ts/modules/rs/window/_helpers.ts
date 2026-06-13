import { Desktopr } from "../../../sdk";
import { COMAPNION_WINDOW_LABEL_PREFIX, WINDOWS_LABELS_TRACKER_VARIABLE_NAME } from "../../../constants";
import { DesktoprAPI } from "../../../desktopr/_types";
import { wait } from "../../../utils";

export const tauriReadyCheck = (): boolean =>
  typeof window !== "undefined" &&
  (window as any).__TAURI__ &&
  (window as any).Desktopr;

export const waitTauri = async () => {
  const interval: number = 500;
  let counter: number = 0;
  while (counter <= 30000 && !tauriReadyCheck()) {
    await wait(interval);
    counter = counter + interval;
  }
};

export const newWindow = async (
  core: { invoke: DesktoprAPI["invoke"] },
  options?: {
    label?: string;
    fullscreen?: boolean;
    url?: string;
  }
) => {
  if (options?.label){
    if(options.label.trim().toLowerCase().startsWith((COMAPNION_WINDOW_LABEL_PREFIX).trim().toLowerCase())) throw new Error(`[Reserved window label] '${COMAPNION_WINDOW_LABEL_PREFIX}' is an app reserved label`);
    
    if(options.label.trim().toLowerCase().startsWith("main")) throw new Error(`[Reserved window label] 'main' is an app reserved label`);
  }
  const randomWindowLabel: string = `w_${Math.random()
    .toString(36)
    .substring(2, 2 + 8)}`;

  const labelToSet = (options?.label) ?? randomWindowLabel;

  try {
    const usedLabelsJSON = await Desktopr.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
    let usedLabelsObj = await JSON.parse(usedLabelsJSON);
    usedLabelsObj[labelToSet] = true;
    const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
    await Desktopr.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }

  core.invoke("dtr_win_open", {
    label: labelToSet,
    fullscreen: (options?.fullscreen) || false,
    url: (options?.url) ?? "",
  });
};


export const closeWindow = async (
  core: { invoke: DesktoprAPI["invoke"] },
  label: string
) => {

  const trimmedLabel = (label?.trim()) ?? "";
  const _label = trimmedLabel ?? "main";

  try {
    if(trimmedLabel) {
      const usedLabelsJSON = await Desktopr.globalVariables.get(WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
      let usedLabelsObj = await JSON.parse(usedLabelsJSON);
      delete usedLabelsObj[trimmedLabel];
      const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
      await Desktopr.globalVariables.set(WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
    }
  } catch (error) {
    console.warn("Could not update used windows labels tracker");
  }

  core.invoke("dtr_win_close", { label: _label });
};