import {
  LIATIR_SCRIPT_STEP_PREFIX,
  createLiatirRootExecutionIdentity,
  liatirExecutionMetadata,
  liatirPluginPipelineInputs,
  validateLiatirScript,
  type JsonValue,
  type LiatirPythonScript,
} from '@liatir/core';
import type { AIRunContext } from '$lib/ai/direct-run-context';
import { liatir } from '$lib/api';
import { finalizeExecutionResult } from '$lib/execution/finalization';
import { throwIfRunCancelled } from '$lib/pipeline/cancellation';
import { waitForJobSettlement } from '$lib/pipeline/job-settlement';
import { executionRuns } from '$lib/stores/executionRuns.svelte';
import type { PipelineRegistryEntry, PipelineStepDefinition } from '$lib/types/pipeline';
import { savePluginResultFiles } from '$lib/utils/plugin-files';

/** The runner prints exactly one line with this prefix: the SDK-validated output object. */
const RESULT_MARKER = '__LIATIR_RESULT__';

type ScriptRunContext = Pick<AIRunContext, 'execution' | 'signal' | 'onJobId'>;

function snapshot(script: LiatirPythonScript): LiatirPythonScript {
  return JSON.parse(JSON.stringify(script)) as LiatirPythonScript;
}

export function scriptDefinition(script: LiatirPythonScript): PipelineStepDefinition {
  return {
    id: `${LIATIR_SCRIPT_STEP_PREFIX}${script.id}`,
    type: 'python-script',
    label: script.name,
    description: 'Workspace Python script with validated inputs and outputs.',
    category: 'Scripts',
    inputSchema: script.inputSchema,
    outputSchema: script.outputSchema,
  };
}

export function scriptRegistryEntry(saved: LiatirPythonScript): PipelineRegistryEntry {
  // Copied now: later edits in the editor must not change a run that has already started.
  const script = snapshot(saved);
  return {
    definition: scriptDefinition(script),
    run(inputs, _dir, onLog, context) {
      if (!context) throw new Error('Script execution context is required.');
      return executeScript(script, inputs, onLog, context);
    },
  };
}

async function executeScript(
  script: LiatirPythonScript,
  inputs: Record<string, string>,
  onLog: (line: string) => void,
  context: ScriptRunContext,
) {
  validateLiatirScript(script);
  throwIfRunCancelled(context.signal);
  const api = liatir();
  if (!api) throw new Error('Liatir is unavailable.');
  const workspaceId = context.execution.workspaceId;
  if (!workspaceId) throw new Error('A Python script runs inside a workspace.');

  const { jobId } = await api.scripts.run({
    script,
    workspaceId,
    runId: context.execution.runId,
    inputs: liatirPluginPipelineInputs(script.inputSchema, inputs) as Record<string, JsonValue>,
    metadata: liatirExecutionMetadata(context.execution),
  });
  context.onJobId?.(jobId);
  // Preparing the Python environment can outlast a cancellation; stop the late process too.
  if (context.signal?.aborted) await api.invoke('lia_jobs_kill', { jobId });

  const results: unknown[] = [];
  const settled = await waitForJobSettlement(api, jobId, {
    signal: context.signal,
    onStdout(line) {
      if (line.startsWith(RESULT_MARKER)) results.push(JSON.parse(line.slice(RESULT_MARKER.length)));
      else onLog(line);
    },
    onStderr: onLog,
  });
  if (settled.entry.status.type !== 'done' || (settled.entry.status.exitCode ?? 0) !== 0) {
    throw new Error('The Python script failed. Its Job log shows why.');
  }
  const [result] = results;
  if (results.length !== 1 || !result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The script did not return one validated output object.');
  }
  const values = result as Record<string, JsonValue>;
  const runtimeLock = settled.entry.metadata?.runtimeLock ?? null;
  const outputFiles = await savePluginResultFiles(script.name, script.outputSchema, values, context.execution.runId);
  return {
    outputFiles,
    values,
    executionEvidence: { scriptSnapshot: script as unknown as JsonValue, runtimeLock },
    output: {
      sections: [
        { type: 'text' as const, label: script.name, content: JSON.stringify(values, null, 2), mono: true },
        { type: 'text' as const, label: 'Python packages used', content: JSON.stringify(runtimeLock ?? {}, null, 2), mono: true },
      ],
    },
  };
}

/** Runs a saved Script from its editor as a standalone, cancellable Job with its own Result. */
export async function runScriptDirect(
  script: LiatirPythonScript,
  inputs: Record<string, string>,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId) throw new Error('Open a workspace first.');
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const frozen = snapshot(script);
  const identity = createLiatirRootExecutionIdentity({ runId, runKind: 'python-script', workspaceId, entityId: script.id });
  await executionRuns.begin({
    identity, label: script.name, resultPolicy: 'own', resultId: runId,
    inputs, params: { scriptSnapshot: frozen as unknown as JsonValue }, startedAt,
  });
  const result = {
    id: runId, tool: `${LIATIR_SCRIPT_STEP_PREFIX}${script.id}`, label: script.name,
    inputs: Object.values(inputs), params: { scriptSnapshot: frozen }, sideEffects: [], startedAt,
  };
  try {
    const output = await executeScript(frozen, inputs, (line) => {
      void executionRuns.appendLog(runId, line).catch(() => {});
    }, {
      execution: identity,
      signal: executionRuns.signal(runId),
      onJobId: (jobId) => { void executionRuns.attachJob(runId, jobId).catch(() => {}); },
    });
    const endedAt = Date.now();
    await finalizeExecutionResult(runId, 'done', {
      ...result, output: output.output, outputFiles: output.outputFiles,
      endedAt, durationMs: endedAt - startedAt, error: null,
    });
  } catch (error) {
    const endedAt = Date.now();
    await finalizeExecutionResult(runId, executionRuns.signal(runId)?.aborted ? 'cancelled' : 'error', {
      ...result, output: null, endedAt, durationMs: endedAt - startedAt, error: String(error),
    });
    throw error;
  }
}
