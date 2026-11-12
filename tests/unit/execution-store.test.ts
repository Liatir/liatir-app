import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLiatirChildExecutionIdentity,
  createLiatirExternalWorkflowRunIdentity,
  createLiatirRootExecutionIdentity,
} from '@liatir/core';

const harness = vi.hoisted(() => ({
  files: new Map<string, string>(),
  workspace: { activeId: 'workspace-a' as string | null },
  invocations: [] as Array<{ command: string; payload: unknown }>,
}));

vi.stubGlobal('$state', <T>(value: T) => value);

vi.mock('$lib/api', () => ({
  liatir: () => ({
    invoke: vi.fn(async (command: string, payload: unknown) => {
      harness.invocations.push({ command, payload });
      return command === 'lia_file_size' ? 10 : null;
    }),
  }),
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  workspaceStore: harness.workspace,
  getDataPrefix: () => harness.workspace.activeId ? `workspaces/${harness.workspace.activeId}/` : '',
}));

vi.mock('$lib/stores/app-storage', () => ({
  appStorage: {
    writeText: vi.fn(async (path: string, content: string) => { harness.files.set(path, content); }),
    readText: vi.fn(async (path: string) => harness.files.get(path) ?? ''),
    exists: vi.fn(async (path: string) => harness.files.has(path)),
    remove: vi.fn(async (path: string) => { harness.files.delete(path); }),
    path: vi.fn(async () => '/app-storage'),
  },
}));

const { executionRuns } = await import('../../frontend/src/lib/stores/executionRuns.svelte');
const { analysisRuns } = await import('../../frontend/src/lib/stores/analysisRuns.svelte');
const {
  finalizeExecutionResult,
  reconcileExecutionResults,
} = await import('../../frontend/src/lib/execution/finalization');

function identity(runId: string) {
  return createLiatirRootExecutionIdentity({
    runId,
    runKind: 'lia-plugin',
    workspaceId: harness.workspace.activeId!,
    entityId: 'plugin',
  });
}

function result(runId: string, status: 'done' | 'error' = 'done') {
  return {
    id: runId,
    tool: 'plugin',
    label: 'Plugin',
    inputs: [],
    params: {},
    // Required by the recording rule: every caller states what it left on disk. This fixture is a
    // plugin run that produced nothing.
    sideEffects: [],
    status,
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    output: null,
    error: status === 'error' ? 'failed' : null,
  } as const;
}

describe.sequential('durable execution store', () => {
  beforeEach(() => {
    harness.files.clear();
    harness.invocations.length = 0;
    harness.workspace.activeId = 'workspace-a';
    executionRuns.reset();
    analysisRuns.reset();
  });

  it('keeps a live Plugin in its original workspace across navigation and completion', async () => {
    const runId = 'plugin-cross-workspace';
    await executionRuns.begin({ identity: identity(runId), label: 'Plugin', resultPolicy: 'own', resultId: runId });
    const signal = executionRuns.signal(runId);
    executionRuns.deactivate(); analysisRuns.reset();
    harness.workspace.activeId = 'workspace-b';
    await executionRuns.init();
    expect(signal?.aborted).toBe(false);
    expect(executionRuns.records).toHaveLength(0);
    await executionRuns.appendLog(runId, 'Finished in the original workspace');
    const { status: _, ...finished } = result(runId);
    await finalizeExecutionResult(runId, 'done', finished);
    expect(analysisRuns.runs).toHaveLength(0);
    expect(JSON.parse(harness.files.get('workspaces/workspace-a/analysis-runs/index.json')!)[0].id).toBe(runId);
    expect(harness.files.has('workspaces/workspace-b/analysis-runs/index.json')).toBe(false);
    expect(harness.invocations.some(call => call.command === 'lia_fs_write_text' &&
      (call.payload as { rel: string }).rel === `workspaces/workspace-a/runs/${runId}/metadata.json`)).toBe(true);
    executionRuns.deactivate(); harness.workspace.activeId = 'workspace-a'; await executionRuns.init();
    expect(executionRuns.byId(runId)?.status).toBe('done');
  });

  it('clears only the active workspace on reset, leaving another workspace live run running', async () => {
    const runId = 'live-in-workspace-a';
    await executionRuns.begin({ identity: identity(runId), label: 'A', resultPolicy: 'own', resultId: runId });
    const signal = executionRuns.signal(runId);
    executionRuns.deactivate();
    harness.workspace.activeId = 'workspace-b';
    await executionRuns.init();
    executionRuns.reset();
    expect(signal?.aborted).toBe(false);
    expect(executionRuns.byId(runId)).not.toBeNull();
    harness.workspace.activeId = 'workspace-a';
    executionRuns.reset();
    expect(signal?.aborted).toBe(true);
    expect(executionRuns.byId(runId)).toBeNull();
  });

  it('records a Python Script as the producer of its file artifacts', async () => {
    const runId = 'script-provenance';
    await executionRuns.begin({ identity: createLiatirRootExecutionIdentity({ runId, runKind: 'python-script',
      workspaceId: harness.workspace.activeId!, entityId: 'script-a' }), label: 'Script', resultPolicy: 'own' });
    const { status: _, ...finished } = result(runId);
    await finalizeExecutionResult(runId, 'done', { ...finished, outputFiles: [{ path: '/script.csv', label: 'Output', ext: 'csv' }] });
    expect((await analysisRuns.committed(runId))?.outputFiles?.[0].producer?.kind).toBe('python-script');
  });

  it('commits one Result when concurrent terminal observers race', async () => {
    const runId = 'run-race';
    await executionRuns.begin({
      identity: identity(runId), label: 'Plugin', resultPolicy: 'own', resultId: runId,
    });
    const { status: _firstStatus, ...firstResult } = result(runId);
    const { status: _secondStatus, ...secondResult } = result(runId, 'error');
    const [first, second] = await Promise.all([
      finalizeExecutionResult(runId, 'done', firstResult),
      finalizeExecutionResult(runId, 'error', secondResult),
    ]);

    expect(first.status).toBe('done');
    expect(second.status).toBe('done');
    expect(analysisRuns.runs.filter((item) => item.id === runId)).toHaveLength(1);
    expect(executionRuns.byId(runId)).toMatchObject({ status: 'done', resultId: runId });
  });

  it('reconciles one interrupted Result after a simulated restart', async () => {
    const runId = 'run-restart';
    await executionRuns.begin({
      identity: identity(runId), label: 'Plugin', resultPolicy: 'own', resultId: runId,
    });
    executionRuns.reset();
    analysisRuns.reset();

    await reconcileExecutionResults();
    await reconcileExecutionResults();

    expect(executionRuns.byId(runId)?.status).toBe('interrupted');
    expect(executionRuns.byId(runId)?.finalizedAt).toBeTypeOf('number');
    expect(analysisRuns.runs.filter((item) => item.id === runId)).toHaveLength(1);
    expect(analysisRuns.runs[0]?.error).toMatch(/interrupted/i);
  });

  it('keeps an interrupted External Workflow in its saved definition history', async () => {
    const runId = 'external-restart';
    await executionRuns.begin({
      identity: createLiatirExternalWorkflowRunIdentity({
        runId,
        workspaceId: harness.workspace.activeId!,
        entityId: 'workflow-a',
      }),
      label: 'Workflow A',
      resultPolicy: 'own',
      resultId: runId,
    });
    executionRuns.reset();
    analysisRuns.reset();

    await reconcileExecutionResults();
    await reconcileExecutionResults();

    expect(analysisRuns.runs.filter((item) => item.id === runId)).toHaveLength(1);
    expect(analysisRuns.runs[0]).toMatchObject({
      tool: 'external-workflow:workflow-a',
      status: 'error',
    });
  });

  it('does not leak execution state across workspaces', async () => {
    await executionRuns.begin({
      identity: identity('workspace-a-run'), label: 'A', resultPolicy: 'none',
    });
    const misplacedWorkspaceAState = harness.files.get('workspaces/workspace-a/execution-runs/index.json');
    executionRuns.reset();
    harness.workspace.activeId = 'workspace-b';
    harness.files.set(
      'workspaces/workspace-b/execution-runs/index.json',
      misplacedWorkspaceAState ?? '[]',
    );
    await executionRuns.init();

    expect(executionRuns.records).toEqual([]);
    await expect(executionRuns.begin({
      identity: createLiatirRootExecutionIdentity({
        runId: 'wrong-workspace', runKind: 'dependency', workspaceId: 'workspace-a',
      }),
      label: 'Wrong', resultPolicy: 'none',
    })).rejects.toThrow(/active workspace/);
  });

  it('persists resolved inputs and execution evidence before finalization', async () => {
    const runId = 'run-evidence';
    await executionRuns.begin({
      identity: identity(runId), label: 'Workflow', resultPolicy: 'own',
    });
    await executionRuns.setPayload(runId, {
      inputs: ['/data/input.txt'],
      params: {
        label: 'sample',
        externalWorkflow: { engine: 'nextflow', finalStatus: 'done' },
      },
    });

    expect(executionRuns.byId(runId)).toMatchObject({
      inputs: ['/data/input.txt'],
      params: {
        label: 'sample',
        externalWorkflow: { engine: 'nextflow', finalStatus: 'done' },
      },
    });
    expect(JSON.parse(harness.files.get('workspaces/workspace-a/execution-runs/index.json') ?? '[]')[0])
      .toMatchObject({ params: { externalWorkflow: { engine: 'nextflow' } } });
  });

  it('cancels only an owned run tree and its Jobs', async () => {
    const rootA = identity('root-a');
    const childA = createLiatirChildExecutionIdentity(rootA, {
      runId: 'child-a', runKind: 'lia-plugin', entityId: 'child-plugin',
    });
    const rootB = identity('root-b');
    await executionRuns.begin({ identity: rootA, label: 'A', resultPolicy: 'own' });
    await executionRuns.begin({ identity: childA, label: 'A child', resultPolicy: 'parent' });
    await executionRuns.begin({ identity: rootB, label: 'B', resultPolicy: 'own' });
    await executionRuns.attachJob(rootA.runId, 'job-a-root');
    await executionRuns.attachJob(childA.runId, 'job-a-child');
    await executionRuns.attachJob(rootB.runId, 'job-b');

    const signalA = executionRuns.signal(rootA.runId);
    const childSignalA = executionRuns.signal(childA.runId);
    const signalB = executionRuns.signal(rootB.runId);
    await executionRuns.cancel(rootA.runId);

    expect(executionRuns.byId(rootA.runId)?.status).toBe('cancelling');
    expect(executionRuns.byId(childA.runId)?.status).toBe('cancelling');
    expect(executionRuns.byId(rootB.runId)?.status).toBe('running');
    expect(signalA?.aborted).toBe(true);
    expect(childSignalA?.aborted).toBe(true);
    expect(signalB?.aborted).toBe(false);
    expect(harness.invocations.filter(({ command }) => command === 'lia_jobs_kill'))
      .toEqual(expect.arrayContaining([
        { command: 'lia_jobs_kill', payload: { jobId: 'job-a-root' } },
        { command: 'lia_jobs_kill', payload: { jobId: 'job-a-child' } },
      ]));
    expect(harness.invocations).not.toContainEqual({
      command: 'lia_jobs_kill', payload: { jobId: 'job-b' },
    });
  });
});
