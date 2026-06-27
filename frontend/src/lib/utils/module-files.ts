import { liatir } from '$lib/api';
import { getDataPrefix } from '$lib/stores/workspace.svelte';
import { dataFiles } from '$lib/stores/dataFiles.svelte';
import { safeResultName } from './results';

/**
 * Bridge for persisting/removing files produced by .lia modules.
 *
 * Files are written under the workspace-scoped, module-relative folder
 * `Results/<module>/` (via the Rust `lia_module_*` commands) and registered in
 * the Data store so they appear in Results exactly like native-tool outputs.
 */

export interface ModuleSaveResult {
  path: string;
  virtualFolder: string;
  ext: string;
}

/** Save a single module output file and register it in Results. */
export async function saveModuleOutput(
  moduleName: string,
  fileName: string,
  content: string,
  opts: { base64?: boolean } = {}
): Promise<ModuleSaveResult | null> {
  const api = liatir();
  if (!api) return null;

  const entry = await api.invoke('lia_module_save_output', {
    module: moduleName,
    fileName,
    content,
    isBase64: opts.base64 ?? false,
    workspacePrefix: getDataPrefix(),
  }) as ModuleSaveResult;

  // Mirror the tool-output flow: ensure the virtual Results folders exist,
  // then register the file by absolute path.
  await dataFiles.createFolder('Results').catch(() => {});
  await dataFiles.createFolder(entry.virtualFolder).catch(() => {});
  await dataFiles.add(entry.path, entry.virtualFolder).catch(() => {});

  return entry;
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
 * Shape a module may return for a file-typed output:
 *   - a plain string: absolute path to an existing file produced by the module
 *   - `{ content, fileName?, base64? }`: content Liatir should save to Results
 */
export type ModuleFileValue =
  | string
  | { content: string; fileName?: string; base64?: boolean };

function detectExt(path: string): string {
  const lower = path.toLowerCase();
  for (const multi of ['fastq.gz', 'fq.gz', 'fasta.gz', 'fa.gz', 'vcf.gz', 'bcf.gz']) {
    if (lower.endsWith(`.${multi}`)) return multi;
  }
  return lower.split(/[\\/]/).pop()?.split('.').pop() ?? '';
}

async function registerExistingModuleOutput(moduleName: string, path: string): Promise<ModuleSaveResult> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');

  await api.invoke('lia_file_size', { path });

  const virtualFolder = `Results/${safeResultName(moduleName)}`;
  await dataFiles.createFolder('Results').catch(() => {});
  await dataFiles.createFolder(virtualFolder).catch(() => {});
  await dataFiles.add(path, virtualFolder).catch(() => {});

  return { path, virtualFolder, ext: detectExt(path) };
}

/**
 * Persist all file-typed outputs declared in a module's outputSchema from its
 * structured `result`. Returns the saved entries (for UI display).
 */
export async function saveModuleResultFiles(
  moduleName: string,
  outputSchema: Record<string, { type: string; accept?: string[] }>,
  result: unknown,
  runId: string
): Promise<ModuleSaveResult[]> {
  if (!result || typeof result !== 'object') return [];
  const obj = result as Record<string, unknown>;
  const saved: ModuleSaveResult[] = [];

  for (const [key, field] of Object.entries(outputSchema)) {
    if (field.type !== 'file') continue;
    const raw = obj[key] as ModuleFileValue | undefined;
    if (raw == null) continue;

    let content: string;
    let base64 = false;
    let fileName: string;
    const defaultExt = field.accept?.[0]?.replace(/^\./, '') ?? 'txt';

    if (typeof raw === 'string') {
      if (raw === '') continue;
      saved.push(await registerExistingModuleOutput(moduleName, raw));
      continue;
    } else if (typeof raw === 'object' && typeof raw.content === 'string') {
      content = raw.content;
      base64 = raw.base64 ?? false;
      fileName = raw.fileName ?? `${key}-${runId}.${defaultExt}`;
    } else {
      continue;
    }

    const entry = await saveModuleOutput(moduleName, fileName, content, { base64 });
    if (entry) saved.push(entry);
  }

  return saved;
}
