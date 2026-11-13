/**
 * Quenta Stage conversations, one file per workspace (named "presentation" in stored data).
 *
 * A thread is a chat: each user request is a turn, and each turn produces a new version of the
 * Stage page as its own Result. The generation runs here, not in the page, so leaving the page keeps
 * it going and coming back shows its live stage. A turn writes to the workspace captured when it was
 * sent, even if the user switches workspace meanwhile.
 */
import type { LiatirQuentaPresentation, LiatirQuentaProviderConfig } from '@liatir/core';
import { appStorage } from './app-storage';
import { analysisRuns } from './analysisRuns.svelte';
import { executionRuns } from './executionRuns.svelte';
import { getDataPrefix } from './workspace.svelte';
import type { PresentationProgress } from '$lib/quenta/presentations';

export type PresentationTurnStatus = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted';

export interface PresentationTurn {
  id: string;
  request: string;
  resultIds: string[];
  sentAt: number;
  status: PresentationTurnStatus;
  runId?: string;
  /** The saved version this turn produced (a Result ID), once done. */
  resultId?: string;
  title?: string;
  error?: string;
}

export interface PresentationThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The Results the next request will use; chosen in the composer. */
  resultIds: string[];
  turns: PresentationTurn[];
}

const file = (prefix: string) => `${prefix}quenta/presentation-threads.json`;
const writes = new Map<string, Promise<unknown>>();
/** Turns generating in this app session; any other turn saved as running was cut off by a restart. */
const live = new Set<string>();

async function readThreads(prefix: string): Promise<PresentationThread[]> {
  if (!await appStorage.exists(file(prefix))) return [];
  const parsed = JSON.parse(await appStorage.readText(file(prefix))) as unknown;
  if (!Array.isArray(parsed)) throw new Error('The Stage conversations file is invalid.');
  return parsed as PresentationThread[];
}

function settleInterrupted(threads: PresentationThread[]): PresentationThread[] {
  return threads.map((thread) => ({
    ...thread,
    turns: thread.turns.map((turn) => turn.status === 'running' && !live.has(turn.id)
      ? { ...turn, status: 'interrupted' as const, error: 'Liatir closed before this page was finished.' }
      : turn),
  }));
}

function createPresentationThreads() {
  let threads = $state<PresentationThread[]>([]);
  let progress = $state<Record<string, PresentationProgress>>({});
  let loadedPrefix: string | null = null;

  /** Serialised read-modify-write of one workspace's file; updates the view when it is the active one. */
  async function change(prefix: string, edit: (current: PresentationThread[]) => PresentationThread[]) {
    const task = (writes.get(prefix) ?? Promise.resolve()).then(async () => {
      const next = edit(await readThreads(prefix));
      await appStorage.writeText(file(prefix), JSON.stringify(next), { createDirs: true });
      if (prefix === getDataPrefix()) { threads = next; loadedPrefix = prefix; }
    });
    writes.set(prefix, task.catch(() => {}));
    await task;
  }

  function editTurn(prefix: string, threadId: string, turnId: string, patch: Partial<PresentationTurn>) {
    return change(prefix, (current) => current.map((thread) => thread.id !== threadId ? thread : {
      ...thread,
      updatedAt: Date.now(),
      turns: thread.turns.map((turn) => turn.id === turnId ? { ...turn, ...patch } : turn),
    }));
  }

  /** The newest saved version in a thread, which a follow-up request revises. */
  async function latestVersion(thread: PresentationThread): Promise<LiatirQuentaPresentation | undefined> {
    const resultId = [...thread.turns].reverse().find((turn) => turn.status === 'done' && turn.resultId)?.resultId;
    if (!resultId) return undefined;
    const section = (await analysisRuns.loadOutput(resultId).catch(() => null))?.sections[0];
    return section?.type === 'html-presentation' ? section.presentation : undefined;
  }

  return {
    get threads() { return threads; },
    progress(turnId: string): PresentationProgress | undefined { return progress[turnId]; },
    byId(id: string) { return threads.find((thread) => thread.id === id); },

    async init() {
      const prefix = getDataPrefix();
      if (loadedPrefix === prefix) return;
      const loaded = settleInterrupted(await readThreads(prefix));
      if (prefix === getDataPrefix()) { threads = loaded; loadedPrefix = prefix; }
    },

    reset() { threads = []; loadedPrefix = null; },

    async create(resultIds: string[] = []): Promise<string> {
      const now = Date.now();
      const thread: PresentationThread = { id: crypto.randomUUID(), title: 'New page', createdAt: now, updatedAt: now, resultIds, turns: [] };
      await change(getDataPrefix(), (current) => [thread, ...current]);
      return thread.id;
    },

    async setResults(threadId: string, resultIds: string[]) {
      await change(getDataPrefix(), (current) => current.map((thread) => thread.id === threadId ? { ...thread, resultIds } : thread));
    },

    async remove(threadId: string) {
      await change(getDataPrefix(), (current) => current.filter((thread) => thread.id !== threadId));
    },

    /** Sends a request in a thread and generates its version. Resolves when the turn has settled. */
    async send(threadId: string, request: string, config: LiatirQuentaProviderConfig) {
      const prefix = getDataPrefix();
      const thread = threads.find((item) => item.id === threadId);
      if (!thread) throw new Error('This Stage conversation no longer exists.');
      if (thread.turns.some((turn) => turn.status === 'running')) throw new Error('Wait for the current version to finish.');
      const turn: PresentationTurn = {
        id: crypto.randomUUID(), request: request.trim(), resultIds: [...thread.resultIds], sentAt: Date.now(), status: 'running',
      };
      live.add(turn.id);
      progress = { ...progress, [turn.id]: { stage: 'reading' } };
      await change(prefix, (current) => current.map((item) => item.id !== threadId ? item : {
        ...item,
        title: item.turns.length ? item.title : turn.request.slice(0, 60) || 'Page about Results',
        updatedAt: turn.sentAt,
        turns: [...item.turns, turn],
      }));
      let runId: string | undefined;
      try {
        const { generatePresentation } = await import('$lib/quenta/presentations');
        const previous = await latestVersion(thread);
        const resultId = await generatePresentation(turn.resultIds, turn.request, config, {
          previous,
          onStart: (id) => { runId = id; void editTurn(prefix, threadId, turn.id, { runId: id }); },
          onProgress: (next) => {
            const repaired = progress[turn.id]?.repaired || next.stage === 'repairing';
            progress = { ...progress, [turn.id]: { ...next, repaired } };
          },
        });
        const title = (await analysisRuns.committed(resultId))?.label;
        await editTurn(prefix, threadId, turn.id, { status: 'done', resultId, title });
        await change(prefix, (current) => current.map((item) => item.id === threadId && title ? { ...item, title } : item));
      } catch (error) {
        const cancelled = runId !== undefined && executionRuns.byId(runId)?.status === 'cancelled';
        await editTurn(prefix, threadId, turn.id, { status: cancelled ? 'cancelled' : 'error', error: String(error).replace(/^Error:\s*/, '') });
      } finally {
        live.delete(turn.id);
        const { [turn.id]: _done, ...rest } = progress;
        progress = rest;
      }
    },
  };
}

export const presentationThreads = createPresentationThreads();
