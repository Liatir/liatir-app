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
    default:
      const dataHome = process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");
      candidates.push(path.join(dataHome, "app.liatir.app"));
      candidates.push(path.join(dataHome, "liatir"));
      candidates.push(path.join(dataHome, "Liatir"));
      break;
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
    `[liatir-adapter] Liatir app is not running or IPC not ready.\n` +
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

// ── Plugin I/O schema — backed by @liatir/core ───────────────────────────────
// You declare the schema once with `f.*`; the input/output TS types are inferred
// from it, and `lia build` generates the manifest from it. Nothing to keep in
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

export type ModuleInput<S extends InputSchema> = Infer<S>;
export type ModuleOutput<S extends OutputSchema> = Infer<S>;
export type ModuleMainContext<I extends InputSchema, O extends OutputSchema> = {
  input: Infer<I>;
  lia: LiatirNode;
};
export type ModuleMainHandler<I extends InputSchema, O extends OutputSchema> = (
  ctx: ModuleMainContext<I, O>
) => Infer<O> | Promise<Infer<O>>;

export interface ModuleDefinition<I extends InputSchema, O extends OutputSchema> {
  inputs: I;
  outputs: O;
}

export interface LiatirModuleContract<I extends InputSchema, O extends OutputSchema> {
  readonly __liatirModuleContract: true;
  inputs: I;
  outputs: O;
  main: (handler: ModuleMainHandler<I, O>) => LiatirModule<I, O>;
}

export type ModuleContext<TContract> =
  TContract extends LiatirModuleContract<infer I, infer O> ? ModuleMainContext<I, O> : never;

/** Runtime shape `lia build` reads (schema → manifest) and the app runner calls. */
export interface LiatirModule<I extends InputSchema = InputSchema, O extends OutputSchema = OutputSchema> {
  readonly __liatirModule: true;
  inputs: I;
  outputs: O;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Define a Liatir plugin. Declare `inputs`/`outputs` with `f.*` once: the
 * `input` and return types are inferred from them, and the manifest is generated
 * from them at build time — no hand-written types, no manifest to keep in sync.
 *
 * ```ts
 * import { defineModule, field } from "@liatir/sdk";
 *
 * export default defineModule({
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
export function defineModule<const I extends InputSchema, const O extends OutputSchema>(
  def: ModuleDefinition<I, O>,
): LiatirModuleContract<I, O> {
  return {
    __liatirModuleContract: true,
    inputs: def.inputs,
    outputs: def.outputs,
    main: (handler) => {
      return {
        __liatirModule: true,
        inputs: def.inputs,
        outputs: def.outputs,
        run: async (input) => {
          const lia = await createLiatir();
          return handler({ input: input as Infer<I>, lia });
        },
      };
    },
  };
}
