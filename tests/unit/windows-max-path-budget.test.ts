import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tauriTestEnvironment } from "../e2e/support/tauri-process.mjs";

/**
 * Windows refuses paths over 260 characters unless the process opted into long paths, and the box's
 * own Python has not. A Runtime Box is a packaged conda environment, so its tree is deep before
 * Liatir adds anything: the published scGPT Windows box's deepest importable module is 115
 * characters on its own, and torch's `_strobelight.compile_time_profiler` — which importing torch
 * pulls in, and which the self-test therefore needs — is 66.
 *
 * Everything before that is Liatir's, and it is the only part anyone can shorten. Release run
 * 31320714202 lost the scGPT Windows CPU box to this after it had already been built, signed,
 * validated and published: the E2E home sat inside the checkout, the staging directory carried a
 * full UUID, and the import failed with a bare ModuleNotFoundError.
 *
 * These numbers are asserted rather than described because both fixes are invisible locally — a
 * developer on Linux or macOS can shorten neither and notice nothing.
 */
const MAX_PATH = 260;
const SEP = "\\";

/** What Liatir puts between the app data directory and the box's own tree, while staging. */
const LIATIR_STAGED_PREFIX = [
  "",
  ".liatir",
  ".main",
  "data",
  "ai-runtimes",
  "single-cell-foundation-scgpt-whole-human",
  ".s-0123abcd",
  "",
].join(SEP).length;

/** Measured from the published box: the deepest module an import of torch actually reaches. */
const DEEPEST_IMPORTED_ENTRY =
  "venv/Lib/site-packages/torch/_strobelight/compile_time_profiler.py".length;
/** Measured from the same box: the deepest importable file it contains at all. */
const DEEPEST_ENTRY =
  "venv/Lib/site-packages/torch/ao/pruning/_experimental/data_sparsifier/lightning/callbacks/_data_sparstity_utils.py".length;

/** A real installation: `%APPDATA%\app.liatir.app` for a short user name. */
const PRODUCTION_APP_DATA = "C:\\Users\\loren\\AppData\\Roaming\\app.liatir.app".length;

describe("Windows MAX_PATH budget", () => {
  it("leaves a real installation room for the deepest file in the box", () => {
    expect(PRODUCTION_APP_DATA + LIATIR_STAGED_PREFIX + DEEPEST_ENTRY).toBeLessThan(MAX_PATH);
  });

  it("keeps the E2E home short enough to install the same box", () => {
    const home = path.win32.join("C:\\Users\\loren\\AppData\\Local\\Temp", "lt-12345");
    const environment = tauriTestEnvironment(home, "win32");
    const appData = path.win32.join(environment.APPDATA, "app.liatir.app");

    // What the self-test actually reaches has to fit; the deepest file in the box is allowed to
    // exceed, exactly as it does in a real installation, because nothing imports it.
    expect(appData.length + LIATIR_STAGED_PREFIX + DEEPEST_IMPORTED_ENTRY).toBeLessThan(MAX_PATH);
  });

  it("keeps the Windows AppData layout Windows itself expects", () => {
    const environment = tauriTestEnvironment("C:\\t", "win32");

    // Not shortenable: Windows derives the local folder from the roaming one by segment, so a home
    // without these names makes app_data_dir() return UnknownPath and the app panics at
    // main.rs:142 before WebDriver comes up. Shortening them cost run 31329290387.
    expect(environment.APPDATA).toBe("C:\\t\\AppData\\Roaming");
    expect(environment.LOCALAPPDATA).toBe("C:\\t\\AppData\\Local");
    // Every declared directory is still created per run, so isolation is unchanged.
    expect(new Set(Object.values(environment)).size).toBeGreaterThan(1);
  });

  it("keeps the Windows E2E home out of the repository checkout", () => {
    const runner = readFileSync(new URL("../e2e/run-tauri-e2e.mjs", import.meta.url), "utf8");
    const cleanup = readFileSync(new URL("../support/artifact-cleanup.mjs", import.meta.url), "utf8");

    expect(runner).toContain("os.tmpdir()");
    expect(runner).toMatch(/process\.platform === 'win32'\s*\?\s*path\.join\(os\.tmpdir\(\)/);
    // Moving it out of tests/.artifacts takes it out of that pruning, so cleanup must follow it.
    expect(cleanup).toContain("os.tmpdir()");
    expect(cleanup).toMatch(/lt-/);
  });

  // Unrelated to MAX_PATH, but the same failure mode: a literal in a heavy spec that only a paid
  // native run can reach, and that nothing else re-reads when the catalog moves under it.
  it("asserts the CUDA version of the target under test, not a literal", () => {
    const spec = readFileSync(
      new URL("../e2e/specs/runtime-box-native.e2e.mjs", import.meta.url),
      "utf8",
    );

    expect(spec).toContain("reportedCudaCompatibility: TARGET_CANDIDATES[0].target.cudaVersion");
    expect(spec).not.toMatch(/reportedCudaCompatibility: '\d+\.\d+'/);
  });

  it("keeps the staging directory short, since it is pure overhead", () => {
    const source = readFileSync(
      new URL("../../src-tauri/src/bridge/runtime_boxes.rs", import.meta.url),
      "utf8",
    );

    expect(source).toContain('".s-{}"');
    // A full UUID here cost 42 characters and put the self-test over the limit.
    expect(source).not.toContain('".stg-{}", Uuid::new_v4()');
    expect(source).toContain("simple().to_string()[..8]");
    // Short names only stay safe because an existing directory is refused and retried.
    expect(source).toContain("ErrorKind::AlreadyExists");
  });
});
