import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import type { WorkspaceMeta, WorkspacesFile, WorkspaceEnvVar, WorkspaceEnvFile } from '$lib/types/workspace';
import { tick } from 'svelte';

const WORKSPACES_FILE = 'workspaces.json';
const ACTIVE_FILE = 'active-workspace.json';

export const SANDBOX_WORKSPACE_ID = '__test__';
const SANDBOX_WORKSPACE_NAME = 'Sandbox';
export type SandboxResetLevel = 'demo-files' | 'runs' | 'full';
export type WorkspaceResetScope = 'runs' | 'all';

function workspaceEnvPath(id: string) {
  return `workspaces/${id}/env.json`;
}

let resetFn: ((scope: WorkspaceResetScope) => void) | null = null;
let demoInitFn: (() => Promise<void>) | null = null;

export function setResetFn(fn: (scope: WorkspaceResetScope) => void) {
  resetFn = fn;
}

export function setDemoInitFn(fn: () => Promise<void>) {
  demoInitFn = fn;
}

function createWorkspaceStore() {
  let workspaces = $state<WorkspaceMeta[]>([]);
  let activeId = $state<string | null>(null);
  let previousActiveId = $state<string | null>(null);
  let envVars = $state<WorkspaceEnvVar[]>([]);
  let initialized = $state(false);
  let initStarted = false; // non-reactive guard against concurrent init() calls

  async function persistWorkspaces() {
    const data: WorkspacesFile = { workspaces };
    await appStorage.writeText(WORKSPACES_FILE, JSON.stringify(data, null, 2));
  }

  async function persistActiveId() {
    await appStorage.writeText(ACTIVE_FILE, JSON.stringify({ id: activeId }));
  }

  async function persistEnvVars(id: string) {
    const data: WorkspaceEnvFile = { variables: envVars };
    await appStorage.writeText(workspaceEnvPath(id), JSON.stringify(data, null, 2));
  }

  async function loadEnvVars(id: string) {
    try {
      if (await appStorage.exists(workspaceEnvPath(id))) {
        const raw = await appStorage.readText(workspaceEnvPath(id));
        const parsed: WorkspaceEnvFile = JSON.parse(raw);
        envVars = parsed.variables ?? [];
      } else {
        envVars = [];
      }
    } catch {
      envVars = [];
    }
  }

  return {
    get workspaces() { return workspaces; },
    get activeId() { return activeId; },
    get previousActiveId() { return previousActiveId; },
    get active() { return workspaces.find(w => w.id === activeId) ?? null; },
    get envVars() { return envVars; },
    get initialized() { return initialized; },
    get isSandboxMode() { return activeId === SANDBOX_WORKSPACE_ID; },

    getDataPrefix(): string {
      return activeId ? `workspaces/${activeId}/` : '';
    },

    async init() {
      if (initStarted) return;
      initStarted = true;
      const api = liatir();
      if (!api) { initialized = true; return; }

      // Move any legacy app state out of the public data scope before reading.
      await appStorage.migrate();

      try {
        if (await appStorage.exists(WORKSPACES_FILE)) {
          const raw = await appStorage.readText(WORKSPACES_FILE);
          const parsed: WorkspacesFile = JSON.parse(raw);
          workspaces = parsed.workspaces ?? [];
        }
      } catch {
        workspaces = [];
      }

      // Auto-create Sandbox workspace if missing
      if (!workspaces.some(w => w.id === SANDBOX_WORKSPACE_ID)) {
        const testWs: WorkspaceMeta = {
          id: SANDBOX_WORKSPACE_ID,
          name: SANDBOX_WORKSPACE_NAME,
          createdAt: Date.now(),
          lastOpenedAt: 0,
        };
        workspaces = [...workspaces, testWs];
        await persistWorkspaces();
      }

      try {
        if (await appStorage.exists(ACTIVE_FILE)) {
          const raw = await appStorage.readText(ACTIVE_FILE);
          const parsed = JSON.parse(raw) as { id?: string | null };
          const savedId = parsed.id ?? null;
          if (savedId && workspaces.some(w => w.id === savedId)) {
            activeId = savedId;
            await loadEnvVars(savedId);
          }
        }
      } catch {
        activeId = null;
        envVars = [];
      }

      initialized = true;
    },

    async create(name: string): Promise<WorkspaceMeta> {
      const w: WorkspaceMeta = {
        id: crypto.randomUUID(),
        name: name.trim() || 'Workspace',
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      workspaces = [w, ...workspaces];
      await persistWorkspaces();
      return w;
    },

    async switchTo(id: string) {
      resetFn?.('all');
      previousActiveId = activeId;
      activeId = id;
      await persistActiveId();
      await loadEnvVars(id);
      workspaces = workspaces.map(w =>
        w.id === id ? { ...w, lastOpenedAt: Date.now() } : w
      );
      await persistWorkspaces();
      if (id === SANDBOX_WORKSPACE_ID) {
        await demoInitFn?.();
      }
      await tick();
    },

    async toggleFavorite(id: string) {
      if (id === SANDBOX_WORKSPACE_ID) return;
      workspaces = workspaces.map(w =>
        w.id === id ? { ...w, favorite: !w.favorite } : w
      );
      await persistWorkspaces();
    },

    async rename(id: string, name: string) {
      if (id === SANDBOX_WORKSPACE_ID) return;
      workspaces = workspaces.map(w =>
        w.id === id ? { ...w, name: name.trim() || w.name } : w
      );
      await persistWorkspaces();
    },

    async delete(id: string) {
      if (id === SANDBOX_WORKSPACE_ID) return;
      workspaces = workspaces.filter(w => w.id !== id);
      await persistWorkspaces();
      if (activeId === id) {
        activeId = null;
        await persistActiveId();
        envVars = [];
      }
      // Remove both the isolated app config and the public Results dir.
      try { await appStorage.remove(`workspaces/${id}`, true); } catch { /* best effort */ }
      const api = liatir();
      if (api) {
        try { await api.desktop.fs.data.remove(`workspaces/${id}`, true); } catch { /* best effort */ }
      }
    },

    async resetSandboxMode(level: SandboxResetLevel = 'full') {
      const api = liatir();

      if (level === 'demo-files') {
        await demoInitFn?.();
        return;
      }

      if (level === 'runs') {
        resetFn?.('runs');
        try { await appStorage.remove(`workspaces/${SANDBOX_WORKSPACE_ID}/analysis-runs`, true); } catch { /* ok */ }
        if (api) {
          try { await api.desktop.fs.data.remove(`workspaces/${SANDBOX_WORKSPACE_ID}/Results`, true); } catch { /* ok */ }
          try { await api.invoke('lia_jobs_clear_done', { workspaceId: SANDBOX_WORKSPACE_ID }); } catch { /* ok */ }
        }
        return;
      }

      resetFn?.('all');
      try { await appStorage.remove(`workspaces/${SANDBOX_WORKSPACE_ID}`, true); } catch { /* ok */ }
      if (api) {
        try { await api.desktop.fs.data.remove(`workspaces/${SANDBOX_WORKSPACE_ID}`, true); } catch { /* ok */ }
      }
      envVars = [];
      await demoInitFn?.();
    },

    async updateEnvVars(vars: WorkspaceEnvVar[]) {
      envVars = vars;
      if (activeId) await persistEnvVars(activeId);
    },
  };
}

export const workspaceStore = createWorkspaceStore();

export function getDataPrefix(): string {
  return workspaceStore.getDataPrefix();
}
