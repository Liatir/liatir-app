/**
 * Turns finished AI jobs into Results.
 *
 * An AI Tool run is a background job, and the page that started it is not what completes it — the
 * user is free to navigate away, or close and reopen the app, while a model runs for minutes. So
 * finalization is driven by the *jobs list*, not by any screen: whoever observes a finished job
 * converts it into a saved analysis run, whenever that happens to be.
 *
 * That makes idempotence essential, since this may be called repeatedly and from more than one
 * place. Two guards ensure a run is recorded exactly once:
 *
 *   - the analysis run ID is allocated *up front* and carried in the job's metadata (see
 *     `direct-run-context`), so it is stable across reloads — an already-recorded run is skipped;
 *   - `finalizing` blocks a second, concurrent finalization of the same run before the first has
 *     managed to persist it.
 *
 * A failure is recorded too, never dropped: a run that errored still becomes a Result, carrying its
 * log and message, because "it disappeared" is the least debuggable outcome for a user.
 */
import type { LiatirAIModelRecord } from '@liatir/core';
import type { AIPythonRunResult } from '$lib/ai/runtime';
import { runtimeBoxActivationFromMetadata } from '$lib/ai/runtime-box-provenance';
import { parseDirectRunContext } from '$lib/ai/direct-run-context';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { analysisRuns, type RunOutputFile } from '$lib/stores/analysisRuns.svelte';
import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
import {
	singleCellEmbeddingDefinition,
	finalizeSingleCellEmbeddingResult
} from '$lib/tools/ai/single-cell-embedding';
import {
	finalizeMhcFlurryEpitopeResult,
	mhcFlurryEpitopeDefinition
} from '$lib/tools/ai/mhcflurry-epitope';
import {
	finalizeStructurePredictionResult,
	proteinLigandAffinityDefinition,
	structurePredictionDefinition
} from '$lib/tools/ai/structure-prediction';
import type { ToolOutput } from '$lib/types/tool-output';
import { finalizeExecutionResult } from '$lib/execution/finalization';

type FinalizedAIToolResult = {
	outputFiles: RunOutputFile[];
	/** What the model wrote on the way to the answer — see `finalizeExecutionResult`. */
	sideEffects: RunOutputFile[];
	output: ToolOutput;
	metrics: Record<string, number>;
	values: Record<string, unknown>;
};

/** Analysis run IDs being finalized right now — the in-flight half of the idempotence guard. */
const finalizing = new Set<string>();

/** An AI job started from a tool page, as opposed to one started by a pipeline or a plugin. */
function isDirectAIJob(job: JobEntry): boolean {
	return job.kind === 'ai-python' && parseDirectRunContext(job.metadata) !== null;
}

export function hasRunningDirectAIJob(jobs: JobEntry[]): boolean {
	return jobs.some((job) => isDirectAIJob(job) && job.status.type === 'running');
}

/** Only a finished process has an exit code; a running or killed one yields null. */
function statusExitCode(job: JobEntry): number | null {
	return job.status.type === 'done' || job.status.type === 'failed'
		? (job.status.exitCode ?? null)
		: null;
}

/**
 * Reshapes a finished job into the result object the per-tool finalizers expect — the same shape
 * they would have received had the script been run synchronously, so they need no special case.
 */
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
		durationMs: (job.endedAtMs ?? Date.now()) - startedAt,
		runtimeBoxActivation: runtimeBoxActivationFromMetadata(job.metadata)
	};
}

/**
 * Builds the log stored with the Result: the command that was run, then stderr, then stdout.
 *
 * stderr comes first deliberately — it is where Python tracebacks and progress go, so the reason a
 * run failed is at the top of the log rather than buried under pages of normal output.
 */
function outputToLog(job: JobEntry, output: JobBufferedOutput): string[] {
	const command = [job.cmd, ...job.args].join(' ');
	const logs = [`$ ${command}`];
	if (output.stderr.length > 0) logs.push(...output.stderr);
	if (output.stdout.length > 0) logs.push(...output.stdout);
	return logs;
}

/**
 * Routes to the tool's own finalizer, which parses the script's raw output into the structured
 * result (files, plots, metrics) the UI renders. Each AI Tool knows how to read its own output;
 * this only dispatches. An unknown tool ID throws rather than silently producing an empty Result.
 */
async function finalizeToolResult(
	model: LiatirAIModelRecord,
	toolId: string,
	params: Record<string, string>,
	result: AIPythonRunResult,
	onLog: (line: string) => void,
	outputDir: string
): Promise<FinalizedAIToolResult> {
	if (toolId === singleCellEmbeddingDefinition.id) {
		return await finalizeSingleCellEmbeddingResult(model, params, result, onLog);
	}
	if (toolId === mhcFlurryEpitopeDefinition.id) {
		return await finalizeMhcFlurryEpitopeResult(model, params, result, onLog);
	}
	if (toolId === structurePredictionDefinition.id || toolId === proteinLigandAffinityDefinition.id) {
		return await finalizeStructurePredictionResult(model, params, result, onLog, outputDir);
	}
	throw new Error(`Unsupported AI Tool finalizer: ${toolId}`);
}

/**
 * Scans the jobs list and records a Result for every completed AI run not yet saved.
 *
 * Safe to call as often as the jobs list changes: the two guards below make repeated calls a no-op
 * for runs that are already recorded or already being recorded.
 */
export async function finalizeCompletedAIDirectRuns(jobs: JobEntry[]): Promise<void> {
	// Both stores must be loaded before the checks below — an uninitialised analysisRuns would
	// report no existing runs and this would duplicate every one of them.
	await analysisRuns.init();
	await aiModelsStore.init();

	for (const job of jobs) {
		const context = parseDirectRunContext(job.metadata);
		if (!context || job.kind !== 'ai-python' || job.status.type === 'running') continue;
		// Already saved (e.g. finalized before the app was last closed).
		if (analysisRuns.runs.some((run) => run.id === context.analysisRunId)) continue;
		// Being saved right now by a concurrent call.
		if (finalizing.has(context.analysisRunId)) continue;

		finalizing.add(context.analysisRunId);
		try {
			const endedAt = job.endedAtMs ?? Date.now();
			// The job's own metadata wins over the run context: it is what the backend actually ran.
			const modelId =
				typeof job.metadata?.modelId === 'string' ? job.metadata.modelId : context.params.modelId;
			const model = modelId ? aiModelsStore.byId(modelId) : null;
			const output = await jobsStore.getOutput(job.id);
			// Collected before the guards below, so even a failing run keeps whatever it printed.
			const logs = output ? outputToLog(job, output) : [`$ ${[job.cmd, ...job.args].join(' ')}`];

			// Each of these throws into the catch, which still records a Result — with the error and
			// the log — rather than dropping the run.
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
				onLog,
				context.outputDir
			);

			await finalizeExecutionResult(context.execution.runId, 'done', {
				id: context.analysisRunId,
				tool: context.toolId,
				label: context.label,
				inputs: context.inputPaths,
				inputSizes: context.inputSizes,
				outputFiles: finalized.outputFiles,
				sideEffects: finalized.sideEffects,
				params: context.params,
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

			const terminalStatus = job.status.type === 'killed' ? 'cancelled' : 'error';
			await finalizeExecutionResult(context.execution.runId, terminalStatus, {
				id: context.analysisRunId,
				tool: context.toolId,
				label: context.label,
				inputs: context.inputPaths,
				inputSizes: context.inputSizes,
				// The run failed before the finalizer could inspect what the model left behind.
				sideEffects: [],
				params: context.params,
				startedAt: context.startedAt,
				endedAt,
				durationMs: endedAt - context.startedAt,
				output: null,
				error: terminalStatus === 'cancelled' ? 'AI Model run was cancelled.' : message,
				log: logs
			});
		} finally {
			finalizing.delete(context.analysisRunId);
		}
	}
}
