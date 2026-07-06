// AI namespace: local AI model runtimes (Liatir.ai.*)
//
// Thin, typed wrappers over the native `lia_ai_*` commands, driven by the
// shared model catalog in @liatir/core (the single source of truth used by the
// desktop UI too). A plugin author writes:
//
//     const models = Liatir.ai.list();
//     await Liatir.ai.prepare("facebook-esm2-8m-protein");
//     const r = await Liatir.ai.runScript("facebook-esm2-8m-protein", {
//       script, input: { sequence },
//     });
//
// The model → runtime-parameter mapping (runtime id, packages, requirements)
// lives in @liatir/core and is reused here, not re-derived.

import type {
  LiatirAIModelMetadata,
  LiatirPythonRuntimeLock,
} from "@liatir/core";
import {
  VISIBLE_LOCAL_AI_MODEL_REGISTRY,
  getLocalAIModelMetadata,
  runtimeIdForModel,
  requirementsForModel,
  runtimePackagesForModel,
  runtimeSourcesForModel,
  packageChecksForModel,
} from "@liatir/core";

type Invoke = <T>(cmd: string, payload?: Record<string, unknown>) => Promise<T>;

/** Local hardware capabilities reported by `lia_ai_hardware_info`. */
export interface AiHardwareInfo {
  os: string;
  arch: string;
  cpuCores: number;
  totalMemoryBytes: number | null;
  appleMetal: boolean;
  cudaAvailable: boolean | null;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  uvPath?: string | null;
}

/** Managed-runtime readiness for a model. */
export interface AiRuntimeStatus {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string | null;
  uvPath: string | null;
  /** True when every declared package is present. */
  installed: boolean;
  missingPackages: string[];
  missingSources?: string[];
  error: string | null;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

/** Result of preparing (creating/installing) a model's managed runtime. */
export interface AiRuntimePrepareResult {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string;
  installer: string;
  stdout: string;
  stderr: string;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

/** Result of running a Python script inside a model's managed runtime. */
export interface AiPythonRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AiRunScriptOptions {
  /** Python source to execute inside the model's prepared runtime. */
  script: string;
  /** JSON-serializable input passed to the script on stdin. */
  input?: Record<string, unknown>;
  /** Extra process arguments. */
  args?: string[];
  /** Kill the run after this many seconds. */
  timeoutSeconds?: number;
}

export interface AiNamespace {
  /** The visible built-in AI model catalog. */
  list(): LiatirAIModelMetadata[];
  /** Look up one model's metadata by id. */
  get(modelId: string): LiatirAIModelMetadata | undefined;
  /** Local hardware info (cores, memory, GPU/Metal, Python). */
  hardware(): Promise<AiHardwareInfo>;
  /** Whether a model's managed runtime is installed and ready. */
  status(modelId: string): Promise<AiRuntimeStatus>;
  /** Create/install a model's managed runtime (idempotent). */
  prepare(modelId: string): Promise<AiRuntimePrepareResult>;
  /** Run a Python script inside a model's prepared runtime. */
  runScript(modelId: string, options: AiRunScriptOptions): Promise<AiPythonRunResult>;
}

/** Build the `ai` namespace bound to a specific IPC `invoke`. */
export function buildAi(invoke: Invoke): AiNamespace {
  function requireModel(modelId: string): LiatirAIModelMetadata {
    const model = getLocalAIModelMetadata(modelId);
    if (!model) throw new Error(`Unknown AI model: ${modelId}`);
    return model;
  }

  function requireRuntimeId(model: LiatirAIModelMetadata): string {
    const runtimeId = runtimeIdForModel(model);
    if (!runtimeId) throw new Error(`AI model has no managed runtime: ${model.name}`);
    return runtimeId;
  }

  return {
    list: () => VISIBLE_LOCAL_AI_MODEL_REGISTRY,

    get: (modelId) => getLocalAIModelMetadata(modelId),

    hardware: () => invoke<AiHardwareInfo>("lia_ai_hardware_info"),

    status: (modelId) => {
      const model = requireModel(modelId);
      return invoke<AiRuntimeStatus>("lia_ai_runtime_status", {
        runtimeId: requireRuntimeId(model),
        packages: packageChecksForModel(model),
        sources: runtimeSourcesForModel(model),
      });
    },

    prepare: (modelId) => {
      const model = requireModel(modelId);
      return invoke<AiRuntimePrepareResult>("lia_ai_runtime_prepare", {
        runtimeId: requireRuntimeId(model),
        requirements: requirementsForModel(model),
        packages: runtimePackagesForModel(model),
        sources: runtimeSourcesForModel(model),
        pythonRequirement: model.install?.hostRequirements?.python ?? null,
      });
    },

    runScript: (modelId, options) => {
      const model = requireModel(modelId);
      return invoke<AiPythonRunResult>("lia_ai_python_run", {
        runtimeId: requireRuntimeId(model),
        script: options.script,
        args: options.args ?? [],
        inputJson: options.input ?? {},
        timeoutSeconds: options.timeoutSeconds ?? null,
      });
    },
  };
}
