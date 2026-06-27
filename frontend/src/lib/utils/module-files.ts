import { liatir } from '$lib/api';
import { getDataPrefix } from '$lib/stores/workspace.svelte';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { safeResultName } from './results';
import { detectFileExtension } from './file-extensions';
import type { LiatirFileOutputValue, LiatirOutputFieldSchema, RunOutputFile } from '@liatir/core';

/**
 * Bridge for persisting/removing files produced by .lia modules.
 *
 * Files are written under the workspace-scoped, module-relative folder
 * `Results/<module>/` (via the Rust `lia_module_*` commands) and registered in
 * the Data store so they appear in Results exactly like native-tool outputs.
 */

export interface ModuleSaveResult extends RunOutputFile {
  virtualFolder: string;
}

interface RawModuleSaveResult {
  path: string;
  virtualFolder: string;
  ext: string;
}

/** Save a single module output file and register it in Results. */
export async function saveModuleOutput(
  moduleName: string,
  fileName: string,
  content: string,
  opts: { base64?: boolean; label?: string; fieldKey?: string } = {}
): Promise<ModuleSaveResult | null> {
  const api = liatir();
  if (!api) return null;

  const entry = await api.invoke('lia_module_save_output', {
    module: moduleName,
    fileName,
    content,
    isBase64: opts.base64 ?? false,
    workspacePrefix: getDataPrefix(),
  }) as RawModuleSaveResult;

  // Mirror the tool-output flow: ensure the virtual Results folders exist,
  // then register the file by absolute path.
  await dataFiles.createFolder('Results').catch(() => {});
  await dataFiles.createFolder(entry.virtualFolder).catch(() => {});
  await dataFiles.add(entry.path, entry.virtualFolder).catch(() => {});

  return {
    ...entry,
    label: opts.label ?? fileName,
    fieldKey: opts.fieldKey,
  };
}

/** Delete a module output file (from disk + Data store). */
export async function deleteModuleOutput(path: string): Promise<void> {
  const api = liatir();
  if (!api) return;

  await api.invoke('lia_module_delete_output', { path });

  const f = dataFiles.files.find((x) => x.path === path);
  if (f) await dataFiles.remove(f.id).catch(() => {});
}

/**
 * Shape a module may return for a file-typed output. Kept as an alias to the
 * shared core contract so callers do not invent local variants.
 */
export type ModuleFileValue = LiatirFileOutputValue;

async function registerExistingModuleOutput(
  moduleName: string,
  path: string,
  opts: { label: string; fieldKey: string }
): Promise<ModuleSaveResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  await api.invoke('lia_file_size', { path });

  const virtualFolder = `Results/${safeResultName(moduleName)}`;
  await dataFiles.createFolder('Results').catch(() => {});
  await dataFiles.createFolder(virtualFolder).catch(() => {});
  await dataFiles.add(path, virtualFolder).catch(() => {});

  return {
    label: opts.label,
    path,
    virtualFolder,
    ext: detectFileExtension(path),
    fieldKey: opts.fieldKey,
  };
}

function getDefaultOutputExtension(field: Pick<LiatirOutputFieldSchema, 'accept' | 'ext'>): string {
  return (field.ext?.[0] ?? field.accept?.[0] ?? 'txt').replace(/^\./, '');
}

function getFilePath(raw: LiatirFileOutputValue): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (raw && typeof raw === 'object' && 'path' in raw && typeof raw.path === 'string') {
    return raw.path.trim() || null;
  }
  return null;
}

function getFileContent(raw: LiatirFileOutputValue): { content: string; fileName?: string; base64?: boolean } | null {
  if (raw && typeof raw === 'object' && 'content' in raw && typeof raw.content === 'string') {
    return {
      content: raw.content,
      fileName: raw.fileName,
      base64: raw.base64,
    };
  }
  return null;
}

/**
 * Persist all file-typed outputs declared in a module's outputSchema from its
 * structured `result`. Returns the saved entries (for UI display).
 */
export async function saveModuleResultFiles(
  moduleName: string,
  outputSchema: Record<string, LiatirOutputFieldSchema>,
  result: unknown,
  runId: string
): Promise<ModuleSaveResult[]> {
  if (!result || typeof result !== 'object') return [];
  const obj = result as Record<string, unknown>;
  const saved: ModuleSaveResult[] = [];

  for (const [key, field] of Object.entries(outputSchema)) {
    if (field.type !== 'file') continue;
    const raw = obj[key] as LiatirFileOutputValue | undefined;
    if (raw == null) continue;

    const label = field.label ?? key;
    const path = getFilePath(raw);
    if (path) {
      saved.push(await registerExistingModuleOutput(moduleName, path, { label, fieldKey: key }));
      continue;
    }

    const fileContent = getFileContent(raw);
    if (!fileContent) {
      continue;
    }

    const defaultExt = getDefaultOutputExtension(field);
    const fileName = fileContent.fileName ?? `${key}-${runId}.${defaultExt}`;
    const entry = await saveModuleOutput(moduleName, fileName, fileContent.content, {
      base64: fileContent.base64 ?? false,
      label,
      fieldKey: key,
    });
    if (entry) saved.push(entry);
  }

  return saved;
}
