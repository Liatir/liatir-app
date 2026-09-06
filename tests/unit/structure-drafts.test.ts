import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID,
  createLiatirStructureToolDraft,
  parseLiatirComplexSpecDraftJson,
  parseLiatirComplexSpecJson,
  parseLiatirStructureToolDraft,
} from '@liatir/core';

vi.mock('../../frontend/src/lib/stores/app-storage', () => ({ appStorage: {} }));
let createStore: typeof import('../../frontend/src/lib/stores/structureDrafts.svelte').createStructureDraftsStore;
beforeAll(async () => {
  vi.stubGlobal('$state', (value: unknown) => value);
  createStore = (await import('../../frontend/src/lib/stores/structureDrafts.svelte')).createStructureDraftsStore;
});

function draft(id = 'first', workspaceId = 'workspace-a') {
  return createLiatirStructureToolDraft({ id, workspaceId, toolId: BIOMOLECULAR_STRUCTURE_PREDICTION_TOOL_ID });
}

function memoryStorage() {
  const files = new Map<string, string>();
  return {
    files,
    exists: vi.fn(async (path: string) => files.has(path)),
    readText: vi.fn(async (path: string) => files.get(path)!),
    writeText: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
    remove: vi.fn(), mkdir: vi.fn(), path: vi.fn(), migrate: vi.fn(),
  };
}

describe('structure prediction drafts', () => {
  it('restores incomplete simple input without allowing it into an executable request', () => {
    const value = draft();
    expect(parseLiatirComplexSpecDraftJson(value.specJson).spec?.entities).toHaveLength(1);
    expect(parseLiatirComplexSpecDraftJson(value.specJson).valid).toBe(false);
    expect(parseLiatirComplexSpecJson(value.specJson).spec).toBeNull();
    expect(parseLiatirStructureToolDraft(value)).toEqual(value);
    value.specJson = '{"entities":[null]}';
    expect(parseLiatirStructureToolDraft(value)).toBeNull();
  });

  it('keeps malformed advanced text, acknowledgements and independent drafts after restart', async () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    const first = draft();
    first.advanced = true;
    first.advancedJson = '{ unfinished prediction';
    first.msa = { singleSequenceEntityIds: ['protein'], lowerAccuracyAccepted: true };
    await Promise.all([store.save(first), store.save(draft('second')), store.save(draft('first', 'workspace-b'))]);
    const restored = createStore(storage);
    await Promise.all([restored.load('workspace-a'), restored.load('workspace-b')]);
    expect(restored.drafts).toHaveLength(3);
    expect(restored.drafts.find((item) => item.id === 'first' && item.workspaceId === 'workspace-a')).toEqual(first);
    expect(restored.drafts.find((item) => item.workspaceId === 'workspace-b')?.advancedJson).toBe('');
  });

  it('serializes delayed writes and captures the original owner before navigation', async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const write = storage.writeText.getMockImplementation()!;
    storage.writeText.mockImplementationOnce(async (...args) => { await blocked; return write(...args); });
    const store = createStore(storage);
    const input = draft();
    const first = store.save(input);
    input.workspaceId = 'workspace-b';
    const latest = draft();
    latest.label = 'Last edit';
    const second = store.save(latest);
    release();
    await Promise.all([first, second]);
    const saved = JSON.parse(storage.files.get('workspaces/workspace-a/structure-drafts/index.json')!);
    expect(saved[0].label).toBe('Last edit');
    expect(storage.files.has('workspaces/workspace-b/structure-drafts/index.json')).toBe(false);
  });

  it('does not overwrite damaged saved data or another workspace', async () => {
    const storage = memoryStorage();
    const location = 'workspaces/workspace-a/structure-drafts/index.json';
    const original = JSON.stringify([draft('foreign', 'workspace-b')]);
    storage.files.set(location, original);
    await expect(createStore(storage).save(draft())).rejects.toThrow(/original data has been kept/);
    expect(storage.files.get(location)).toBe(original);
    expect(storage.writeText).not.toHaveBeenCalled();
  });
});
