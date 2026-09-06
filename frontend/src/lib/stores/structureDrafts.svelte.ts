import {
  parseLiatirStructureToolDraft,
  type LiatirStructureToolDraft,
} from '@liatir/core';
import { appStorage } from './app-storage';

export function createStructureDraftsStore(storage = appStorage) {
  let drafts = $state<LiatirStructureToolDraft[]>([]);
  const loads = new Map<string, Promise<void>>();
  const writes = new Map<string, Promise<void>>();

  function path(workspaceId: string) {
    if (!/^[A-Za-z0-9_-]+$/u.test(workspaceId)) throw new Error('Invalid draft workspace.');
    return `workspaces/${workspaceId}/structure-drafts/index.json`;
  }

  async function load(workspaceId: string) {
    if (!loads.has(workspaceId)) {
      const operation = (async () => {
        const location = path(workspaceId);
        if (!await storage.exists(location)) return;
        const parsed: unknown = JSON.parse(await storage.readText(location));
        if (!Array.isArray(parsed)) throw new Error('Saved prediction drafts are damaged. Their original data has been kept.');
        const records = parsed.map(parseLiatirStructureToolDraft);
        const seen = new Set<string>();
        for (const record of records) {
          if (!record || record.workspaceId !== workspaceId || seen.has(record.id)) {
            throw new Error('A saved prediction draft is damaged. Its original data has been kept.');
          }
          seen.add(record.id);
        }
        drafts = [...drafts.filter((item) => item.workspaceId !== workspaceId), ...records as LiatirStructureToolDraft[]];
      })();
      loads.set(workspaceId, operation);
      operation.catch(() => loads.delete(workspaceId));
    }
    await loads.get(workspaceId);
  }

  return {
    get drafts() { return drafts; },
    load,
    async save(draft: LiatirStructureToolDraft) {
      // Capture the owner and bytes before yielding: navigation may change the active workspace.
      const snapshot = JSON.parse(JSON.stringify(draft)) as LiatirStructureToolDraft;
      const location = path(snapshot.workspaceId);
      await load(snapshot.workspaceId);
      drafts = [...drafts.filter((item) => item.workspaceId !== snapshot.workspaceId || item.id !== snapshot.id), snapshot];
      const content = JSON.stringify(drafts.filter((item) => item.workspaceId === snapshot.workspaceId));
      const write = (writes.get(snapshot.workspaceId) ?? Promise.resolve()).catch(() => {}).then(
        () => storage.writeText(location, content, { createDirs: true }),
      );
      writes.set(snapshot.workspaceId, write);
      await write;
    },
    async flush(workspaceId: string) { await writes.get(workspaceId); },
  };
}

export const structureDrafts = createStructureDraftsStore();
