import { liatir } from '$lib/api';
import { appStorage } from './app-storage';
import type { WorkspaceMeta, WorkspacesFile, WorkspaceEnvVar, WorkspaceEnvFile } from '$lib/types/workspace';

const WORKSPACES_FILE = 'workspaces.json';
const ACTIVE_FILE = 'active-workspace.json';

export const SANDBOX_WORKSPACE_ID = '__test__';
const SANDBOX_WORKSPACE_NAME = 'Sandbox';

function workspaceEnvPath(id: string) {
  return `workspaces/${id}/env.json`;
}

let resetFn: (() => void) | null = null;
let demoInitFn: (() => Promise<void>) | null = null;

export function setResetFn(fn: () => void) {
  resetFn = fn;
}

export function setDemoInitFn(fn: () => Promise<void>) {
  demoInitFn = fn;
}

function createWorkspaceStore() {
  let workspaces = $state<WorkspaceMeta[]>([]);
  let activeId = $state<string | null>(null);
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
      resetFn?.();
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

    async resetSandboxMode() {
      resetFn?.();
      try { await appStorage.remove(`workspaces/${SANDBOX_WORKSPACE_ID}`, true); } catch { /* ok */ }
      const api = liatir();
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
