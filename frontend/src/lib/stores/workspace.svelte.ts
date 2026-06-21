import { liatir } from '$lib/api';
import type { WorkspaceMeta, WorkspacesFile, WorkspaceEnvVar, WorkspaceEnvFile } from '$lib/types/workspace';

const WORKSPACES_FILE = 'workspaces.json';
const ACTIVE_FILE = 'active-workspace.json';

function workspaceEnvPath(id: string) {
  return `workspaces/${id}/env.json`;
}

let resetFn: (() => void) | null = null;

export function setResetFn(fn: () => void) {
  resetFn = fn;
}

function createWorkspaceStore() {
  let workspaces = $state<WorkspaceMeta[]>([]);
  let activeId = $state<string | null>(null);
  let envVars = $state<WorkspaceEnvVar[]>([]);
  let initialized = $state(false);

  async function persistWorkspaces() {
    const api = liatir();
    if (!api) return;
    const data: WorkspacesFile = { workspaces };
    await api.desktop.fs.data.writeText(WORKSPACES_FILE, JSON.stringify(data, null, 2), { createDirs: true });
  }

  async function persistActiveId() {
    const api = liatir();
    if (!api) return;
    await api.desktop.fs.data.writeText(ACTIVE_FILE, JSON.stringify({ id: activeId }), { createDirs: true });
  }

  async function persistEnvVars(id: string) {
    const api = liatir();
    if (!api) return;
    const data: WorkspaceEnvFile = { variables: envVars };
    await api.desktop.fs.data.writeText(workspaceEnvPath(id), JSON.stringify(data, null, 2), { createDirs: true });
  }

  async function loadEnvVars(id: string) {
    const api = liatir();
    if (!api) { envVars = []; return; }
    try {
      if (await api.desktop.fs.data.exists(workspaceEnvPath(id))) {
        const raw = await api.desktop.fs.data.readText(workspaceEnvPath(id));
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

    getDataPrefix(): string {
      return activeId ? `workspaces/${activeId}/` : '';
    },

    async init() {
      if (initialized) return;
      const api = liatir();
      if (!api) { initialized = true; return; }

      try {
        if (await api.desktop.fs.data.exists(WORKSPACES_FILE)) {
          const raw = await api.desktop.fs.data.readText(WORKSPACES_FILE);
          const parsed: WorkspacesFile = JSON.parse(raw);
          workspaces = parsed.workspaces ?? [];
        }
      } catch {
        workspaces = [];
      }

      try {
        if (await api.desktop.fs.data.exists(ACTIVE_FILE)) {
          const raw = await api.desktop.fs.data.readText(ACTIVE_FILE);
          const { id } = JSON.parse(raw) as { id: string | null };
          if (id && workspaces.some(w => w.id === id)) {
            activeId = id;
            await loadEnvVars(id);
          }
        }
      } catch {
        activeId = null;
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
    },

    async rename(id: string, name: string) {
      workspaces = workspaces.map(w =>
        w.id === id ? { ...w, name: name.trim() || w.name } : w
      );
      await persistWorkspaces();
    },

    async delete(id: string) {
      workspaces = workspaces.filter(w => w.id !== id);
      await persistWorkspaces();
      if (activeId === id) {
        activeId = null;
        await persistActiveId();
        envVars = [];
      }
      const api = liatir();
      if (api) {
        try {
          await api.desktop.fs.data.remove(`workspaces/${id}`, { recursive: true });
        } catch { /* best effort */ }
      }
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
