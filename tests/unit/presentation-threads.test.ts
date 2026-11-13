import { beforeEach, expect, it, vi } from 'vitest';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const harness = vi.hoisted(() => ({
  files: new Map<string, string>(),
  outputs: new Map<string, unknown>(),
  calls: [] as Array<{ resultIds: string[]; instruction: string; previous?: unknown }>,
}));

vi.mock('$lib/stores/workspace.svelte', () => ({ getDataPrefix: () => 'workspaces/a/' }));
vi.mock('$lib/stores/app-storage', () => ({ appStorage: {
  exists: async (path: string) => harness.files.has(path),
  readText: async (path: string) => harness.files.get(path)!,
  writeText: async (path: string, value: string) => { harness.files.set(path, value); },
} }));
vi.mock('$lib/stores/executionRuns.svelte', () => ({ executionRuns: { byId: () => null } }));
vi.mock('$lib/stores/analysisRuns.svelte', () => ({ analysisRuns: {
  loadOutput: async (id: string) => harness.outputs.get(id) ?? null,
  committed: async (id: string) => ({ id, label: `Title of ${id}` }),
} }));
vi.mock('$lib/quenta/presentations', () => ({
  generatePresentation: async (resultIds: string[], instruction: string, _config: unknown,
    options: { previous?: unknown; onStart?: (id: string) => void; onProgress?: (progress: unknown) => void }) => {
    harness.calls.push({ resultIds, instruction, previous: options.previous });
    const id = `version-${harness.calls.length}`;
    options.onStart?.(`run-${id}`);
    options.onProgress?.({ stage: 'writing', characters: 10 });
    harness.outputs.set(id, { sections: [{ type: 'html-presentation', label: id, presentation: { title: id, page: { title: id } } }] });
    return id;
  },
}));

const { presentationThreads } = await import('../../frontend/src/lib/stores/presentation-threads.svelte');
const config = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434', model: 'm', temperature: 0.1 };

beforeEach(() => {
  harness.files.clear(); harness.outputs.clear(); harness.calls.length = 0;
  presentationThreads.reset();
});

it('saves one version per message and revises the newest version on a follow-up', async () => {
  await presentationThreads.init();
  const id = await presentationThreads.create(['result-1']);
  await presentationThreads.send(id, 'Show this simply', config);
  await presentationThreads.send(id, 'Make the chart bigger', config);

  const thread = presentationThreads.byId(id)!;
  expect(thread.turns.map((turn) => [turn.status, turn.resultId])).toEqual([['done', 'version-1'], ['done', 'version-2']]);
  expect(thread.title).toBe('Title of version-2');
  expect(harness.calls[0]).toMatchObject({ resultIds: ['result-1'], instruction: 'Show this simply', previous: undefined });
  expect(harness.calls[1].previous).toMatchObject({ page: { title: 'version-1' } });
  expect(presentationThreads.progress(thread.turns[1].id)).toBeUndefined();
  // Saved for this workspace, so the conversation survives navigation and restarts.
  expect(JSON.parse(harness.files.get('workspaces/a/quenta/presentation-threads.json')!)[0].turns).toHaveLength(2);
});

it('marks a version left running by a closed app as interrupted instead of running forever', async () => {
  harness.files.set('workspaces/a/quenta/presentation-threads.json', JSON.stringify([{
    id: 't', title: 'Old', createdAt: 1, updatedAt: 1, resultIds: [],
    turns: [{ id: 'turn', request: 'x', resultIds: [], sentAt: 1, status: 'running' }],
  }]));
  await presentationThreads.init();
  expect(presentationThreads.byId('t')!.turns[0]).toMatchObject({ status: 'interrupted' });
});
