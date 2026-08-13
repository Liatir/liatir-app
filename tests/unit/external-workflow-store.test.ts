import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
  type LiatirExternalWorkflowDefinition,
} from '@liatir/core';

const harness = vi.hoisted(() => ({ stored: new Map<string, string>() }));

vi.stubGlobal('$state', <T>(value: T) => value);

vi.mock('$lib/stores/app-storage', () => ({
  appStorage: {
    writeText: vi.fn(async (path: string, content: string) => harness.stored.set(path, content)),
    readText: vi.fn(async (path: string) => harness.stored.get(path) ?? ''),
    exists: vi.fn(async (path: string) => harness.stored.has(path)),
  },
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  getDataPrefix: () => 'workspaces/workspace-a/',
}));

const { externalWorkflowsStore } = await import(
  '../../frontend/src/lib/stores/externalWorkflows.svelte'
);

function definition(id = 'workflow-1'): LiatirExternalWorkflowDefinition {
  return {
    schemaVersion: LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
    id,
    name: 'Local workflow',
    description: 'Fixture',
    engine: 'nextflow',
    source: { kind: 'local', mainScriptPath: '/tmp/workflow/main.nf' },
    parameters: [],
    inputs: [{ key: 'sample', label: 'Sample', required: true }],
    outputs: [{ key: 'summary', label: 'Summary', relativePath: 'summary.txt', ext: 'txt' }],
    outputDirectoryParameter: 'outdir',
    createdAt: 10,
    updatedAt: 10,
  };
}

describe.sequential('External Workflow saved definitions', () => {
  beforeEach(() => {
    harness.stored.clear();
    externalWorkflowsStore.reset();
  });

  it('persists definitions inside the active workspace and reloads them', async () => {
    await externalWorkflowsStore.save(definition());
    expect(harness.stored.has('workspaces/workspace-a/external-workflows.json')).toBe(true);

    externalWorkflowsStore.reset();
    await externalWorkflowsStore.init();
    expect(externalWorkflowsStore.byId('workflow-1')?.name).toBe('Local workflow');
  });

  it('updates one identity without duplicating it', async () => {
    await externalWorkflowsStore.save(definition());
    await externalWorkflowsStore.save({ ...definition(), name: 'Updated', updatedAt: 20 });

    expect(externalWorkflowsStore.definitions).toHaveLength(1);
    expect(externalWorkflowsStore.byId('workflow-1')?.name).toBe('Updated');
  });

  it('drops malformed records at the persistence trust boundary', async () => {
    harness.stored.set('workspaces/workspace-a/external-workflows.json', JSON.stringify({
      schemaVersion: 1,
      definitions: [definition(), { ...definition('bad'), outputs: [] }],
    }));

    await externalWorkflowsStore.init();
    expect(externalWorkflowsStore.definitions.map((item) => item.id)).toEqual(['workflow-1']);
  });
});
