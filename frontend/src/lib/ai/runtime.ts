import { liatir } from '$lib/api';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import type {
  JsonValue,
  LiatirAIModelMetadata,
  LiatirAIModelPythonRequirement,
  LiatirAIModelRecord,
  LiatirPythonRuntimeLock,
} from '@liatir/core';
// Model → runtime-parameter mapping lives in @liatir/core (shared with the
// plugin API). Re-exported here so existing frontend imports keep working.
import {
  runtimeIdForModel,
  requirementsForModel,
  runtimePackagesForModel,
  runtimeSourcesForModel,
  packageChecksForModel,
  type AiRuntimePackageCheck,
} from '@liatir/core';

export {
  runtimeIdForModel,
  requirementsForModel,
  runtimePackagesForModel,
  runtimeSourcesForModel,
  packageChecksForModel,
};

export type AIRuntimePackageCheck = AiRuntimePackageCheck;

export type AIRuntimePythonRequirement = LiatirAIModelPythonRequirement;

export interface AIHardwareInfo {
  os: string;
  arch: string;
  cpuCores: number;
  totalMemoryBytes: number | null;
  appleMetal: boolean;
  cudaAvailable: boolean | null;
  pythonPath?: string | null;
  pythonVersion?: string | null;
  pythonCandidates?: Array<{ path: string; version: string }>;
  uvPath?: string | null;
}

export interface AIRuntimeStatus {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string | null;
  uvPath: string | null;
  installed: boolean;
  missingPackages: string[];
  missingSources?: string[];
  error: string | null;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

export interface AIRuntimePrepareResult {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string;
  installer: string;
  stdout: string;
  stderr: string;
  sizeBytes?: number | null;
  lock?: LiatirPythonRuntimeLock | null;
}

export interface AIPythonRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AIPythonRunOptions {
  args?: string[];
  timeoutSeconds?: number;
  trackJob?: boolean;
  jobLabel?: string;
  metadata?: Record<string, JsonValue>;
  onJobId?: (jobId: string) => void;
}

export function cachePathForModel(model: LiatirAIModelRecord): string | null {
  if (!model.runtimePath || !model.install?.modelCacheSubdir) return null;
  return `${model.runtimePath}/${model.install.modelCacheSubdir}`;
}

export async function getAIHardwareInfo(): Promise<AIHardwareInfo> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  return await api.invoke('lia_ai_hardware_info') as AIHardwareInfo;
}

export async function getAIRuntimeStatus(model: LiatirAIModelMetadata): Promise<AIRuntimeStatus | null> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api || !runtimeId) return null;
  return await api.invoke('lia_ai_runtime_status', {
    runtimeId,
    packages: packageChecksForModel(model),
    sources: runtimeSourcesForModel(model),
  }) as AIRuntimeStatus;
}

export async function prepareAIRuntime(model: LiatirAIModelMetadata): Promise<AIRuntimePrepareResult> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api) throw new Error('Liatir API not available');
  if (!runtimeId) throw new Error(`AI Model has no managed runtime: ${model.name}`);
  return await api.invoke('lia_ai_runtime_prepare', {
    runtimeId,
    requirements: requirementsForModel(model),
    packages: runtimePackagesForModel(model),
    sources: runtimeSourcesForModel(model),
    pythonRequirement: model.install?.hostRequirements?.python ?? null,
  }) as AIRuntimePrepareResult;
}

export async function removeAIRuntime(model: LiatirAIModelMetadata): Promise<boolean> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api) throw new Error('Liatir API not available');
  if (!runtimeId) return false;
  return await api.invoke('lia_ai_runtime_remove', { runtimeId }) as boolean;
}

export async function runAIPython(
  model: LiatirAIModelRecord,
  script: string,
  inputJson: Record<string, JsonValue>,
  options: AIPythonRunOptions = {},
): Promise<AIPythonRunResult> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api) throw new Error('Liatir API not available');
  if (!runtimeId) throw new Error(`AI Model has no managed runtime: ${model.name}`);

  if (options.trackJob === false) {
    return await api.invoke('lia_ai_python_run', {
      runtimeId,
      script,
      args: options.args ?? [],
      inputJson,
      timeoutSeconds: options.timeoutSeconds ?? null,
    }) as AIPythonRunResult;
  }

  const startedAt = Date.now();
  const { jobId } = await api.invoke('lia_ai_python_spawn', {
    runtimeId,
    script,
    args: options.args ?? [],
    inputJson,
    workspaceId: workspaceStore.activeId,
    label: options.jobLabel ?? `AI Model: ${model.name}`,
    metadata: {
      modelId: model.id,
      modelName: model.name,
      ...(options.metadata ?? {}),
    },
  }) as { jobId: string };
  options.onJobId?.(jobId);

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let stdoutSeen = 0;
  let stderrSeen = 0;
  const timeoutMs = (options.timeoutSeconds ?? 3600) * 1000;

  while (true) {
    const since = Math.min(stdoutSeen, stderrSeen);
    const [out, entry] = await Promise.all([
      api.invoke('lia_jobs_get_output', { jobId, since }) as Promise<{
        stdout: string[];
        stderr: string[];
        stdoutTotal: number;
        stderrTotal: number;
      }>,
      api.invoke('lia_jobs_status', { jobId }) as Promise<{
        status: { type: 'running' | 'done' | 'failed' | 'killed'; exitCode?: number | null };
      }>,
    ]);

    const stdoutStart = Math.max(0, stdoutSeen - since);
    const stderrStart = Math.max(0, stderrSeen - since);
    stdoutLines.push(...out.stdout.slice(stdoutStart));
    stderrLines.push(...out.stderr.slice(stderrStart));
    stdoutSeen = out.stdoutTotal;
    stderrSeen = out.stderrTotal;

    if (entry.status.type !== 'running') {
      const exitCode = entry.status.type === 'done' || entry.status.type === 'failed'
        ? entry.status.exitCode ?? null
        : null;
      const completed = entry.status.type === 'done' && (exitCode === null || exitCode === 0);
      return {
        ok: completed,
        exitCode,
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
        durationMs: Date.now() - startedAt,
      };
    }

    if (Date.now() - startedAt > timeoutMs) {
      await api.invoke('lia_jobs_kill', { jobId });
      const out = await api.invoke('lia_jobs_get_output', { jobId }) as {
        stdout: string[];
        stderr: string[];
      };
      const stdout = out.stdout.join('\n');
      const stderr = [
        out.stderr.join('\n'),
        `AI runtime timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      ].filter(Boolean).join('\n');
      return {
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
