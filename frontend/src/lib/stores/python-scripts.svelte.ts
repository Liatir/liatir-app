import { validateLiatirScript, LIATIR_PYTHON_SCRIPT_TEMPLATE, type LiatirPythonScript } from '@liatir/core';
import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';

const catalogPath = (prefix: string) => `${prefix}python-scripts/catalog.json`;
const writes = new Map<string, Promise<unknown>>();

function createPythonScripts() {
  let scripts = $state<LiatirPythonScript[]>([]);
  let loadedPrefix: string | null = null;
  let initialization: Promise<void> | null = null;
  let generation = 0;

  async function read(prefix: string): Promise<LiatirPythonScript[]> {
    return await appStorage.exists(catalogPath(prefix))
      ? JSON.parse(await appStorage.readText(catalogPath(prefix))) : [];
  }

  async function change(prefix: string, edit: (current: LiatirPythonScript[]) => LiatirPythonScript[]) {
    const task = (writes.get(prefix) ?? Promise.resolve()).then(async () => {
      const next = edit(await read(prefix));
      next.forEach(validateLiatirScript);
      await appStorage.writeText(catalogPath(prefix), JSON.stringify(next));
      if (prefix === getDataPrefix()) { scripts = next; loadedPrefix = prefix; }
    });
    writes.set(prefix, task.catch(() => {}));
    await task;
  }

  return {
    get scripts() { return scripts; },
    byId(id: string) { return scripts.find(script => script.id === id); },
    async init() {
      const prefix = getDataPrefix();
      if (loadedPrefix === prefix) return;
      if (initialization) return initialization;
      const epoch = generation;
      initialization = read(prefix).then(loaded => {
        loaded.forEach(validateLiatirScript);
        if (epoch === generation && prefix === getDataPrefix()) { scripts = loaded; loadedPrefix = prefix; }
      }).finally(() => { if (epoch === generation) initialization = null; });
      return initialization;
    },
    reset() { generation++; scripts = []; loadedPrefix = null; initialization = null; },
    draft(): LiatirPythonScript {
      return { id: crypto.randomUUID(), name: 'New Python script', language: 'python', folder: '', savedAt: Date.now(),
        code: LIATIR_PYTHON_SCRIPT_TEMPLATE, inputSchema: {}, outputSchema: {}, python: {} };
    },
    async save(script: LiatirPythonScript) {
      if (!workspaceStore.activeId) throw new Error('Open a workspace before saving a script.');
      const snapshot = JSON.parse(JSON.stringify(script)) as LiatirPythonScript;
      validateLiatirScript(snapshot);
      snapshot.savedAt = Date.now();
      await change(getDataPrefix(), current => [snapshot, ...current.filter(item => item.id !== snapshot.id)]);
    },
    async remove(id: string) { await change(getDataPrefix(), current => current.filter(script => script.id !== id)); },
    async copyTo(id: string, workspaceId: string) {
      const original = this.byId(id);
      if (!original || !workspaceStore.workspaces.some(workspace => workspace.id === workspaceId)) throw new Error('Choose an existing destination workspace.');
      const copy = JSON.parse(JSON.stringify({ ...original, id: crypto.randomUUID(), savedAt: Date.now() })) as LiatirPythonScript;
      await change(`workspaces/${workspaceId}/`, current => [copy, ...current]);
      return copy.id;
    },
  };
}

export const pythonScripts = createPythonScripts();
