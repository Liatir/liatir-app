import { beforeEach, expect, it, vi } from 'vitest';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('$lib/api', () => ({ liatir: () => null }));
vi.mock('svelte', () => ({ tick: async () => {} }));
vi.mock('$lib/stores/app-storage', () => ({
  appStorage: {
    writeText: async (path: string, content: string) => { files.set(path, content); },
    readText: async (path: string) => files.get(path) ?? '',
    exists: async (path: string) => files.has(path),
  },
}));

const { workspaceStore, setLeaveGuard, setResetFn } = await import('../../frontend/src/lib/stores/workspace.svelte');

const resets: string[] = [];
setResetFn((scope) => { resets.push(scope); });

beforeEach(() => { resets.length = 0; files.clear(); });

it('stays in the workspace and resets nothing when the user declines to leave', async () => {
  setLeaveGuard(async () => true);
  expect(await workspaceStore.switchTo('a')).toBe(true);
  resets.length = 0;

  setLeaveGuard(async () => false);
  expect(await workspaceStore.switchTo('b')).toBe(false);
  expect(workspaceStore.activeId).toBe('a');
  expect(resets).toEqual([]);

  setLeaveGuard(async () => true);
  expect(await workspaceStore.switchTo('b')).toBe(true);
  expect(workspaceStore.activeId).toBe('b');
  expect(resets).toEqual(['workspace-switch']);
});
