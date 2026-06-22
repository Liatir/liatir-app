import { liatir } from '$lib/api';

/**
 * Isolated, app-managed storage — backed by the Rust `lia_app_*` commands which
 * resolve under `.liatir/.main/_app/` (NOT reachable via `desktop.fs.*`).
 *
 * Mirrors the subset of the `desktop.fs.data` interface used by the app stores
 * so migrating a store is a drop-in replacement:
 *   `api.desktop.fs.data.X(...)` → `appStorage.X(...)`
 *
 * User scripts and .lia modules keep using `desktop.fs.*` for their own data;
 * they cannot read or clobber anything stored here.
 */
export const appStorage = {
  async writeText(rel: string, content: string, opts?: { createDirs?: boolean }): Promise<void> {
    const api = liatir();
    if (!api) return;
    await api.invoke('lia_app_write_text', { rel, content, createDirs: opts?.createDirs ?? true });
  },

  async readText(rel: string): Promise<string> {
    const api = liatir();
    if (!api) return '';
    return await api.invoke('lia_app_read_text', { rel }) as string;
  },

  async exists(rel: string): Promise<boolean> {
    const api = liatir();
    if (!api) return false;
    return await api.invoke('lia_app_exists', { rel }) as boolean;
  },

  async remove(rel: string, recursive = false): Promise<void> {
    const api = liatir();
    if (!api) return;
    await api.invoke('lia_app_remove', { rel, recursive });
  },

  async mkdir(rel: string): Promise<void> {
    const api = liatir();
    if (!api) return;
    await api.invoke('lia_app_mkdir', { rel });
  },

  /** Absolute path of the isolated app-storage root. */
  async path(): Promise<string> {
    const api = liatir();
    if (!api) return '';
    return await api.invoke('lia_app_path') as string;
  },

  /** One-time, non-destructive migration of legacy state out of the public data scope. */
  async migrate(): Promise<void> {
    const api = liatir();
    if (!api) return;
    try { await api.invoke('lia_app_migrate'); } catch { /* best effort */ }
  },
};
