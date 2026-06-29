import type { LiatirAIModelRecord } from '@liatir/core';
import type { AIPythonRunResult } from '$lib/ai/runtime';
import { parseDirectRunContext } from '$lib/ai/direct-run-context';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { analysisRuns, type RunOutputFile } from '$lib/stores/analysisRuns.svelte';
import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
import {
	celltypistAnnotateDefinition,
	finalizeCelltypistAnnotateResult
} from '$lib/tools/ai/celltypist-annotate';
import {
	proteinStructureDefinition,
	finalizeProteinStructureResult
} from '$lib/tools/ai/protein-structure';
import {
	sequenceEmbeddingDefinition,
	finalizeSequenceEmbeddingResult
} from '$lib/tools/ai/sequence-embedding';
import type { ToolOutput } from '$lib/types/tool-output';

type FinalizedAIToolResult = {
	outputFiles: RunOutputFile[];
	output: ToolOutput;
	metrics: Record<string, number>;
	values: Record<string, unknown>;
};

const finalizing = new Set<string>();

function isDirectAIJob(job: JobEntry): boolean {
	return job.kind === 'ai-python' && parseDirectRunContext(job.metadata) !== null;
}

export function hasRunningDirectAIJob(jobs: JobEntry[]): boolean {
	return jobs.some((job) => isDirectAIJob(job) && job.status.type === 'running');
}

function statusExitCode(job: JobEntry): number | null {
	return job.status.type === 'done' || job.status.type === 'failed'
		? (job.status.exitCode ?? null)
		: null;
}

function outputToResult(
	job: JobEntry,
	output: JobBufferedOutput,
	startedAt: number
): AIPythonRunResult {
	const exitCode = statusExitCode(job);
	return {
		ok: job.status.type === 'done' && (exitCode === null || exitCode === 0),
		exitCode,
		stdout: output.stdout.join('\n'),
		stderr: output.stderr.join('\n'),
		durationMs: (job.endedAtMs ?? Date.now()) - startedAt
	};
}

function outputToLog(job: JobEntry, output: JobBufferedOutput): string[] {
	const command = [job.cmd, ...job.args].join(' ');
	const logs = [`$ ${command}`];
	if (output.stderr.length > 0) logs.push(...output.stderr);
	if (output.stdout.length > 0) logs.push(...output.stdout);
	return logs;
}

async function finalizeToolResult(
	model: LiatirAIModelRecord,
	toolId: string,
	params: Record<string, string>,
	result: AIPythonRunResult,
	onLog: (line: string) => void
): Promise<FinalizedAIToolResult> {
	if (toolId === celltypistAnnotateDefinition.id) {
		return await finalizeCelltypistAnnotateResult(model, params, result, onLog);
	}
	if (toolId === sequenceEmbeddingDefinition.id) {
		return await finalizeSequenceEmbeddingResult(model, params, result, onLog);
	}
	if (toolId === proteinStructureDefinition.id) {
		return await finalizeProteinStructureResult(model, params, result, onLog);
	}
	throw new Error(`Unsupported AI Tool finalizer: ${toolId}`);
}

export async function finalizeCompletedAIDirectRuns(jobs: JobEntry[]): Promise<void> {
	await analysisRuns.init();
	await aiModelsStore.init();

	for (const job of jobs) {
		const context = parseDirectRunContext(job.metadata);
		if (!context || job.kind !== 'ai-python' || job.status.type === 'running') continue;
		if (analysisRuns.runs.some((run) => run.id === context.analysisRunId)) continue;
		if (finalizing.has(context.analysisRunId)) continue;

		finalizing.add(context.analysisRunId);
		try {
			const endedAt = job.endedAtMs ?? Date.now();
			const modelId =
				typeof job.metadata?.modelId === 'string' ? job.metadata.modelId : context.params.modelId;
			const model = modelId ? aiModelsStore.byId(modelId) : null;
			const output = await jobsStore.getOutput(job.id);
			const logs = output ? outputToLog(job, output) : [`$ ${[job.cmd, ...job.args].join(' ')}`];

			if (!model) {
				throw new Error(modelId ? `Unknown AI Model: ${modelId}` : 'AI Model metadata is missing.');
			}
			if (!output) {
				throw new Error(`Buffered output is not available for job ${job.id}.`);
			}
			if (job.status.type === 'killed') {
				throw new Error('AI Model run was killed.');
			}

			const onLog = (line: string) => {
				if (line.trim()) logs.push(line);
			};
			const result = outputToResult(job, output, context.startedAt);
			const finalized = await finalizeToolResult(
				model,
				context.toolId,
				context.params,
				result,
				onLog
			);

			await analysisRuns.add({
				id: context.analysisRunId,
				tool: context.toolId,
				label: context.label,
				inputs: context.inputPaths,
				inputSizes: context.inputSizes,
				outputFiles: finalized.outputFiles,
				params: context.params,
				status: 'done',
				startedAt: context.startedAt,
				endedAt,
				durationMs: endedAt - context.startedAt,
				output: finalized.output ?? null,
				error: null,
				log: logs
			});
		} catch (error) {
			const endedAt = job.endedAtMs ?? Date.now();
			const message = error instanceof Error ? error.message : String(error);
			const output = await jobsStore.getOutput(job.id).catch(() => null);
			const logs = output ? outputToLog(job, output) : [`$ ${[job.cmd, ...job.args].join(' ')}`];
			logs.push(`Error: ${message}`);

			await analysisRuns.add({
				id: context.analysisRunId,
				tool: context.toolId,
				label: context.label,
				inputs: context.inputPaths,
				inputSizes: context.inputSizes,
				params: context.params,
				status: 'error',
				startedAt: context.startedAt,
				endedAt,
				durationMs: endedAt - context.startedAt,
				output: null,
				error: message,
				log: logs
			});
		} finally {
			finalizing.delete(context.analysisRunId);
		}
	}
}
