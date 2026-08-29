/** Machine-level state for signed scientific Tool Runtimes. Operations are isolated by runtime ID. */
import { liatir } from '$lib/api';
import { getAIHardwareInfo, type AIHardwareInfo } from '$lib/ai/runtime';
import { toolRuntimeInstallBlock } from '$lib/ai/model-compatibility';
import { appStorage } from './app-storage';
import { LIATIR_TOOL_RUNTIME_CATALOG } from '$lib/tool-runtimes/catalog';
import {
  packageChecksForToolRuntime,
  runtimeIdForToolRuntime,
  type LiatirRuntimeComponentUpdateStatus,
  type LiatirToolRuntimeMetadata,
  type LiatirToolRuntimeRecord,
} from '@liatir/core';

const STATE_FILE = 'tool-runtimes.json';
const MARKER_DIR = 'tool-runtime-installs';
const catalog: readonly LiatirToolRuntimeMetadata[] = LIATIR_TOOL_RUNTIME_CATALOG;

interface StoredToolRuntimeState {
  status?: LiatirToolRuntimeRecord['status'];
  runtimePath?: string;
  installedSizeBytes?: number;
  runtimeBoxActivation?: LiatirToolRuntimeRecord['runtimeBoxActivation'];
  updatedAt?: number;
  error?: string;
}

export interface ToolRuntimeOperation {
  downloadId: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
  message: string;
}

export interface ToolRuntimeUpdateState {
  checking: boolean;
  updateAvailable: boolean;
  checkedAt?: string;
  currentVersion?: string | null;
  availableVersion?: string | null;
  error?: string;
}

function markerFile(id: string) { return `${MARKER_DIR}/${id}.json`; }

function createToolRuntimeStore() {
  let initialized = $state(false);
  let states = $state<Record<string, StoredToolRuntimeState>>({});
  let operations = $state<Record<string, ToolRuntimeOperation>>({});
  let updates = $state<Record<string, ToolRuntimeUpdateState>>({});
  let hardware = $state<AIHardwareInfo | null>(null);
  const installPromises = new Map<string, Promise<LiatirToolRuntimeRecord>>();

  function records(): LiatirToolRuntimeRecord[] {
    return catalog.map((metadata) => ({
      ...metadata,
      status: states[metadata.id]?.status ?? 'available',
      runtimePath: states[metadata.id]?.runtimePath,
      installedSizeBytes: states[metadata.id]?.installedSizeBytes,
      runtimeBoxActivation: states[metadata.id]?.runtimeBoxActivation,
      updatedAt: states[metadata.id]?.updatedAt,
      error: states[metadata.id]?.error,
    }));
  }

  async function persist() {
    await appStorage.writeText(STATE_FILE, JSON.stringify({ states }, null, 2), { createDirs: true });
  }

  async function setState(id: string, patch: StoredToolRuntimeState) {
    states = { ...states, [id]: { ...(states[id] ?? {}), ...patch, updatedAt: Date.now() } };
    await persist();
  }

  return {
    get initialized() { return initialized; },
    get runtimes() { return records(); },
    get operations() { return operations; },
    get updates() { return updates; },

    async init() {
      if (initialized) return;
      initialized = true;
      if (!liatir()) return;
      try {
        const parsed = JSON.parse(await appStorage.readText(STATE_FILE)) as { states?: Record<string, StoredToolRuntimeState> };
        states = parsed.states ?? {};
      } catch { states = {}; }
      for (const metadata of catalog) {
        try {
          const marker = JSON.parse(await appStorage.readText(markerFile(metadata.id))) as StoredToolRuntimeState;
          states = { ...states, [metadata.id]: { ...(states[metadata.id] ?? {}), ...marker, status: 'installed' } };
        } catch { /* A missing marker is the normal never-installed state. */ }
      }
      hardware = await getAIHardwareInfo().catch(() => null);
      await Promise.all(catalog.map((runtime) => this.refresh(runtime.id)));
    },

    async refresh(id: string): Promise<LiatirToolRuntimeRecord | null> {
      const runtime = records().find((item) => item.id === id);
      const api = liatir();
      if (!runtime || !api) return runtime ?? null;
      try {
        const status = await api.runtimeBoxes.status({
          componentKind: 'tool-runtime',
          runtimeId: runtimeIdForToolRuntime(runtime),
          packages: packageChecksForToolRuntime(runtime),
        });
        await setState(id, {
          status: status.error ? 'error' : status.installed ? 'installed' : 'available',
          runtimePath: status.runtimeDir,
          installedSizeBytes: status.sizeBytes ?? undefined,
          runtimeBoxActivation: status.activation ?? undefined,
          error: status.error ?? undefined,
        });
      } catch (error) {
        await setState(id, { status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
      return records().find((item) => item.id === id) ?? null;
    },

    async checkUpdate(id: string): Promise<ToolRuntimeUpdateState> {
      const runtime = records().find((item) => item.id === id);
      const api = liatir();
      if (!runtime || !api) throw new Error(`Unknown Tool Runtime: ${id}`);
      updates = { ...updates, [id]: { checking: true, updateAvailable: false } };
      try {
        const status = await api.runtimeBoxes.status({
          componentKind: 'tool-runtime',
          runtimeId: runtimeIdForToolRuntime(runtime),
          packages: packageChecksForToolRuntime(runtime),
          update: { componentId: runtime.id, ...runtime.install.runtimeBox },
        });
        const update: LiatirRuntimeComponentUpdateStatus | null = status.update ?? null;
        const state = {
          checking: false,
          updateAvailable: update?.updateAvailable ?? false,
          checkedAt: update?.checkedAt,
          currentVersion: update?.currentVersion,
          availableVersion: update?.availableVersion,
        } satisfies ToolRuntimeUpdateState;
        updates = { ...updates, [id]: state };
        return state;
      } catch (error) {
        const state = { checking: false, updateAvailable: false, error: error instanceof Error ? error.message : String(error) };
        updates = { ...updates, [id]: state };
        return state;
      }
    },

    async install(id: string): Promise<LiatirToolRuntimeRecord> {
      const existing = installPromises.get(id);
      if (existing) return existing;
      const metadata = catalog.find((item) => item.id === id);
      const api = liatir();
      if (!metadata || !api) throw new Error(`Unknown Tool Runtime: ${id}`);
      const blocked = toolRuntimeInstallBlock(metadata, hardware);
      if (blocked) throw new Error(blocked.reason);
      const promise = (async () => {
        const downloadId = `runtime-box-${metadata.id}-${crypto.randomUUID()}`;
        operations = { ...operations, [id]: { downloadId, bytesDownloaded: 0, bytesTotal: null, message: 'Downloading Runtime Box' } };
        const unlisten = await api.desktop.events.on(
          `managed:progress:${downloadId}`,
          (progress: { bytesDownloaded: number; bytesTotal: number | null }) => {
            operations = { ...operations, [id]: { downloadId, ...progress, message: 'Downloading Runtime Box' } };
          },
        );
        try {
          const result = await api.runtimeBoxes.install({
            componentKind: 'tool-runtime',
            componentId: metadata.id,
            ...metadata.install.runtimeBox,
            downloadId,
          });
          const state: StoredToolRuntimeState = {
            status: 'installed', runtimePath: result.runtimeDir, installedSizeBytes: result.sizeBytes,
            runtimeBoxActivation: result.activation, error: undefined,
          };
          await setState(id, state);
          await appStorage.writeText(markerFile(id), JSON.stringify(state, null, 2), { createDirs: true });
          updates = { ...updates, [id]: { checking: false, updateAvailable: false } };
          return records().find((item) => item.id === id)!;
        } finally {
          unlisten();
          const { [id]: _operation, ...rest } = operations;
          operations = rest;
          installPromises.delete(id);
        }
      })();
      installPromises.set(id, promise);
      return promise;
    },

    async cancelInstall(id: string): Promise<boolean> {
      const operation = operations[id];
      const api = liatir();
      return Boolean(operation && api && await api.runtimeBoxes.cancelDownload(operation.downloadId));
    },

    async rollback(id: string): Promise<boolean> {
      const runtime = records().find((item) => item.id === id);
      const api = liatir();
      if (!runtime || !api) return false;
      const result = await api.runtimeBoxes.rollback('tool-runtime', runtimeIdForToolRuntime(runtime));
      if (result.restored) await this.refresh(id);
      return result.restored;
    },

    async remove(id: string): Promise<boolean> {
      const runtime = records().find((item) => item.id === id);
      const api = liatir();
      if (!runtime || !api) return false;
      await api.runtimeBoxes.remove('tool-runtime', runtimeIdForToolRuntime(runtime), runtime.install.runtimeBox.boxId);
      const { [id]: _state, ...remaining } = states;
      states = remaining;
      await appStorage.remove(markerFile(id)).catch(() => {});
      await persist();
      return true;
    },
  };
}

export const toolRuntimesStore = createToolRuntimeStore();
