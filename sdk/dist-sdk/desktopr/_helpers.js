"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAppVersion = exports.platformSpecifcFilter = exports.normalizeString = void 0;
const utils_1 = require("../utils");
const normalizeString = (str, options = {
    toLowerCase: true,
    spacesFiller: "",
}) => {
    if (!utils_1.validate.nonEmptyString(str))
        return "";
    let normalized = "";
    if (options.toLowerCase)
        normalized = String(str)
            .toLowerCase()
            .trim()
            .replace(/\s+/g, options.spacesFiller);
    else
        normalized = String(str).trim().replace(/\s+/g, options.spacesFiller);
    return normalized;
};
exports.normalizeString = normalizeString;
const platformSpecifcFilter = async (platforms) => {
    const appInfo = (await window.Desktopr?.app.info());
    if (!appInfo)
        throw "Failed to check platform";
    const plat = appInfo.os;
    if (!platforms.includes(plat))
        throw `[unsupported platform] this method is not supported on ${plat}`;
};
exports.platformSpecifcFilter = platformSpecifcFilter;
const getAppVersion = async () => {
    const desktopr = window?.Desktopr;
    if (!desktopr)
        throw "[getAppVersion] Desktopr is not available";
    const appInfo = await desktopr.app.info();
    const version = appInfo.version;
    return version ?? "";
};
exports.getAppVersion = getAppVersion;
