import {
  createLiatirRootExecutionIdentity,
  LIATIR_QUENTA_CONTEXT_TOKENS,
  type JsonValue,
  type LiatirQuentaPresentation,
  type LiatirQuentaProviderConfig,
  type LiatirQuentaRuntimeMessage,
} from '@liatir/core';
import runtimeSource, { runtimeId as BUNDLED_RUNTIME_ID } from 'virtual:liatir-presentation-runtime';
import { checkPage } from '../../../stage-kit/spec/check';
import { describeSources, sourceTables } from '../../../stage-kit/spec/tables';
import { OUTPUT_TOKENS, presentationFormat, repairMessages, requestMessage, systemPrompt, type PreviousPresentation } from './presentation-prompt';
import { liatir } from '$lib/api';
import { appStorage } from '$lib/stores/app-storage';
import { finalizeExecutionResult } from '$lib/execution/finalization';
import { ensureRunOutputDir } from '$lib/execution/run-storage';
import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
import { executionRuns } from '$lib/stores/executionRuns.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { presentationHtml } from './presentation-document';
import { createQuentaRuntime } from './runtime';

const TOOL = 'quenta-presentation';
const RENDER_TIMEOUT_MS = 15_000;
/** Low, so wording stays factual; the page's shape is fixed by the schema whatever the temperature. */
const TEMPERATURE = 0.2;
/** Conservative characters-per-token for the described source data and the page being revised. */
const CHARS_PER_TOKEN = 2;
/** Runtimes are stored once, by content hash, and shared by every presentation made with them. */
const RUNTIME_DIR = 'quenta/presentation-runtimes';

/** The answer was not a page that can be shown; `problems` are sent back for the single repair. */
class PageRejected extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Saves this build's runtime once, so saved presentations can be shown exactly as they were made. */
async function storeBundledRuntime(): Promise<void> {
  const path = `${RUNTIME_DIR}/${BUNDLED_RUNTIME_ID}.js`;
  if (!await appStorage.exists(path)) await appStorage.writeText(path, runtimeSource, { createDirs: true });
}

/**
 * The runtime a presentation was made with: embedded (older presentations), this build's, or the stored
 * copy, which must still match its hash so a changed file can never run in its place.
 */
export async function loadPresentationRuntime(presentation: LiatirQuentaPresentation): Promise<string> {
  if (presentation.runtimeSource) return presentation.runtimeSource;
  const id = presentation.runtimeId;
  if (!id || !/^[0-9a-f]{64}$/.test(id)) throw new Error('This page does not name the runtime it needs.');
  if (id === BUNDLED_RUNTIME_ID) return runtimeSource;
  const path = `${RUNTIME_DIR}/${id}.js`;
  if (!await appStorage.exists(path)) throw new Error('The components this page was made with are missing.');
  const source = await appStorage.readText(path);
  if (await sha256Hex(source) !== id) throw new Error('The stored Stage components were changed and will not be run.');
  return source;
}

/** Where a Stage turn is, for the chat to show; `characters` grows while the page streams in. */
export type PresentationStage = 'reading' | 'writing' | 'checking' | 'repairing' | 'saving';
export interface PresentationProgress {
  stage: PresentationStage;
  characters?: number;
  /** Set once the single repair attempt has started, so the chat keeps showing that step. */
  repaired?: boolean;
}

export interface PresentationOptions {
  /** A follow-up request revises this presentation instead of starting from nothing. */
  previous?: PreviousPresentation;
  onStart?: (runId: string) => void;
  onProgress?: (progress: PresentationProgress) => void;
}

/**
 * The frame did not answer in time. A page is data drawn by the kit, so this is the frame being slowed
 * or stalled (Liatir in the background), never something the model can repair.
 */
class DisplayTimeout extends Error {}

/** The only frame protocol: provide a frozen snapshot and receive rendering status. */
export function mountPresentation(
  frame: HTMLIFrameElement,
  presentation: LiatirQuentaPresentation,
  onReady: () => void,
  onError: (error: Error) => void,
): () => void {
  // Result views use reactive proxies; structured-clone cannot transfer them.
  // Capture plain JSON once so navigation cannot mutate an in-flight render.
  const snapshot = JSON.parse(JSON.stringify(presentation)) as LiatirQuentaPresentation;
  const runtime = loadPresentationRuntime(snapshot);
  let settled = false;
  const settle = (outcome: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    outcome();
  };
  const timer = setTimeout(() => settle(() => onError(new DisplayTimeout('The page did not display within 15 seconds.'))), RENDER_TIMEOUT_MS);
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const type = event.data?.type;
    if (type === 'presentation-host-ready') {
      runtime
        .then((source) => frame.contentWindow?.postMessage({ type: 'presentation-render', presentation: { ...snapshot, runtimeSource: source } }, '*'))
        .catch((error) => settle(() => onError(error instanceof Error ? error : new Error(String(error)))));
    } else if (type === 'presentation-ready') {
      settle(onReady);
    } else if (type === 'presentation-error') {
      settle(() => onError(new Error(String(event.data.message ?? 'The page could not be displayed.'))));
    }
  };
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  window.addEventListener('message', receive);
  frame.src = '/presentation-sandbox.html';
  return () => {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
  };
}

async function checkRendering(presentation: LiatirQuentaPresentation): Promise<void> {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  document.body.append(frame);
  let cleanup: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cleanup = mountPresentation(frame, presentation, resolve, reject);
    });
  } finally {
    cleanup?.();
    frame.remove();
  }
}

/** Copies the selected completed Results of the active workspace, refusing generated pages. */
async function readSources(resultIds: string[], workspaceId: string): Promise<LiatirQuentaPresentation['sources']> {
  const sources: LiatirQuentaPresentation['sources'] = [];
  for (const resultId of new Set(resultIds)) {
    const result = analysisRuns.runs.find((run) => run.id === resultId);
    if (!result || result.status !== 'done') throw new Error('Choose completed Results from this workspace.');
    const output = await analysisRuns.loadOutput(resultId);
    if (workspaceStore.activeId !== workspaceId) throw new Error('The workspace changed while selecting results.');
    if (!output || output.sections.some((section) => section.type === 'html-presentation')) {
      throw new Error('Select scientific Results rather than generated Stage pages.');
    }
    sources.push({ resultId, label: result.label, tool: result.tool, endedAt: result.endedAt, output: output as unknown as JsonValue });
  }
  return sources;
}


/**
 * The fixed Stage workflow: copy the selected Results, have the model fill in a page (held to the page
 * schema while it writes), check the page and that it displays, allow exactly one repair, then save it
 * as its own Result. Returns the new Result ID.
 * A follow-up passes the previous version, so each turn of a conversation saves a new version.
 */
export async function generatePresentation(
  resultIds: string[],
  instruction: string,
  config: LiatirQuentaProviderConfig,
  options: PresentationOptions = {},
): Promise<string> {
  const { previous, onStart, onProgress } = options;
  const workspaceId = workspaceStore.activeId;
  if (!workspaceId || !config.model) throw new Error('Choose an installed local model first.');
  // A page is about the selected Results or, with none selected, about the topic the user describes.
  if (!resultIds.length && !instruction.trim()) throw new Error('Select Results or describe what the page should show.');
  const runtime = createQuentaRuntime({ ...config });
  onProgress?.({ stage: 'reading' });
  const sources = await readSources(resultIds, workspaceId);
  // The model sees a description of the tables (columns and a few rows); the frame reads every row.
  const tables = sourceTables(sources);
  const data = describeSources(sources, tables);
  const system = systemPrompt(tables);
  // Two answers: the repair sends the first answer back and asks for a new one. Past the context,
  // Ollama silently drops the oldest message, the one holding this data.
  const reservedTokens = 2 * OUTPUT_TOKENS + Math.ceil(system.length / 3) + 512;
  const previousLength = previous?.page ? JSON.stringify(previous.page).length : 0;
  const dataBudget = Math.max(1000, (LIATIR_QUENTA_CONTEXT_TOKENS - reservedTokens) * CHARS_PER_TOKEN - instruction.length - previousLength);
  if (data.length > dataBudget) {
    throw new Error('The selected Results are too large for one page. Select fewer Results.');
  }

  const id = crypto.randomUUID();
  const startedAt = Date.now();
  const identity = createLiatirRootExecutionIdentity({ runId: id, workspaceId, runKind: 'utility', entityId: TOOL });
  await executionRuns.begin({
    identity, label: 'Quenta Stage page', resultPolicy: 'own', resultId: id,
    inputs: resultIds, params: { model: config.model, instruction }, startedAt,
  });
  onStart?.(id);
  const signal = executionRuns.signal(id);
  const base = { schemaVersion: 1 as const, id, workspaceId, createdAt: startedAt, model: config.model, sources, runtimeId: BUNDLED_RUNTIME_ID };
  const messages: LiatirQuentaRuntimeMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: requestMessage(instruction, data, previous) },
  ];
  const format = presentationFormat(tables);
  let requestId = '';
  const abort = () => { if (requestId) void runtime.cancelChat(requestId); };
  signal?.addEventListener('abort', abort);
  const finish = (status: 'done' | 'error' | 'cancelled', fields: Partial<Parameters<typeof finalizeExecutionResult>[2]>) =>
    finalizeExecutionResult(id, status, {
      id, tool: TOOL, label: 'Quenta Stage page', inputs: resultIds,
      params: { model: config.model, instruction }, sideEffects: [], output: null,
      startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt, error: null,
      ...fields,
    });

  try {
    let presentation: LiatirQuentaPresentation | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error('Stage page cancelled.');
      requestId = crypto.randomUUID();
      let content = '';
      let characters = 0;
      try {
        onProgress?.({ stage: attempt === 0 ? 'writing' : 'repairing', characters });
        const request = { model: config.model, messages, temperature: TEMPERATURE, thinkingEnabled: false, format, maxOutputTokens: OUTPUT_TOKENS };
        content = (await runtime.chat(request, requestId, (event) => {
          if (event.type !== 'content-delta') return;
          characters += event.delta.length;
          onProgress?.({ stage: attempt === 0 ? 'writing' : 'repairing', characters });
        })).content;
        onProgress?.({ stage: 'checking' });
        const { page, problems } = checkPage(content, tables);
        if (!page) throw new PageRejected(problems);
        const candidate: LiatirQuentaPresentation = { ...base, title: page.title, page: page as unknown as JsonValue };
        // A timeout gets one more display check, never a repair: the page itself was accepted.
        await checkRendering(candidate).catch((error) => {
          if (error instanceof DisplayTimeout) return checkRendering(candidate);
          throw error;
        });
        presentation = candidate;
        break;
      } catch (error) {
        presentation = undefined;
        if (signal?.aborted || attempt === 1 || error instanceof DisplayTimeout) throw error;
        const problems = error instanceof PageRejected ? error.problems : [String(error)];
        messages.push(...repairMessages(problems, content));
        await executionRuns.appendLog(id, `Repairing the page once: ${problems.join(' ')}`);
      } finally {
        await runtime.forgetChat(requestId).catch(() => false);
      }
    }
    if (!presentation || signal?.aborted) throw new Error('Stage page cancelled or incomplete.');

    onProgress?.({ stage: 'saving' });
    const api = liatir();
    if (!api) throw new Error('Liatir is unavailable.');
    await storeBundledRuntime();
    const dir = await ensureRunOutputDir(id);
    await api.invoke('lia_write_file_path', { path: `${dir}/presentation.html`, content: await presentationHtml({ ...presentation, runtimeSource }) });
    await api.invoke('lia_write_file_path', { path: `${dir}/sources.json`, content: JSON.stringify(presentation, null, 2) });
    await finish('done', {
      label: presentation.title,
      params: { model: config.model, instruction, sourceResultIds: resultIds, revision: Boolean(previous) },
      outputFiles: [
        { path: `${dir}/presentation.html`, label: 'Offline Stage page', ext: 'html' },
        { path: `${dir}/sources.json`, label: 'Stage page sources and content', ext: 'json' },
      ],
      output: { sections: [{ type: 'html-presentation', label: presentation.title, presentation }] },
    });
    return id;
  } catch (error) {
    await finish(signal?.aborted ? 'cancelled' : 'error', { error: String(error) });
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
