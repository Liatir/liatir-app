import { expect, it, vi } from 'vitest';
import { installSvelteRuneStubs } from './support/svelte-runes';
installSvelteRuneStubs();
const harness = vi.hoisted(() => ({
  files: new Map<string, string>(), workspace: { activeId: 'pipeline-owner-a' as string | null },
  run: vi.fn(),
}));
vi.mock('$lib/stores/workspace.svelte', () => ({ workspaceStore: harness.workspace, SANDBOX_WORKSPACE_ID: '__test__', getDataPrefix: () => `workspaces/${harness.workspace.activeId}/` }));
vi.mock('$lib/api', () => ({ liatir: () => ({ invoke: vi.fn(async (command: string, payload: Record<string, unknown>) => {
  if (command === 'lia_fs_paths') return { data: '/data' };
  if (command === 'lia_fs_list_dir') return [];
  if (command === 'lia_fs_write_text') harness.files.set(String(payload.rel), String(payload.contents));
  if (command === 'lia_fs_read_text') return harness.files.get(String(payload.rel));
  return null;
}) }) }));
vi.mock('$lib/stores/app-storage', () => ({ appStorage: { exists: async (path: string) => harness.files.has(path),
  readText: async (path: string) => harness.files.get(path), writeText: async (path: string, text: string) => { harness.files.set(path, text); } } }));
vi.mock('$lib/stores/dataFiles.svelte', () => ({ dataFiles: { init: async () => {}, registerOutputs: async () => {}, files: [] } }));
vi.mock('$lib/stores/aiModels.svelte', () => ({ aiModelsStore: { init: async () => {}, runnableModels: [] } }));
vi.mock('$lib/stores/lia-plugins.svelte', () => ({ liaPluginsStore: { init: async () => {} } }));
vi.mock('$lib/stores/python-scripts.svelte', () => ({ pythonScripts: { init: async () => {} } }));
vi.mock('$lib/stores/externalWorkflows.svelte', () => ({ externalWorkflowsStore: { init: async () => {} } }));
vi.mock('$lib/stores/apiConnections.svelte', () => ({ apiConnections: { init: async () => {} }, flattenApiOutputSchema: vi.fn(), sendApiRequest: vi.fn() }));
vi.mock('$lib/tools/pipeline-registry', () => ({ resolveStepEntry: () => ({
  definition: { id: 'fixture', type: 'utility', label: 'Fixture', inputSchema: {}, outputSchema: {}, category: 'Test', description: 'Fixture' }, run: harness.run,
}) }));
const { pipelineStore } = await import('../../frontend/src/lib/stores/pipeline.svelte');
const { executionRuns } = await import('../../frontend/src/lib/stores/executionRuns.svelte');
const { analysisRuns } = await import('../../frontend/src/lib/stores/analysisRuns.svelte');

it('settles a departing workspace pipeline against its captured store without replacing the next workspace graph', async () => {
  let started!: () => void; const entered = new Promise<void>(resolve => started = resolve);
  let finish!: () => void; const gate = new Promise<void>(resolve => finish = resolve);
  harness.run.mockImplementation(async () => { started(); await gate; return { outputFiles: [] }; });
  const nodes = [{ id: 'node-a', type: 'tool', position: { x: 0, y: 0 }, data: { stepId: 'fixture', inputs: {} } }];
  await pipelineStore.createPipeline('Owned by A', nodes, []);
  const pending = pipelineStore.run(nodes, []);
  await entered;
  pipelineStore.deactivate(); executionRuns.deactivate(); analysisRuns.reset();
  harness.workspace.activeId = 'pipeline-owner-b';
  await pipelineStore.createPipeline('Owned by B', [], []);
  finish(); const completed = await pending;
  expect(completed?.identity.workspaceId).toBe('pipeline-owner-a');
  expect(completed?.status).toBe('cancelled');
  expect(pipelineStore.savedPipelines.map(item => item.name)).toEqual(['Owned by B']);
  expect(JSON.parse(harness.files.get('workspaces/pipeline-owner-a/pipeline-workspace.json')!).saved[0].name).toBe('Owned by A');
  expect(JSON.parse(harness.files.get('workspaces/pipeline-owner-b/pipeline-workspace.json')!).saved[0].name).toBe('Owned by B');
  expect(harness.files.has('workspaces/pipeline-owner-b/analysis-runs/index.json')).toBe(false);
  expect(JSON.parse(harness.files.get('workspaces/pipeline-owner-a/analysis-runs/index.json')!)[0].status).toBe('cancelled');
});


it('refuses to start an execution in a different workspace after asynchronous preparation', async () => {
  const { createLiatirRootExecutionIdentity } = await import('@liatir/core');
  const sourceOwner = harness.workspace.activeId!;
  harness.workspace.activeId = 'other-workspace';
  executionRuns.deactivate();
  await expect(executionRuns.begin({ identity: createLiatirRootExecutionIdentity({ runId: 'delayed-script-start',
    runKind: 'python-script', workspaceId: sourceOwner, entityId: 'script' }), label: 'Script', resultPolicy: 'own' }))
    .rejects.toThrow(/does not match/);
});
