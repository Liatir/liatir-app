import { liatir } from '$lib/api';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import type {
  JsonValue,
  LiatirAIModelMetadata,
  LiatirAIModelRecord,
  LiatirRuntimeBoxActivationMetadata,
  LiatirRuntimeComponentInstallResult,
  LiatirRuntimeComponentStatus,
  LiatirRuntimeComponentUpdateStatus,
} from '@liatir/core';
// Model → runtime-parameter mapping lives in @liatir/core (shared with the
// plugin API). Re-exported here so existing frontend imports keep working.
import {
  runtimeIdForModel,
  runtimePackagesForModel,
  packageChecksForModel,
  type AiRuntimePackageCheck,
} from '@liatir/core';
import { throwIfRunCancelled } from '$lib/pipeline/cancellation';
import { waitForJobSettlement } from '$lib/pipeline/job-settlement';
import { runtimeBoxActivationFromMetadata } from './runtime-box-provenance';

export {
  runtimeIdForModel,
  runtimePackagesForModel,
  packageChecksForModel,
};

export type AIRuntimePackageCheck = AiRuntimePackageCheck;

export interface AIHardwareInfo {
  os: string;
  arch: string;
  cpuCores: number;
  totalMemoryBytes: number | null;
  appleMetal: boolean;
  cudaAvailable: boolean | null;
  nvidiaDriverVersion?: string | null;
  /** The driver as seen inside WSL2; null when the GPU is not reachable from there. */
  wslNvidiaDriverVersion?: string | null;
  wsl2Available: boolean;
  wslDistribution?: string | null;
  wslError?: string | null;
}

export type AIRuntimeStatus = LiatirRuntimeComponentStatus;
export type AIRuntimeBoxInstallResult = LiatirRuntimeComponentInstallResult;

export interface AIPythonRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  runtimeBoxActivation?: LiatirRuntimeBoxActivationMetadata;
}

export interface AIPythonRunOptions {
  args?: string[];
  timeoutSeconds?: number;
  trackJob?: boolean;
  jobLabel?: string;
  metadata?: Record<string, JsonValue>;
  onJobId?: (jobId: string) => void;
  signal?: AbortSignal;
}

export function cachePathForModel(model: LiatirAIModelRecord): string | null {
  if (!model.runtimePath) return null;
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
  return await api.runtimeBoxes.status({
    componentKind: 'ai-model',
    runtimeId,
    packages: packageChecksForModel(model),
  });
}

/** Explicitly reads the signed channel pointer; it never downloads or activates a release. */
export async function checkAIRuntimeBoxUpdate(
  model: LiatirAIModelMetadata,
): Promise<LiatirRuntimeComponentUpdateStatus | null> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api || !runtimeId) return null;
  const status = await api.runtimeBoxes.status({
    componentKind: 'ai-model',
    runtimeId,
    packages: packageChecksForModel(model),
    update: {
      componentId: model.id,
      ...model.install.runtimeBox,
    },
  });
  return status.update ?? null;
}

/** Download and atomically activate the signed Runtime Box selected by channel. */
export async function installAIRuntimeBox(
  model: LiatirAIModelMetadata,
  onProgress?: (progress: { bytesDownloaded: number; bytesTotal: number | null }) => void,
  downloadId = `runtime-box-${model.id}-${crypto.randomUUID()}`,
): Promise<AIRuntimeBoxInstallResult> {
  const api = liatir();
  const runtimeBox = model.install.runtimeBox;
  if (!api) throw new Error('Liatir API not available');
  const unlisten = await api.desktop.events.on(
    `managed:progress:${downloadId}`,
    (progress: { bytesDownloaded: number; bytesTotal: number | null }) => onProgress?.(progress),
  );
  try {
    return await api.runtimeBoxes.install({
      componentKind: 'ai-model',
      componentId: model.id,
      boxId: runtimeBox.boxId,
      channel: runtimeBox.channel,
      registryBaseUrl: runtimeBox.registryBaseUrl,
      publishedTargets: runtimeBox.publishedTargets,
      downloadId,
    });
  } finally {
    unlisten();
  }
}

export async function cancelAIRuntimeBoxDownload(downloadId: string): Promise<boolean> {
  const api = liatir();
  if (!api) return false;
  return api.runtimeBoxes.cancelDownload(downloadId);
}

export async function rollbackAIRuntimeBox(model: LiatirAIModelMetadata) {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  return api.runtimeBoxes.rollback('ai-model', runtimeIdForModel(model));
}

export async function removeAIRuntimeBox(model: LiatirAIModelMetadata): Promise<boolean> {
  const api = liatir();
  if (!api) return false;
  return api.runtimeBoxes.remove('ai-model', runtimeIdForModel(model), model.install.runtimeBox.boxId);
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
  if (!runtimeId) throw new Error(`AI Model has no Runtime Box: ${model.name}`);
  throwIfRunCancelled(options.signal);

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
  const timeoutMs = (options.timeoutSeconds ?? 3600) * 1000;
  const settlement = await waitForJobSettlement(api, jobId, {
    signal: options.signal,
    timeoutMs,
    pollIntervalMs: 200,
  });
  if (settlement.timedOut) {
    return {
      ok: false,
      exitCode: null,
      stdout: settlement.stdout.join('\n'),
      stderr: [
        settlement.stderr.join('\n'),
        `AI runtime timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      ].filter(Boolean).join('\n'),
      durationMs: Date.now() - startedAt,
    };
  }

  const exitCode = settlement.entry.status.type === 'done' || settlement.entry.status.type === 'failed'
    ? settlement.entry.status.exitCode ?? null
    : null;
  const completed = settlement.entry.status.type === 'done' && (exitCode === null || exitCode === 0);
  return {
    ok: completed,
    exitCode,
    stdout: settlement.stdout.join('\n'),
    stderr: settlement.stderr.join('\n'),
    durationMs: Date.now() - startedAt,
    runtimeBoxActivation: runtimeBoxActivationFromMetadata(settlement.entry.metadata),
  };
}
