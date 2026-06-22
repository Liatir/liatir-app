import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { buildAlign, type AlignNamespace } from "./bio/align";

// ── Types mirrored from src-ts (no runtime dep on the browser SDK) ──────────

export interface JobEntry {
  id: string;
  cmd: string;
  args: string[];
  status: JobStatus;
  startedAtMs: number;
  endedAtMs: number | null;
}

export type JobStatus =
  | { type: "running" }
  | { type: "done"; exitCode: number | null }
  | { type: "failed"; exitCode: number | null }
  | { type: "killed" };

export interface SpawnResult {
  jobId: string;
}

export interface DepResult {
  available: boolean;
  binary: string;
  path: string | null;
  version: string | null;
}

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

export interface LiatirNodeJobs {
  spawn(cmd: string, args?: string[], opts?: { cwd?: string }): Promise<SpawnResult>;
  kill(jobId: string): Promise<boolean>;
  status(jobId: string): Promise<JobEntry>;
  list(): Promise<JobEntry[]>;
  /** Get buffered stdout/stderr lines since a given offset (for polling). */
  getOutput(jobId: string, since?: number): Promise<JobOutput>;
  /**
   * Spawn a process and wait for it to finish, streaming output to the
   * provided callbacks. Returns the final JobEntry.
   */
  run(
    cmd: string,
    args?: string[],
    opts?: {
      cwd?: string;
      onStdout?: (line: string) => void;
      onStderr?: (line: string) => void;
    }
  ): Promise<JobEntry>;
}

export interface LiatirNodeDeps {
  check(name: string): Promise<DepResult>;
  checkMany(names: string[]): Promise<DepResult[]>;
}

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
  deps: LiatirNodeDeps;
  /** Bio analysis namespaces (scipy-style typed wrappers): align, variants, … */
  align: AlignNamespace;
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

  const jobs: LiatirNodeJobs = {
    spawn: (cmd, args = [], opts) =>
      invoke<SpawnResult>("lia_jobs_spawn", { cmd, args, cwd: opts?.cwd }),

    kill: (jobId) => invoke<boolean>("lia_jobs_kill", { jobId }),

    status: (jobId) => invoke<JobEntry>("lia_jobs_status", { jobId }),

    list: () => invoke<JobEntry[]>("lia_jobs_list", {}),

    getOutput: (jobId, since) =>
      invoke<JobOutput>("lia_jobs_get_output", { jobId, since }),

    async run(cmd, args = [], opts = {}) {
      const { jobId } = await jobs.spawn(cmd, args, { cwd: opts.cwd });
      let stdoutOffset = 0;
      let stderrOffset = 0;

      while (true) {
        await new Promise((r) => setTimeout(r, 100));

        const [out, entry] = await Promise.all([
          jobs.getOutput(jobId, stdoutOffset === 0 && stderrOffset === 0 ? undefined : undefined),
          jobs.status(jobId),
        ]);

        // emit new lines
        const newStdout = out.stdout.slice(stdoutOffset);
        const newStderr = out.stderr.slice(stderrOffset);
        newStdout.forEach((l) => opts.onStdout?.(l));
        newStderr.forEach((l) => opts.onStderr?.(l));
        stdoutOffset = out.stdoutTotal;
        stderrOffset = out.stderrTotal;

        if (entry.status.type !== "running") return entry;
      }
    },
  };

  const deps: LiatirNodeDeps = {
    check: (name) => invoke<DepResult>("lia_deps_check", { name }),
    checkMany: (names) => invoke<DepResult[]>("lia_deps_check_many", { names }),
  };

  return {
    jobs,
    deps,
    align: buildAlign(invoke),
    paths: () => invoke<LiatirNodePaths>("lia_fs_paths", {}),
    invoke,
  };
}
