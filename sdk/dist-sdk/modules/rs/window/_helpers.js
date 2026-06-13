"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeWindow = exports.newWindow = exports.waitTauri = exports.tauriReadyCheck = void 0;
const sdk_1 = require("../../../sdk");
const constants_1 = require("../../../constants");
const utils_1 = require("../../../utils");
const tauriReadyCheck = () => typeof window !== "undefined" &&
    window.__TAURI__ &&
    window.Desktopr;
exports.tauriReadyCheck = tauriReadyCheck;
const waitTauri = async () => {
    const interval = 500;
    let counter = 0;
    while (counter <= 30000 && !(0, exports.tauriReadyCheck)()) {
        await (0, utils_1.wait)(interval);
        counter = counter + interval;
    }
};
exports.waitTauri = waitTauri;
const newWindow = async (core, options) => {
    if (options?.label) {
        if (options.label.trim().toLowerCase().startsWith((constants_1.COMAPNION_WINDOW_LABEL_PREFIX).trim().toLowerCase()))
            throw new Error(`[Reserved window label] '${constants_1.COMAPNION_WINDOW_LABEL_PREFIX}' is an app reserved label`);
        if (options.label.trim().toLowerCase().startsWith("main"))
            throw new Error(`[Reserved window label] 'main' is an app reserved label`);
    }
    const randomWindowLabel = `w_${Math.random()
        .toString(36)
        .substring(2, 2 + 8)}`;
    const labelToSet = (options?.label) ?? randomWindowLabel;
    try {
        const usedLabelsJSON = await sdk_1.Desktopr.globalVariables.get(constants_1.WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
        let usedLabelsObj = await JSON.parse(usedLabelsJSON);
        usedLabelsObj[labelToSet] = true;
        const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
        await sdk_1.Desktopr.globalVariables.set(constants_1.WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
    }
    catch (error) {
        console.warn("Could not update used windows labels tracker");
    }
    core.invoke("dtr_win_open", {
        label: labelToSet,
        fullscreen: (options?.fullscreen) || false,
        url: (options?.url) ?? "",
    });
};
exports.newWindow = newWindow;
const closeWindow = async (core, label) => {
    const trimmedLabel = (label?.trim()) ?? "";
    const _label = trimmedLabel ?? "main";
    try {
        if (trimmedLabel) {
            const usedLabelsJSON = await sdk_1.Desktopr.globalVariables.get(constants_1.WINDOWS_LABELS_TRACKER_VARIABLE_NAME);
            let usedLabelsObj = await JSON.parse(usedLabelsJSON);
            delete usedLabelsObj[trimmedLabel];
            const updatedUsedLabelsJSON = JSON.stringify(usedLabelsObj);
            await sdk_1.Desktopr.globalVariables.set(constants_1.WINDOWS_LABELS_TRACKER_VARIABLE_NAME, updatedUsedLabelsJSON);
        }
    }
    catch (error) {
        console.warn("Could not update used windows labels tracker");
    }
    core.invoke("dtr_win_close", { label: _label });
};
exports.closeWindow = closeWindow;
