/**
 * The app's version. The root package.json is its only source: the release builds, the conf
 * scripts that write it into tauri.conf.json, Cargo.toml and the bridge constants, and the public
 * site all read it from there, so a released app and the repository can never disagree.
 */
import { readFileSync } from 'node:fs';

export const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/**
 * The version a build may use: package.json's. An APP_VERSION already in the environment is
 * accepted only when it is the same, so a release can name its version explicitly but never
 * contradict the repository.
 */
export function packageAppVersion(environment = process.env) {
  if (environment.APP_VERSION && environment.APP_VERSION !== APP_VERSION) {
    throw new Error(`APP_VERSION ${environment.APP_VERSION} does not match package.json (${APP_VERSION}); change the version in package.json`);
  }
  return APP_VERSION;
}
