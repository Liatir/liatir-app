/**
 * The identity an AI run carries with it, from launch through to its saved Result.
 *
 * An AI run is a detached background job: the page that started it is gone by the time it finishes
 * (see `direct-run-finalizer`). So everything needed to finalize it — which tool, which inputs,
 * which parameters, and crucially **which analysis run ID it will become** — is serialised into the
 * job's metadata up front and read back later.
 *
 * That pre-allocated `analysisRunId` is what makes the whole thing idempotent: a job always knows
 * the identity of the Result it will produce, so a finalizer can tell "already saved" from "not yet
 * saved" without guessing, no matter how many times it runs or across how many app restarts.
 *
 * Two run kinds, discriminated by `runKind`: a direct run started from a tool page, and a pipeline
 * step. They differ in what identifies them — a standalone analysis run versus a node inside a
 * pipeline run — which is exactly why they are separate types rather than one with optional fields.
 */
import type { JsonValue, LiatirExecutionIdentity } from '@liatir/core';

export type AIDirectRunMode = 'single-cell-embedding' | 'mhc-class-i-epitope-prediction';

export interface AIDirectRunContext {
	runKind: 'ai-model-direct';
	execution: LiatirExecutionIdentity;
	/** Allocated *before* the job starts — see the note above. */
	analysisRunId: string;
	toolId: string;
	mode: AIDirectRunMode;
	label: string;
	inputPaths: string[];
	inputSizes?: number[];
	params: Record<string, string>;
	startedAt: number;
	outputDir: string;
	// Runtime-only handles: they cannot be serialised into job metadata, which is why the
	// metadata builders below deliberately omit them.
	signal?: AbortSignal;
	onJobId?: (jobId: string) => void;
}

export interface AIPipelineRunContext {
	runKind: 'pipeline-step';
	execution: LiatirExecutionIdentity;
	/** A pipeline step is identified by its parent run *and* its node — neither alone is enough. */
	pipelineRunId: string;
	pipelineId: string | null;
	pipelineName: string;
	nodeId: string;
	toolId: string;
	label: string;
	params: Record<string, string>;
	startedAt: number;
	outputDir: string;
	signal?: AbortSignal;
	onJobId?: (jobId: string) => void;
}

export type AIRunContext = AIDirectRunContext | AIPipelineRunContext;

// Defensive coercions for reading back metadata. It was written by a *previous version* of the app
// — the job may have been started before an upgrade — so it is treated as untrusted JSON rather
// than as a value of a known type. Each helper keeps whatever is well-formed and quietly discards
// the rest, so a partially unfamiliar metadata blob degrades instead of throwing.

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function numberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value.filter(
		(item): item is number => typeof item === 'number' && Number.isFinite(item)
	);
	// Empty means "absent" rather than "an empty list", matching the optional field.
	return values.length > 0 ? values : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}

/**
 * Serialises a direct-run context into job metadata.
 *
 * Note what is *not* copied: `signal` and `onJobId`. They are live objects belonging to the caller
 * that started the run, and would be meaningless (and unserialisable) to whoever reads this back.
 */
export function directRunMetadata(context: AIDirectRunContext): Record<string, JsonValue> {
	return {
		runKind: context.runKind,
		execution: context.execution as unknown as JsonValue,
		analysisRunId: context.analysisRunId,
		toolId: context.toolId,
		mode: context.mode,
		label: context.label,
		inputPaths: context.inputPaths,
		...(context.inputSizes ? { inputSizes: context.inputSizes } : {}),
		params: context.params,
		startedAt: context.startedAt,
		outputDir: context.outputDir
	};
}

/** Serialises either kind of run context, dispatching on the `runKind` discriminant. */
export function aiRunMetadata(context: AIRunContext): Record<string, JsonValue> {
	if (context.runKind === 'ai-model-direct') return directRunMetadata(context);
	return {
		runKind: context.runKind,
		execution: context.execution as unknown as JsonValue,
		pipelineRunId: context.pipelineRunId,
		pipelineId: context.pipelineId,
		pipelineName: context.pipelineName,
		nodeId: context.nodeId,
		toolId: context.toolId,
		label: context.label,
		params: context.params,
		startedAt: context.startedAt,
		outputDir: context.outputDir
	};
}

/**
 * Reads a direct-run context back out of a job's metadata, or `null` if that is not what it is.
 *
 * This is the sole gate between arbitrary job metadata and a typed run context, and it doubles as
 * the "is this an AI direct run?" test used across the app. Returning `null` rather than throwing
 * is deliberate: it is called on *every* job in the list, most of which are not AI runs at all, so
 * not matching is the normal case and not an error.
 *
 * The required fields below are exactly those the finalizer cannot work without. A job missing any
 * of them is unusable, so it is rejected here rather than producing a half-formed Result later.
 */
export function parseDirectRunContext(metadata: unknown): AIDirectRunContext | null {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
	const record = metadata as Record<string, unknown>;
	if (record.runKind !== 'ai-model-direct') return null;
	if (typeof record.analysisRunId !== 'string') return null;
	if (typeof record.toolId !== 'string') return null;
	if (
		record.mode !== 'single-cell-embedding' &&
		record.mode !== 'mhc-class-i-epitope-prediction'
	) return null;
	if (typeof record.label !== 'string') return null;
	if (typeof record.startedAt !== 'number') return null;
	if (typeof record.outputDir !== 'string') return null;
	if (!record.execution || typeof record.execution !== 'object' || Array.isArray(record.execution)) return null;

	return {
		runKind: 'ai-model-direct',
		execution: record.execution as unknown as LiatirExecutionIdentity,
		analysisRunId: record.analysisRunId,
		toolId: record.toolId,
		mode: record.mode,
		label: record.label,
		inputPaths: stringArray(record.inputPaths),
		inputSizes: numberArray(record.inputSizes),
		params: stringRecord(record.params),
		startedAt: record.startedAt,
		outputDir: record.outputDir
	};
}
