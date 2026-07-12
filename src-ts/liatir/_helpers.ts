/** Small shared helpers for the bridge's own use. */
import { AppInfo, LiaPlatform } from "../types";
import { isWindowAvailable, validate } from "../utils";

/** Trims, collapses runs of whitespace, and (by default) lowercases. Used to normalise identifiers. */
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

/**
 * Guard for platform-specific API methods.
 *
 * Some capabilities exist only on some operating systems (a dock badge, say). Calling one where it does not
 * exist would otherwise fail deep in Rust with an opaque error; throwing here names the platform and the
 * method, so a plugin author sees immediately why their call cannot work.
 */
export const platformSpecifcFilter = async (
  platforms: LiaPlatform[],
): Promise<void> => {
  const appInfo: AppInfo = (await window.Liatir?.desktop.app.info()) as AppInfo;
  if (!appInfo) throw "Failed to check platform";
  const plat = appInfo.os as LiaPlatform;
  if (!platforms.includes(plat))
    throw `[unsupported platform] this method is not supported on ${plat}`;
};

export const getAppVersion = async (): Promise<string> => {
  const liatir = window?.Liatir;

  if (!liatir) throw "[getAppVersion] Liatir is not available";

  const appInfo = await liatir.desktop.app.info();

  const version = appInfo.version;

  return version ?? "";
};
