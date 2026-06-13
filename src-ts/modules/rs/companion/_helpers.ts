import { DesktoprAPI, CompanionConfig } from "../../../types"

/**
 * Validate whether a string is:
 * - a valid absolute URL (http/https)
 * - a valid internal path ("/something")
 *
 * Returns:
 *  - { kind: "url", value }
 *  - { kind: "path", value }
 *  - { kind: "invalid" }
 */
export function validateUrlOrPath(input?: string): 
  { kind: "url"|"path"|"invalid"; value?: string; }
{
  if (!input || typeof input !== "string") {
    return { kind: "invalid" };
  }

  const trimmed = input.trim();

  // 1) Check absolute URL
  try {
    const u = new URL(trimmed);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return { kind: "url", value: trimmed };
    }
  } catch {
    // non è una URL assoluta
  }

  // 2) Check internal path (must start with "/", cannot contain spaces)
  if (
    trimmed.startsWith("/") &&
    !trimmed.includes(" ") &&
    /^[a-zA-Z0-9._~!$&'()*+,;=:@\/-]+$/.test(trimmed)
  ) {
    return { kind: "path", value: trimmed };
  }

  // 3) Invalid
  return { kind: "invalid" };
}

export const launchCompanion = async (core: { invoke: DesktoprAPI["invoke"] }, config?: CompanionConfig) => {
	const urlValidation = validateUrlOrPath(config?.url);
	if(config?.url && urlValidation.kind=="invalid") throw new Error(`Invalid URL [${config.url}]`);
	
	let appConfig = config;
	if(appConfig && config?.url) appConfig["url"] = urlValidation.value || "";

    core.invoke("dtr_launch_companion", { appConfig });
}