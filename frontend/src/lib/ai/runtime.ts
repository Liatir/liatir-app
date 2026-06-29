import { liatir } from '$lib/api';
import type { JsonValue, LiatirAIModelMetadata, LiatirAIModelRecord } from '@liatir/core';

export interface AIRuntimePackageCheck {
  package: string;
  importName?: string;
}

export interface AIHardwareInfo {
  os: string;
  arch: string;
  cpuCores: number;
  totalMemoryBytes: number | null;
  appleMetal: boolean;
  cudaAvailable: boolean | null;
}

export interface AIRuntimeStatus {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string | null;
  uvPath: string | null;
  installed: boolean;
  missingPackages: string[];
  error: string | null;
}

export interface AIRuntimePrepareResult {
  runtimeId: string;
  runtimeDir: string;
  pythonPath: string;
  installer: string;
  stdout: string;
  stderr: string;
}

export interface AIPythonRunResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function runtimeIdForModel(model: LiatirAIModelMetadata): string | null {
  return model.install?.runtimeId ?? null;
}

export function requirementsForModel(model: LiatirAIModelMetadata): string[] {
  return (model.install?.runtimePackages ?? []).map((pkg) => {
    if (pkg.specifier) return pkg.specifier;
    if (pkg.version) return `${pkg.package}==${pkg.version}`;
    return pkg.package;
  });
}

export function packageChecksForModel(model: LiatirAIModelMetadata): AIRuntimePackageCheck[] {
  return (model.install?.runtimePackages ?? []).map((pkg) => ({
    package: pkg.package,
    importName: pkg.importName,
  }));
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
  }) as AIRuntimePrepareResult;
}

export async function runAIPython(
  model: LiatirAIModelRecord,
  script: string,
  inputJson: Record<string, JsonValue>,
  options: { args?: string[]; timeoutSeconds?: number } = {},
): Promise<AIPythonRunResult> {
  const api = liatir();
  const runtimeId = runtimeIdForModel(model);
  if (!api) throw new Error('Liatir API not available');
  if (!runtimeId) throw new Error(`AI Model has no managed runtime: ${model.name}`);
  return await api.invoke('lia_ai_python_run', {
    runtimeId,
    script,
    args: options.args ?? [],
    inputJson,
    timeoutSeconds: options.timeoutSeconds ?? null,
  }) as AIPythonRunResult;
}
