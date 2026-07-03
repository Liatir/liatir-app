import type { JsonValue } from '@liatir/core';

export type AIDirectRunMode =
	| 'celltypist'
	| 'sequence'
	| 'regulatory'
	| 'protein-structure'
	| 'single-cell-embedding'
	| 'mock';

export interface AIDirectRunContext {
	runKind: 'ai-model-direct';
	analysisRunId: string;
	toolId: string;
	mode: AIDirectRunMode;
	label: string;
	inputPaths: string[];
	inputSizes?: number[];
	params: Record<string, string>;
	startedAt: number;
	outputDir: string;
}

export interface AIPipelineRunContext {
	runKind: 'pipeline-step';
	pipelineRunId: string;
	pipelineId: string | null;
	pipelineName: string;
	nodeId: string;
	toolId: string;
	label: string;
	params: Record<string, string>;
	startedAt: number;
	outputDir: string;
}

export type AIRunContext = AIDirectRunContext | AIPipelineRunContext;

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
	return values.length > 0 ? values : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}

export function directRunMetadata(context: AIDirectRunContext): Record<string, JsonValue> {
	return {
		runKind: context.runKind,
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

export function aiRunMetadata(context: AIRunContext): Record<string, JsonValue> {
	if (context.runKind === 'ai-model-direct') return directRunMetadata(context);
	return {
		runKind: context.runKind,
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

export function parseDirectRunContext(metadata: unknown): AIDirectRunContext | null {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
	const record = metadata as Record<string, unknown>;
	if (record.runKind !== 'ai-model-direct') return null;
	if (typeof record.analysisRunId !== 'string') return null;
	if (typeof record.toolId !== 'string') return null;
	if (
		record.mode !== 'celltypist' &&
		record.mode !== 'sequence' &&
		record.mode !== 'regulatory' &&
		record.mode !== 'protein-structure' &&
		record.mode !== 'single-cell-embedding' &&
		record.mode !== 'mock'
	)
		return null;
	if (typeof record.label !== 'string') return null;
	if (typeof record.startedAt !== 'number') return null;
	if (typeof record.outputDir !== 'string') return null;

	return {
		runKind: 'ai-model-direct',
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
