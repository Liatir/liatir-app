/**
 * The one place that knows where a run's files live.
 *
 * Every run owns `runs/<runId>/` — a tool, an AI Model, a plugin, an API call, an External Workflow,
 * a pipeline, and every step inside one, without exception and without regard to how it was started.
 * The layout is described on `LiatirRunMetadata` in `@liatir/core`, which is the contract; this
 * module is the only code that writes it.
 *
 * Liatir used to have two arrangements at once: standalone tools wrote into a flat `tool-outputs/`
 * under run-prefixed filenames, and pipeline steps wrote into the user-facing `Results/<Tool>/`
 * folder shared by every run of that tool. Both worked, and neither could answer "what did *this*
 * run put here" by looking — which is the question that makes an empty by-product declaration
 * checkable instead of merely stated.
 *
 * Workspace-scoped, like the history index that points into it. A run belongs to the workspace it
 * was started in, and deleting that workspace has to reclaim the files it produced — which it
 * cannot do for a directory that lives outside it.
 */
import { liatir } from '$lib/api';
import {
  fileRunOutputEntries,
  type ListedFsEntry,
  type RunOutputEntry,
} from '$lib/execution/run-output-entries';
import { getDataPrefix } from '$lib/stores/workspace.svelte';
import type {
  LiatirExecutionLogEntry,
  LiatirRunMetadata,
  LiatirRunSteps,
} from '@liatir/core';

const RUNS_DIR = 'runs';

function runsRoot(): string {
  return `${getDataPrefix()}${RUNS_DIR}`;
}

export function runDirRel(runId: string): string {
  return `${runsRoot()}/${runId}`;
}

function runOutputRel(runId: string): string {
  return `${runDirRel(runId)}/output`;
}

async function dataRoot(): Promise<string> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  const { data } = await api.invoke('lia_fs_paths') as { data: string; cache: string };
  return data;
}

/**
 * Absolute path of a run's directory.
 *
 * For code that has to reason about the location itself — counting what a prune is about to
 * destroy, for instance. Revealing it to the user goes through `revealRunDir`, which never lets an
 * absolute path cross the bridge.
 */
export async function runDirPath(runId: string): Promise<string> {
  return `${await dataRoot()}/${runDirRel(runId)}`;
}

/**
 * Show a run's directory in the platform's file manager.
 *
 * Goes through `lia_fs_reveal` rather than the shell plugin's `open`, which only accepts URLs. The
 * relative path is what crosses the bridge: the command resolves it under the data root, so a run
 * id cannot address anything outside it.
 *
 * The two ways this fails are told apart on purpose. A run that wrote nothing has no directory —
 * it is created by the first write — and that is an ordinary state to explain, not a fault. Anything
 * else is a real failure and reaches the caller as its own message, because reporting every
 * refusal as "wrote nothing" would be the same silent lie as the button that did nothing.
 */
export type RevealOutcome = { ok: true } | { ok: false; reason: 'no-directory' | string };

export async function revealRunDir(runId: string): Promise<RevealOutcome> {
  const api = liatir();
  if (!api) return { ok: false, reason: 'Liatir API not available' };
  try {
    await api.invoke('lia_fs_reveal', { rel: runDirRel(runId) });
    return { ok: true };
  } catch (error) {
    const message = String(error);
    if (message.includes('not a directory')) return { ok: false, reason: 'no-directory' };
    return { ok: false, reason: message };
  }
}

/**
 * What to tell the user when the folder did not open, in one wording for every screen that offers
 * it. `null` means it opened and there is nothing to say.
 */
export function revealFailureMessage(outcome: RevealOutcome): string | null {
  if (outcome.ok) return null;
  return outcome.reason === 'no-directory'
    ? 'This run wrote no files.'
    : `Could not open the folder: ${outcome.reason}`;
}

/**
 * Ensure this run's `output/` exists and return its absolute path.
 *
 * Called only by something about to write a file, which is what keeps a run that produces nothing
 * from leaving an empty directory behind.
 */
export async function ensureRunOutputDir(runId: string): Promise<string> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  await api.invoke('lia_fs_mkdir', { rel: runsRoot(), permanent: true });
  await api.invoke('lia_fs_mkdir', { rel: runDirRel(runId), permanent: true });
  await api.invoke('lia_fs_mkdir', { rel: runOutputRel(runId), permanent: true });
  return `${await dataRoot()}/${runOutputRel(runId)}`;
}

/**
 * Turn an absolute path inside the data root back into the relative one the bridge accepts.
 *
 * The filesystem commands are deliberately sandboxed: they take a path relative to Liatir's
 * data directory and can address nothing outside it. A step that has just written into its
 * own `output/` holds the absolute path, so this is the one conversion it needs — and it
 * refuses anything that is not under the data root rather than reaching for it.
 */
async function dataRelativePath(absolutePath: string): Promise<string> {
  const root = await dataRoot();
  const normalised = absolutePath.replace(/\\/g, '/');
  const prefix = `${root.replace(/\\/g, '/')}/`;
  if (!normalised.startsWith(prefix)) {
    throw new Error(`${absolutePath} is not inside Liatir's data directory.`);
  }
  return normalised.slice(prefix.length);
}

/**
 * Move a file a run produced to another place inside that run's own directory.
 *
 * A tool that writes its result several directories deep under a name of its own choosing
 * leaves the user with `quants.h5ad` and no idea which sample it belongs to. Lifting it to
 * the top of the run's `output/` under the sample's name is a rename, not a transformation:
 * the file is byte-for-byte what the tool wrote.
 */
export async function moveRunFile(from: string, to: string): Promise<void> {
  const api = liatir();
  if (!api) throw new Error('Liatir API not available');
  await api.invoke('lia_fs_move', {
    src: await dataRelativePath(from),
    dest: await dataRelativePath(to),
    permanent: true,
    createDirs: true,
    overwrite: true,
  });
}

export type { RunOutputEntry } from '$lib/execution/run-output-entries';

/**
 * Everything actually sitting in a run's `output/`.
 *
 * Nothing, when the directory was never created — the normal case for a run that writes no files,
 * and not an error to report.
 */
export async function listRunOutputs(runId: string): Promise<RunOutputEntry[]> {
  const api = liatir();
  if (!api) return [];
  try {
    const entries = await api.invoke('lia_fs_list_dir', {
      rel: runOutputRel(runId),
      permanent: true,
      windowLabel: undefined,
      pluginStoragePlugin: undefined,
    }) as ListedFsEntry[];
    return fileRunOutputEntries(entries);
  } catch {
    return [];
  }
}

async function writeRunFile(runId: string, name: string, contents: string): Promise<void> {
  const api = liatir();
  if (!api) return;
  await api.invoke('lia_fs_write_text', {
    rel: `${runDirRel(runId)}/${name}`,
    contents,
    permanent: true,
    createDirs: true,
  });
}

async function readRunFile(runId: string, name: string): Promise<string | null> {
  const api = liatir();
  if (!api) return null;
  try {
    return await api.invoke('lia_fs_read_text', {
      rel: `${runDirRel(runId)}/${name}`,
      permanent: true,
    }) as string;
  } catch {
    return null;
  }
}

export async function writeRunMetadata(metadata: LiatirRunMetadata): Promise<void> {
  await writeRunFile(metadata.runId, 'metadata.json', JSON.stringify(metadata, null, 2));
}

/**
 * The transcript, one entry per line.
 *
 * JSON Lines rather than one JSON array so the file can be appended to and read incrementally: a
 * transcript grows while a run is in progress, and a format that has to be reparsed and rewritten
 * whole is the shape that made logging cost more the longer a run went on.
 */
export async function writeRunLog(runId: string, entries: LiatirExecutionLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await writeRunFile(runId, 'log.jsonl', entries.map((entry) => JSON.stringify(entry)).join('\n'));
}

export async function readRunLog(runId: string): Promise<LiatirExecutionLogEntry[] | null> {
  const raw = await readRunFile(runId, 'log.jsonl');
  if (raw === null) return null;
  const entries: LiatirExecutionLogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LiatirExecutionLogEntry);
    } catch {
      // One unreadable line must not cost the rest of the transcript.
    }
  }
  return entries;
}

/** Kept apart from `metadata.json`, which describes the run rather than what happened inside it. */
export async function writeRunSteps(runId: string, steps: LiatirRunSteps): Promise<void> {
  await writeRunFile(runId, 'steps.json', JSON.stringify(steps, null, 2));
}

export async function writeRunResult(runId: string, result: unknown): Promise<void> {
  await writeRunFile(runId, 'result.json', JSON.stringify(result));
}

export async function readRunResult<T>(runId: string): Promise<T | null> {
  const raw = await readRunFile(runId, 'result.json');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Delete a run's directory and everything in it.
 *
 * Only ever called from an explicit user action. Liatir removes no run on its own: `output/` holds
 * files the user made and may still be using, and a run's transcript is what explains them — so
 * dropping either as a side effect of a list growing long would be destroying their work to save
 * bookkeeping.
 *
 * In the data scope this moves the directory to Liatir's trash rather than unlinking it, so the
 * disk is reclaimed only when the trash is emptied. That is the app's existing behaviour for user
 * data and the right default for a destructive action, but it means the caller must not promise
 * space back.
 */
export async function removeRunDir(runId: string): Promise<void> {
  const api = liatir();
  if (!api) return;
  try {
    await api.invoke('lia_fs_rm', { rel: runDirRel(runId), permanent: true, recursive: true });
  } catch {
    // Already gone, or never created.
  }
}
