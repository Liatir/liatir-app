import type { JsonValue, LiatirExecutionIdentity } from '@liatir/core';

/** Durable identity for a direct Tool Runtime run that may outlive its page. */
export interface ToolRuntimeDirectRunContext {
  runKind: 'tool-runtime-direct';
  execution: LiatirExecutionIdentity;
  analysisRunId: string;
  toolId: string;
  label: string;
  inputPaths: string[];
  inputSizes?: number[];
  params: Record<string, string>;
  startedAt: number;
  outputDir: string;
  signal?: AbortSignal;
  onJobId?: (jobId: string) => void;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return result.length ? result : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function toolRuntimeDirectRunMetadata(
  context: ToolRuntimeDirectRunContext,
): Record<string, JsonValue> {
  return {
    runKind: context.runKind,
    execution: context.execution as unknown as JsonValue,
    analysisRunId: context.analysisRunId,
    toolId: context.toolId,
    label: context.label,
    inputPaths: context.inputPaths,
    ...(context.inputSizes ? { inputSizes: context.inputSizes } : {}),
    params: context.params,
    startedAt: context.startedAt,
    outputDir: context.outputDir,
  };
}

export function parseToolRuntimeDirectRunContext(metadata: unknown): ToolRuntimeDirectRunContext | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  if (record.runKind !== 'tool-runtime-direct') return null;
  if (!record.execution || typeof record.execution !== 'object' || Array.isArray(record.execution)) return null;
  if (typeof record.analysisRunId !== 'string' || typeof record.toolId !== 'string') return null;
  if (typeof record.label !== 'string' || typeof record.startedAt !== 'number' || typeof record.outputDir !== 'string') return null;
  return {
    runKind: 'tool-runtime-direct',
    execution: record.execution as unknown as LiatirExecutionIdentity,
    analysisRunId: record.analysisRunId,
    toolId: record.toolId,
    label: record.label,
    inputPaths: stringArray(record.inputPaths),
    inputSizes: numberArray(record.inputSizes),
    params: stringRecord(record.params),
    startedAt: record.startedAt,
    outputDir: record.outputDir,
  };
}
