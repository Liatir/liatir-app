import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type {
  JsonValue,
  LiatirFieldSchema,
  LiatirFieldType,
  LiatirFileOutputValue,
  LiatirInputFieldType,
  LiatirOutputFieldSchema,
  LiatirOutputFieldType,
  LiatirToolOutput,
} from "@liatir/core";
import { buildAlign, type AlignNamespace } from "./bio/align";
import { buildQc, type QcNamespace } from "./bio/qc";
import { buildVariants, type VariantsNamespace } from "./bio/variants";
import { buildAi, type AiNamespace } from "./ai";
import type { LiatirBrowserAPI as BrowserBridgeAPI } from "../../../src-ts/liatir/_types";

/** Browser/webview bridge exposed as window.Liatir inside the Tauri app. */
export type LiatirBrowserAPI = BrowserBridgeAPI;

/**
 * @deprecated Use LiatirBrowserAPI for the window.Liatir webview bridge.
 * LiatirAPI is kept only as a compatibility alias for older integrations.
 */
export type LiatirAPI = LiatirBrowserAPI;

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
import { buildSidecar } from "../../../src-ts/modules/rs/sidecar/_main";
import { buildPipeline } from "../../../src-ts/modules/bio/pipeline/_main";
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
// jobs/deps are the SAME interfaces the browser bridge uses, re-exported here.
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
 * Buffered stdout/stderr lines — Node-specific. The browser bridge streams job
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

const DEV_CONTEXT_PAYLOAD_KEY = "__liatirDevContext";
const SANDBOX_WORKSPACE_ID = "__test__";

interface LiatirDevContext {
  scope: "plugin-dev";
  sessionId: string;
  workspaceId: string;
}

function readDevContextFromEnv(): LiatirDevContext | null {
  if (process.env["LIATIR_RUN_SCOPE"] !== "plugin-dev") return null;
  const sessionId = process.env["LIATIR_DEV_SESSION_ID"]?.trim();
  if (!sessionId) return null;
  return {
    scope: "plugin-dev",
    sessionId,
    workspaceId: process.env["LIATIR_WORKSPACE_ID"]?.trim() || SANDBOX_WORKSPACE_ID,
  };
}

function withDevContextPayload(
  payload: Record<string, unknown> | undefined,
  devContext: LiatirDevContext | null,
): Record<string, unknown> | undefined {
  if (!devContext) return payload;
  return {
    ...(payload ?? {}),
    [DEV_CONTEXT_PAYLOAD_KEY]: devContext,
  };
}

function withDevSpawnOptions(
  opts: SpawnOptions = {},
  devContext: LiatirDevContext | null,
): SpawnOptions {
  if (!devContext) return opts;
  return {
    ...opts,
    kind: opts.kind?.startsWith("lia-plugin-dev") ? opts.kind : "lia-plugin-dev-child",
    metadata: {
      ...(opts.metadata ?? {}),
      pluginDev: true,
      pluginDevSessionId: devContext.sessionId,
    },
  };
}

function isCurrentDevJob(entry: JobEntry, devContext: LiatirDevContext | null): boolean {
  if (!devContext) return true;
  return entry.metadata?.["pluginDevSessionId"] === devContext.sessionId;
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
      // Try the next known app data location.
    }
  }

  throw new Error(
    `[liatir-api] Liatir app is not running or IPC not ready.\n` +
    `Expected one of:\n${portFiles.map((file) => `- ${file}`).join("\n")}\n` +
    `Start the Liatir desktop app first.`
  );
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
    throw new Error(`[liatir-api] HTTP ${res.status} for ${cmd}`);
  }

  const data = (await res.json()) as { ok: boolean; result?: T; error?: string };
  if (!data.ok) {
    throw new Error(data.error ?? `[liatir-api] ${cmd} failed`);
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

export type LiatirSharedDesktop = Pick<
  LiatirBrowserAPI["desktop"],
  | "fs"
  | "files"
  | "events"
  | "app"
  | "network"
  | "clipboard"
  | "notifications"
  | "diagnostics"
  | "globalVariables"
>;

export type LiatirSharedTopLevel = Pick<
  LiatirBrowserAPI,
  "deps" | "sidecar" | "pipeline" | "invoke"
>;

export interface LiatirNode extends LiatirSharedTopLevel {
  /** Async process manager — spawn, stream, kill any system binary. */
  jobs: LiatirNodeJobs;
  /** Bio analysis namespaces (scipy-style typed wrappers). */
  align: AlignNamespace;
  qc: QcNamespace;
  variants: VariantsNamespace;
  /** Local AI model runtimes — list, prepare, and run models in their venv. */
  ai: AiNamespace;
  /** Desktop bridge subset available in headless Node plugins. */
  desktop: LiatirSharedDesktop;
  /** App filesystem paths. */
  paths(): Promise<LiatirNodePaths>;
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function createLiatir(): Promise<LiatirNode> {
  const ipc = await readIpcInfo();
  const devContext = readDevContextFromEnv();
  const invoke = <T>(cmd: string, payload?: Record<string, unknown>) =>
    httpInvoke<T>(ipc, cmd, withDevContextPayload(payload, devContext));

  // The `core` shape every bridge buildX() expects — only needs `invoke`.
  const core = { invoke };

  // jobs/deps reuse the browser bridge builders; Node adds polling-based streaming
  // (getOutput/run) since there is no Tauri event channel in a Node process.
  const baseJobs = buildJobs(core);
  const spawnJob = (cmd: string, args: string[], opts: SpawnOptions = {}) =>
    baseJobs.spawn(cmd, args, withDevSpawnOptions(opts, devContext));
  const listJobs = async () => {
    if (!devContext) return baseJobs.list();
    const entries = await invoke<JobEntry[]>("lia_jobs_list", {
      workspaceId: devContext.workspaceId,
      includeDev: true,
    });
    return entries.filter((entry) => isCurrentDevJob(entry, devContext));
  };
  const clearDoneJobs = async () => {
    if (devContext) return 0;
    return baseJobs.clearDone();
  };

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
    const { jobId } = await spawnJob(cmd, args, { cwd: opts.cwd });
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

  const jobs: LiatirNodeJobs = {
    ...baseJobs,
    spawn: spawnJob,
    list: listJobs,
    clearDone: clearDoneJobs,
    getOutput,
    run: runJob,
  };
  const deps: DepsInterface = buildDeps(core);

  const paths = async () => {
    const base = await invoke<Record<string, string>>("lia_fs_paths", {});
    if (!devContext) return base as unknown as LiatirNodePaths;

    const rel = `workspaces/${devContext.workspaceId}/plugin-dev/${devContext.sessionId}`;
    await Promise.all([
      invoke<void>("lia_fs_mkdir", { rel, permanent: true }),
      invoke<void>("lia_fs_mkdir", { rel, permanent: false }),
    ]);
    return {
      ...base,
      data: `${base.data}/${rel}`,
      cache: `${base.cache}/${rel}`,
      temp: `${base.cache}/${rel}`,
    } as unknown as LiatirNodePaths;
  };

  // Pipeline is pure JS orchestration over sidecar.run, so it is shared with
  // the browser bridge (no Rust command of its own).
  const sidecar = buildSidecar(core);

  return {
    jobs,
    deps,
    align: buildAlign({ invoke, jobs }),
    qc: buildQc({ jobs, invoke, paths }),
    variants: buildVariants({ jobs, invoke }),
    ai: buildAi(invoke),
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
    sidecar,
    pipeline: buildPipeline({ sidecar }),
    paths,
    invoke,
  };
}

// ── Plugin I/O schema — backed by @liatir/core ───────────────────────────────
// You declare the schema once with `f.*`; the input/output TS types are inferred
// from it, and `liatir build` generates the manifest from it. Nothing to keep in
// sync by hand.

/** A typed field. `T` is the inferred TS type; it is erased at runtime. */
export interface Field<T, TType extends LiatirFieldType = LiatirFieldType> extends LiatirFieldSchema<T> {
  type: TType;
  /** phantom — carries the inferred type only, never present at runtime */
  readonly __t?: T;
}

interface FieldOpts<T> {
  label?: string;
  description?: string;
  required?: boolean;
  default?: T;
}

/** Field builders: declare what a plugin's inputs/outputs are AND their types. */
export const field = {
  string: (o: FieldOpts<string> = {}): Field<string, "string"> => ({ type: "string", ...o }),
  number: (
    o: FieldOpts<number> & { format?: LiatirOutputFieldSchema["format"] } = {}
  ): Field<number, "number"> & { format?: LiatirOutputFieldSchema["format"] } => ({ type: "number", ...o }),
  boolean: (o: FieldOpts<boolean> = {}): Field<boolean, "boolean"> => ({ type: "boolean", ...o }),
  file: (o: FieldOpts<string> & { accept?: string[]; ext?: string[] } = {}): Field<string, "file"> & { ext?: string[] } => ({ type: "file", ...o }),
  json: <T extends JsonValue = JsonValue>(o: FieldOpts<T> = {}): Field<T, "json"> => ({ type: "json", ...o }),
  stats: (o: FieldOpts<LiatirToolOutput> = {}): Field<LiatirToolOutput, "stats"> => ({ type: "stats", ...o }),
};

export const input = {
  string: field.string,
  number: field.number,
  boolean: field.boolean,
  file: (o: FieldOpts<string> & { accept?: string[] } = {}): Field<string, "file"> => ({ type: "file", ...o }),
};

export const output = {
  string: field.string,
  number: field.number,
  boolean: field.boolean,
  file: (
    o: FieldOpts<LiatirFileOutputValue> & { accept?: string[]; ext?: string[] } = {}
  ): Field<LiatirFileOutputValue, "file"> & { ext?: string[] } => ({ type: "file", ...o }),
  json: field.json,
  stats: field.stats,
};

type InputSchema = Record<string, Field<unknown, LiatirInputFieldType>>;
type OutputSchema = Record<string, Field<unknown, LiatirOutputFieldType>>;
type Infer<S extends Record<string, Field<unknown, LiatirFieldType>>> = {
  [K in keyof S]: S[K] extends Field<infer T, LiatirFieldType> ? T : never;
};

export type PluginInput<S extends InputSchema> = Infer<S>;
export type PluginOutput<S extends OutputSchema> = Infer<S>;
export type PluginMainContext<I extends InputSchema, O extends OutputSchema> = {
  input: Infer<I>;
  Liatir: LiatirNode;
};
export type PluginMainHandler<I extends InputSchema, O extends OutputSchema> = (
  ctx: PluginMainContext<I, O>
) => Infer<O> | Promise<Infer<O>>;

export interface PluginDefinition<I extends InputSchema, O extends OutputSchema> {
  inputs: I;
  outputs: O;
}

export interface LiatirPluginContract<I extends InputSchema, O extends OutputSchema> {
  readonly __liatirPluginContract: true;
  inputs: I;
  outputs: O;
  main: (handler: PluginMainHandler<I, O>) => LiatirPlugin<I, O>;
}

export type PluginContext<TContract> =
  TContract extends LiatirPluginContract<infer I, infer O> ? PluginMainContext<I, O> : never;

/** Runtime shape `liatir build` reads (schema → manifest) and the app runner calls. */
export interface LiatirPlugin<I extends InputSchema = InputSchema, O extends OutputSchema = OutputSchema> {
  readonly __liatirPlugin: true;
  inputs: I;
  outputs: O;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Define a Liatir plugin. Declare `inputs`/`outputs` with `field.*` once: the
 * `input` and return types are inferred from them, and the manifest is generated
 * from them at build time — no hand-written types, no manifest to keep in sync.
 *
 * ```ts
 * import { definePlugin, field } from "@liatir/api";
 *
 * export default definePlugin({
 *   inputs: {
 *     text: field.string({ label: "Text", required: true }),
 *   },
 *   outputs: {
 *     length: field.number({ label: "Length" }),
 *   },
 * }).main(async ({ input }) => {
 *   return { length: input.text.length };
 * });
 * ```
 */
export function definePlugin<const I extends InputSchema, const O extends OutputSchema>(
  def: PluginDefinition<I, O>,
): LiatirPluginContract<I, O> {
  return {
    __liatirPluginContract: true,
    inputs: def.inputs,
    outputs: def.outputs,
    main: (handler) => {
      return {
        __liatirPlugin: true,
        inputs: def.inputs,
        outputs: def.outputs,
        run: async (input) => {
          const Liatir = await createLiatir();
          return handler({ input: input as Infer<I>, Liatir });
        },
      };
    },
  };
}
