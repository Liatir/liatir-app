import { AppInfo, DtrPlatform } from "../types";
import { isWindowAvailable, validate } from "../utils";

export const normalizeString = (
  str: string,
  options: { toLowerCase: boolean; spacesFiller: string } = {
    toLowerCase: true,
    spacesFiller: "",
  },
): string => {
  if (!validate.nonEmptyString(str)) return "";
  let normalized = "";
  if (options.toLowerCase)
    normalized = String(str)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, options.spacesFiller);
  else normalized = String(str).trim().replace(/\s+/g, options.spacesFiller);
  return normalized;
};

export const platformSpecifcFilter = async (
  platforms: DtrPlatform[],
): Promise<void> => {
  const appInfo: AppInfo = (await window.Desktopr?.app.info()) as AppInfo;
  if (!appInfo) throw "Failed to check platform";
  const plat = appInfo.os as DtrPlatform;
  if (!platforms.includes(plat))
    throw `[unsupported platform] this method is not supported on ${plat}`;
};

export const getAppVersion = async (): Promise<string> => {
  const desktopr = window?.Desktopr;

  if (!desktopr) throw "[getAppVersion] Desktopr is not available";

  const appInfo = await desktopr.app.info();

  const version = appInfo.version;

  return version ?? "";
};
