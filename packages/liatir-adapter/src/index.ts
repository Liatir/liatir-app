import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { buildAlign, type AlignNamespace } from "./bio/align";
import { buildQc, type QcNamespace } from "./bio/qc";
import { buildVariants, type VariantsNamespace } from "./bio/variants";

// Bridge areas — reused (NOT duplicated) from the single source of truth in
// src-ts. The same buildX(core) functions power window.Liatir in the browser;
// here we compose them with the IPC `invoke`. tsup bundles them into dist.
// GUI-only areas (window, menu, shortcuts, badge, autostart, contextMenu) are
// intentionally excluded — they have no meaning in a headless Node process.
import { buildFs } from "../../../src-ts/modules/rs/fs/_main";
import { buildFiles } from "../../../src-ts/modules/rs/files/_main";
import { buildEvents } from "../../../src-ts/modules/rs/events/_main";
import { buildAppInfo } from "../../../src-ts/modules/rs/app/_main";
import { buildGlobVar } from "../../../src-ts/modules/rs/globalVariables/_main";
import { buildNetwork } from "../../../src-ts/modules/rs/network/_main";
import { buildClipboard } from "../../../src-ts/modules/rs/clipboard/_main";
import { buildNotifications } from "../../../src-ts/modules/rs/notifications/_main";
import { buildDiagnostics } from "../../../src-ts/modules/rs/diagnostics/_main";
import { buildPlugins } from "../../../src-ts/modules/rs/plugins/_main";
import { buildSidecar } from "../../../src-ts/modules/rs/sidecar/_main";
import type { FsInterface } from "../../../src-ts/modules/rs/fs/_types";
import type { FilesInterface } from "../../../src-ts/modules/rs/files/_types";
import type { EventsInterface } from "../../../src-ts/modules/rs/events/_types";
import type { AppInterface } from "../../../src-ts/modules/rs/app/_types";
import type { GlobalVariablesInterface } from "../../../src-ts/modules/rs/globalVariables/_types";
import type { NetworkInterface } from "../../../src-ts/modules/rs/network/_types";
import type { ClipboardInterface } from "../../../src-ts/modules/rs/clipboard/_types";
import type { NotificationsInterface } from "../../../src-ts/modules/rs/notifications/_types";
import type { DiagnosticsInterface } from "../../../src-ts/modules/rs/diagnostics/_types";
import type { PluginsInterface } from "../../../src-ts/modules/rs/plugins/_types";
import type { SidecarInterface } from "../../../src-ts/modules/rs/sidecar/_types";
import { buildJobs } from "../../../src-ts/modules/rs/jobs/_main";
import { buildDeps } from "../../../src-ts/modules/rs/deps/_main";
import type {
  JobEntry,
  JobStatus,
  SpawnResult,
  SpawnOptions,
  JobsInterface,
} from "../../../src-ts/modules/rs/jobs/_types";
import type {
  DepCheckResult,
  DepsInterface,
} from "../../../src-ts/modules/rs/deps/_types";

// ── Bridge types — reused from src-ts (single source of truth, no mirroring) ─
// jobs/deps are the SAME interfaces the browser SDK uses, re-exported here.
export type {
  JobEntry,
  JobStatus,
  SpawnResult,
  SpawnOptions,
  JobsInterface,
  DepCheckResult,
  DepsInterface,
};

/**
 * Buffered stdout/stderr lines — Node-specific. The browser SDK streams job
 * output via Tauri events; a headless Node process has no event channel, so it
 * polls `lia_jobs_get_output` instead. This type has no browser counterpart.
 */
export interface JobOutput {
  stdout: string[];
  stderr: string[];
  stdoutTotal: number;
  stderrTotal: number;
}

// ── IPC info file ────────────────────────────────────────────────────────────

interface IpcInfo {
  port: number;
  token: string;
}

function appDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "liatir");
    case "win32":
      return path.join(process.env["APPDATA"] ?? os.homedir(), "liatir");
    default:
      return path.join(os.homedir(), ".local", "share", "liatir");
  }
}

async function readIpcInfo(): Promise<IpcInfo> {
  const portFile = path.join(appDataDir(), ".ipc");
  try {
    const content = await fs.readFile(portFile, "utf-8");
    return JSON.parse(content) as IpcInfo;
  } catch {
    throw new Error(
      `[liatir-adapter] Liatir app is not running or IPC not ready.\n` +
      `Expected file: ${portFile}\n` +
      `Start the Liatir desktop app first.`
    );
  }
}

// ── HTTP invoke ──────────────────────────────────────────────────────────────

async function httpInvoke<T>(
  ipc: IpcInfo,
  cmd: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${ipc.port}/invoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ipc.token}`,
    },
    body: JSON.stringify({ cmd, payload }),
  });

  if (!res.ok) {
    throw new Error(`[liatir-adapter] HTTP ${res.status} for ${cmd}`);
  }

  const data = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!data.ok) {
    throw new Error(data.error ?? `[liatir-adapter] ${cmd} failed`);
  }
  return data.result as T;
}

// ── Liatir namespace (subset available in Node.js) ──────────────────────────

/**
 * Jobs in Node = the reused JobsInterface (spawn/kill/status/list/clearDone)
 * plus two polling helpers that replace the browser's event-based streaming.
 */
export type LiatirNodeJobs = JobsInterface & {
  /** Buffered stdout/stderr lines since an offset (for polling). */
  getOutput(jobId: string, since?: number): Promise<JobOutput>;
  /** Spawn, wait for exit, and stream output via polling callbacks. */
  run(
    cmd: string,
    args?: string[],
    opts?: {
      cwd?: string;
      onStdout?: (line: string) => void;
      onStderr?: (line: string) => void;
    }
  ): Promise<JobEntry>;
};

export interface LiatirNodePaths {
  appData: string;
  appConfig: string;
  appLog: string;
  home: string;
  data: string;
  temp: string;
}

export interface LiatirNode {
  /** Async process manager — spawn, stream, kill any system binary. */
  jobs: LiatirNodeJobs;
  /** Check whether system tools are installed and get their versions. */
  deps: DepsInterface;
  /** Bio analysis namespaces (scipy-style typed wrappers). */
  align: AlignNamespace;
  qc: QcNamespace;
  variants: VariantsNamespace;
  /** Full Liatir bridge — same interfaces as window.Liatir.desktop, reused from src-ts (no duplication). */
  desktop: {
    fs: FsInterface;
    files: FilesInterface;
    events: EventsInterface;
    app: AppInterface;
    globalVariables: GlobalVariablesInterface;
    network: NetworkInterface;
    clipboard: ClipboardInterface;
    notifications: NotificationsInterface;
    diagnostics: DiagnosticsInterface;
  };
  /** WASM custom-tool runtime (reused from src-ts). */
  plugins: PluginsInterface;
  /** Sidecar process runner (reused from src-ts). */
  sidecar: SidecarInterface;
  /** App filesystem paths. */
  paths(): Promise<LiatirNodePaths>;
  /** Raw invoke — calls any supported Tauri command. */
  invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createLiatir(): Promise<LiatirNode> {
  const ipc = await readIpcInfo();
  const invoke = <T>(cmd: string, payload?: Record<string, unknown>) =>
    httpInvoke<T>(ipc, cmd, payload);

  // The `core` shape every bridge buildX() expects — only needs `invoke`.
  const core = { invoke };

  // jobs/deps reuse the browser SDK builders; Node adds polling-based streaming
  // (getOutput/run) since there is no Tauri event channel in a Node process.
  const baseJobs = buildJobs(core);

  const getOutput = (jobId: string, since?: number) =>
    invoke<JobOutput>("lia_jobs_get_output", { jobId, since });

  const runJob = async (
    cmd: string,
    args: string[] = [],
    opts: {
      cwd?: string;
      onStdout?: (line: string) => void;
      onStderr?: (line: string) => void;
    } = {}
  ): Promise<JobEntry> => {
    const { jobId } = await baseJobs.spawn(cmd, args, { cwd: opts.cwd });
    let stdoutOffset = 0;
    let stderrOffset = 0;

    while (true) {
      await new Promise((r) => setTimeout(r, 100));

      const [out, entry] = await Promise.all([
        getOutput(jobId),
        baseJobs.status(jobId),
      ]);

      out.stdout.slice(stdoutOffset).forEach((l) => opts.onStdout?.(l));
      out.stderr.slice(stderrOffset).forEach((l) => opts.onStderr?.(l));
      stdoutOffset = out.stdoutTotal;
      stderrOffset = out.stderrTotal;

      if (entry.status.type !== "running") return entry;
    }
  };

  const jobs: LiatirNodeJobs = { ...baseJobs, getOutput, run: runJob };
  const deps: DepsInterface = buildDeps(core);

  const paths = () => invoke<LiatirNodePaths>("lia_fs_paths", {});

  return {
    jobs,
    deps,
    align: buildAlign(invoke),
    qc: buildQc({ jobs, invoke, paths }),
    variants: buildVariants({ jobs, invoke }),
    desktop: {
      fs: buildFs(core),
      files: buildFiles(core),
      events: buildEvents(core),
      app: buildAppInfo(core),
      globalVariables: buildGlobVar(core),
      network: buildNetwork(core),
      clipboard: buildClipboard(core),
      notifications: buildNotifications(core),
      diagnostics: buildDiagnostics(core),
    },
    plugins: buildPlugins(core),
    sidecar: buildSidecar(core),
    paths,
    invoke,
  };
}
