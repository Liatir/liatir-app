import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as child_process from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { buildDevBundle, type BuildResult } from "./build.js";

const execFileAsync = promisify(child_process.execFile);
const PLUGIN_DOCS_URL = "https://liatir.com/plugins";
const LIATIR_BUNDLE_ID = "app.liatir.app";

interface IpcInfo {
  port: number;
  token: string;
}

interface InvokeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

class IncompatibleLiatirAppError extends Error {}

interface MacAppCandidate {
  path: string;
  version: string | null;
  bundleVersion: string | null;
}

function incompatibleLiatirAppMessage(): string {
  return (
    `The running Liatir desktop app does not support \`liatir dev\` Dev Runner sessions.\n\n` +
    `Update Liatir to a build that includes Plugin Dev Runner support, then retry \`liatir dev\`.\n\n` +
    `Docs: ${PLUGIN_DOCS_URL}`
  );
}

const WATCH_INTERVAL_MS = 800;
const IGNORED_DIRS = new Set([
  ".git",
  ".lia-dev",
  ".liatir",
  ".mypy_cache",
  ".pytest_cache",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "target",
  "venv",
]);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseVersionParts(value: string | null | undefined): number[] {
  return String(value ?? "")
    .match(/\d+/g)
    ?.slice(0, 4)
    .map((part) => Number(part)) ?? [];
}

function compareVersionsDesc(left: string | null, right: string | null): number {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const delta = (b[i] ?? 0) - (a[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

async function plistValue(plistPath: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function macAppCandidate(appPath: string): Promise<MacAppCandidate | null> {
  const infoPath = path.join(appPath, "Contents", "Info.plist");
  try {
    const stat = await fs.stat(infoPath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const bundleId = await plistValue(infoPath, "CFBundleIdentifier");
  if (bundleId !== LIATIR_BUNDLE_ID) return null;
  return {
    path: appPath,
    version: await plistValue(infoPath, "CFBundleShortVersionString"),
    bundleVersion: await plistValue(infoPath, "CFBundleVersion"),
  };
}

async function macLiatirAppCandidates(): Promise<MacAppCandidate[]> {
  const raw = new Set<string>();
  const explicitPath = process.env["LIATIR_APP_PATH"];
  if (explicitPath) raw.add(explicitPath);

  for (const knownPath of [
    "/Applications/Liatir.app",
    "/Applications/Liatir dev.app",
    path.join(os.homedir(), "Applications", "Liatir.app"),
    path.join(os.homedir(), "Applications", "Liatir dev.app"),
  ]) {
    raw.add(knownPath);
  }

  try {
    const { stdout } = await execFileAsync("mdfind", [`kMDItemCFBundleIdentifier == "${LIATIR_BUNDLE_ID}"`]);
    for (const item of stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      raw.add(item);
    }
  } catch {
    // Spotlight may be unavailable or disabled. Known app paths are still tried.
  }

  const candidates = (await Promise.all([...raw].map((item) => macAppCandidate(item))))
    .filter((item): item is MacAppCandidate => item !== null);

  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.path)) return false;
      seen.add(candidate.path);
      return true;
    })
    .sort((a, b) => {
      const byVersion = compareVersionsDesc(a.version, b.version);
      if (byVersion !== 0) return byVersion;
      const byBundleVersion = compareVersionsDesc(a.bundleVersion, b.bundleVersion);
      if (byBundleVersion !== 0) return byBundleVersion;
      return a.path.localeCompare(b.path);
    });
}

async function parseDevInputs(args: string[]): Promise<Record<string, unknown>> {
  const inlineIdx = args.findIndex((a) => a === "--input" || a === "--inputs");
  if (inlineIdx >= 0) {
    const raw = args[inlineIdx + 1];
    if (!raw) {
      console.error("Missing JSON value after --input.");
      process.exit(1);
    }
    return JSON.parse(raw) as Record<string, unknown>;
  }

  const inlineEq = args.find((a) => a.startsWith("--input=") || a.startsWith("--inputs="));
  if (inlineEq) {
    return JSON.parse(inlineEq.slice(inlineEq.indexOf("=") + 1)) as Record<string, unknown>;
  }

  const fileIdx = args.findIndex((a) => a === "--input-file" || a === "--inputs-file");
  if (fileIdx >= 0) {
    const file = args[fileIdx + 1];
    if (!file) {
      console.error("Missing file path after --input-file.");
      process.exit(1);
    }
    return JSON.parse(await fs.readFile(path.resolve(file), "utf-8")) as Record<string, unknown>;
  }

  const fileEq = args.find((a) => a.startsWith("--input-file=") || a.startsWith("--inputs-file="));
  if (fileEq) {
    const file = fileEq.slice(fileEq.indexOf("=") + 1);
    return JSON.parse(await fs.readFile(path.resolve(file), "utf-8")) as Record<string, unknown>;
  }

  return {};
}

function appDataDirCandidates(): string[] {
  const envIpcFile = process.env["LIATIR_IPC_FILE"];
  const envIpcDir = process.env["LIATIR_IPC_DIR"];
  const candidates: string[] = [];

  if (envIpcFile) candidates.push(path.dirname(envIpcFile));
  if (envIpcDir) candidates.push(envIpcDir);

  switch (process.platform) {
    case "darwin": {
      const appSupport = path.join(os.homedir(), "Library", "Application Support");
      candidates.push(path.join(appSupport, "app.liatir.app"));
      candidates.push(path.join(appSupport, "liatir"));
      candidates.push(path.join(appSupport, "Liatir"));
      break;
    }
    case "win32": {
      const appData = process.env["APPDATA"] ?? os.homedir();
      candidates.push(path.join(appData, "app.liatir.app"));
      candidates.push(path.join(appData, "liatir"));
      candidates.push(path.join(appData, "Liatir"));
      break;
    }
    default: {
      const dataHome = process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");
      candidates.push(path.join(dataHome, "app.liatir.app"));
      candidates.push(path.join(dataHome, "liatir"));
      candidates.push(path.join(dataHome, "Liatir"));
      break;
    }
  }

  return [...new Set(candidates)];
}

async function readIpcInfo(): Promise<IpcInfo> {
  const envIpcFile = process.env["LIATIR_IPC_FILE"];
  const portFiles = envIpcFile
    ? [envIpcFile, ...appDataDirCandidates().map((dir) => path.join(dir, ".ipc"))]
    : appDataDirCandidates().map((dir) => path.join(dir, ".ipc"));

  for (const portFile of [...new Set(portFiles)]) {
    try {
      const content = await fs.readFile(portFile, "utf-8");
      return JSON.parse(content) as IpcInfo;
    } catch {
      // Try the next known Liatir app data location.
    }
  }

  throw new Error(
    `Liatir desktop app is required for \`liatir dev\`.\n\n` +
    `\`liatir dev\` runs your temporary plugin inside Liatir's Dev Runner, so the desktop app must be installed and running.\n` +
    `Install or open Liatir, then run \`liatir dev\` again.\n\n` +
    `Docs: ${PLUGIN_DOCS_URL}\n\n` +
    `Could not find Liatir's local IPC file. Checked:\n${portFiles.map((file) => `- ${file}`).join("\n")}`
  );
}

async function launchLiatirBestEffort(): Promise<void> {
  try {
    if (process.platform === "darwin") {
      const candidates = await macLiatirAppCandidates();
      if (candidates[0]) {
        await execFileAsync("open", [candidates[0].path]);
        return;
      }
      await execFileAsync("open", ["-b", LIATIR_BUNDLE_ID]);
      return;
    }
    if (process.platform === "win32") {
      child_process.spawn("cmd", ["/c", "start", "", "Liatir"], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return;
    }
    child_process.spawn("liatir", [], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Best-effort only; the final error explains how to continue.
  }
}

async function probeIpc(ipc: IpcInfo): Promise<"ready" | "unreachable" | "incompatible"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`http://127.0.0.1:${ipc.port}/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ipc.token}`,
      },
      body: JSON.stringify({
        cmd: "lia_plugin_dev_get_session",
        payload: { sessionId: "__liatir_cli_probe__" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return "unreachable";
    const data = (await res.json()) as InvokeResponse<unknown>;
    if (data.ok) return "ready";
    if ((data.error ?? "").includes("unknown command")) return "incompatible";
    return "ready";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timeout);
  }
}

async function readLiveIpcInfo(): Promise<IpcInfo> {
  const ipc = await readIpcInfo();
  const probe = await probeIpc(ipc);
  if (probe === "ready") return ipc;
  if (probe === "incompatible") {
    throw new IncompatibleLiatirAppError(incompatibleLiatirAppMessage());
  }
  throw new Error("Found a stale Liatir IPC file, but the desktop app is not responding.");
}

async function waitForIpc(): Promise<IpcInfo> {
  try {
    return await readLiveIpcInfo();
  } catch (error) {
    if (error instanceof IncompatibleLiatirAppError) throw error;
    await launchLiatirBestEffort();
  }

  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < 15_000) {
    try {
      return await readLiveIpcInfo();
    } catch (error) {
      if (error instanceof IncompatibleLiatirAppError) throw error;
      lastError = error;
      await wait(500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function invoke<T>(ipc: IpcInfo, cmd: string, payload?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${ipc.port}/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ipc.token}`,
      },
      body: JSON.stringify({ cmd, payload }),
    });
  } catch (error) {
    throw new Error(
      `Liatir IPC is not reachable while running ${cmd}. ` +
      `Make sure the Liatir desktop app is open and up to date, then retry \`liatir dev\`.\n` +
      `${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!res.ok) {
    throw new Error(`Liatir IPC HTTP ${res.status} for ${cmd}`);
  }

  const data = (await res.json()) as InvokeResponse<T>;
  if (!data.ok) {
    if ((data.error ?? "").includes("unknown command") && cmd.startsWith("lia_plugin_dev_")) {
      throw new Error(incompatibleLiatirAppMessage());
    }
    throw new Error(data.error ?? `${cmd} failed`);
  }
  return data.result as T;
}

async function collectProjectFingerprint(root: string): Promise<string> {
  const rows: string[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      const rel = path.relative(root, filePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(filePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(filePath);
      rows.push(`${rel}:${stat.size}:${Math.round(stat.mtimeMs)}`);
    }
  }

  await walk(root);
  return rows.sort().join("\n");
}

function compactError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export async function dev(args: string[] = []) {
  const cwd = process.cwd();
  const initialInputs = await parseDevInputs(args);
  const hasInitialInputs = Object.keys(initialInputs).length > 0;
  const sessionId = randomUUID();

  console.log("[liatir dev] building temporary dev bundle...");
  const initialBuildId = randomUUID();
  const initialResult = await buildDevBundle();

  console.log("[liatir dev] connecting to Liatir...");
  const ipc = await waitForIpc();

  let opened = false;
  let building = false;
  let lastFingerprint = "";
  let stopped = false;

  async function publishError(error: unknown, buildId: string) {
    const message = compactError(error);
    console.error(`[liatir dev] build failed:\n${message}`);
    await invoke(ipc, "lia_plugin_dev_set_error", {
      sessionId,
      projectDir: cwd,
      error: message,
      buildId,
      initialInputs: hasInitialInputs ? initialInputs : null,
    });
    if (!opened) {
      await invoke(ipc, "lia_plugin_dev_open_session", { sessionId });
      opened = true;
    }
  }

  async function publishResult(result: BuildResult, buildId: string) {
    await invoke(ipc, "lia_plugin_dev_update_session", {
      sessionId,
      projectDir: cwd,
      bundlePath: result.path,
      buildId,
      initialInputs: hasInitialInputs ? initialInputs : null,
    });
    if (!opened) {
      await invoke(ipc, "lia_plugin_dev_open_session", { sessionId });
      opened = true;
    }
    console.log(`[liatir dev] published ${result.runtime} bundle to Liatir Dev Runner.`);
  }

  async function buildAndPublish() {
    if (building) return;
    building = true;
    const buildId = randomUUID();
    try {
      const result = await buildDevBundle();
      await publishResult(result, buildId);
    } catch (error) {
      await publishError(error, buildId);
    } finally {
      building = false;
    }
  }

  async function cleanup() {
    if (stopped) return;
    stopped = true;
    try {
      await invoke(ipc, "lia_plugin_dev_end_session", { sessionId });
    } catch {
      // The app may already be closed.
    }
  }

  // Signal handlers must return void, so the async cleanup runs in a
  // fire-and-forget IIFE (the process exits once it settles).
  process.on("SIGINT", () => {
    void (async () => {
      console.log("\n[liatir dev] stopping...");
      await cleanup();
      process.exit(0);
    })();
  });
  process.on("SIGTERM", () => {
    void (async () => {
      await cleanup();
      process.exit(0);
    })();
  });

  console.log("[liatir dev] connected to Liatir. Publishing temporary dev bundle...");
  await publishResult(initialResult, initialBuildId);
  lastFingerprint = await collectProjectFingerprint(cwd);
  console.log("[liatir dev] watching project files. Use the Dev Runner window to run the plugin. Press Ctrl+C to stop.");

  while (!stopped) {
    await wait(WATCH_INTERVAL_MS);
    const nextFingerprint = await collectProjectFingerprint(cwd);
    if (nextFingerprint !== lastFingerprint) {
      lastFingerprint = nextFingerprint;
      await buildAndPublish();
    }

    if (opened) {
      const session = await invoke<unknown>(ipc, "lia_plugin_dev_get_session", { sessionId }).catch(() => null);
      if (session === null) {
        stopped = true;
      }
    }
  }

  await cleanup();
}
