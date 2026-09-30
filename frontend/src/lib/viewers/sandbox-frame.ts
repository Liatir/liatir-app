/**
 * Runs a self-contained viewer document inside a sandboxed iframe.
 *
 * The viewers sandbox third-party libraries (3Dmol.js, JBrowse) away from the app: the frame is
 * `sandbox="allow-scripts"`, so it has an opaque origin and cannot reach Liatir's DOM, stores or
 * bridge. The document cannot be served from a blob: URL, because in production that document
 * inherits the app's Content Security Policy and every inline script in it is refused. Instead the
 * frame loads the static host page and is handed the document by postMessage; the host page explains
 * how it runs the scripts.
 */
import type { Action } from 'svelte/action';
import { liatir } from '$lib/api';

export const VIEWER_SANDBOX_SRC = '/viewer-sandbox.html';

/**
 * How long the viewer has to post its first message. Without an answer the frame stays blank, so the
 * caller falls back to what it can show on its own instead of leaving an empty box.
 */
export const VIEWER_START_TIMEOUT_MS = 15_000;

/** Matches the host page. The name can never resolve, so a request the host misses fails closed. */
const FILE_URL_PREFIX = 'https://sandbox-file.liatir.invalid/';

/** The URL a viewer inside the frame fetches to read the local file registered under `token`. */
export function sandboxFileUrl(token: string): string {
  return `${FILE_URL_PREFIX}${encodeURIComponent(token)}`;
}

export interface SandboxDocument {
  html: string;
  /** The frame never answered: it was blocked, or the library hung before reporting. */
  onStalled: () => void;
  /**
   * Local files the viewer may read, by token. The frame names a token, never a path, so it can read
   * only what it was given.
   */
  files?: Record<string, string>;
}

interface FileRead {
  id: number;
  token: string;
  range: string | null;
}

function decodeBase64(dataBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(dataBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Answers one file read the way an HTTP server answers a GET, with or without a byte range. */
async function readForFrame(files: Record<string, string>, request: FileRead) {
  const path = files[decodeURIComponent(request.token)];
  if (!path) return { status: 404, headers: {}, body: null };
  const api = liatir();
  if (!api) throw new Error('Liatir API not available.');
  const range = request.range ? /^bytes=(\d+)-(\d*)$/.exec(request.range.trim()) : null;
  if (request.range && !range) throw new Error(`Unsupported byte range: ${request.range}`);
  const start = range ? Number(range[1]) : 0;
  const length = range?.[2] ? Number(range[2]) - start + 1 : undefined;
  const read = await api.desktop.files.readRange(path, start, length);
  const body = decodeBase64(read.dataBase64);
  if (!range) return { status: 200, headers: { 'content-length': String(body.byteLength) }, body: body.buffer };
  if (start >= read.totalBytes) return { status: 416, headers: { 'content-range': `bytes */${read.totalBytes}` }, body: null };
  return {
    status: 206,
    headers: {
      'content-length': String(body.byteLength),
      'content-range': `bytes ${start}-${start + body.byteLength - 1}/${read.totalBytes}`,
    },
    body: body.buffer,
  };
}

/**
 * Loads the host page into the iframe, posts the document once the host reports ready, serves the
 * frame's file reads, and calls `onStalled` if the viewer then says nothing. The viewer's own first
 * message, ready or error, ends the wait. A new document means a new iframe: key the element on it.
 */
export const sandboxDocument: Action<HTMLIFrameElement, SandboxDocument> = (iframe, document) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function post(message: Record<string, unknown>, transfer: Transferable[] = []) {
    iframe.contentWindow?.postMessage(message, '*', transfer);
  }

  function onMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as ({ type?: string } & Partial<FileRead>) | null;
    if (data?.type === 'liatir-sandbox-ready') {
      post({ type: 'liatir-sandbox-render', html: document.html });
      return;
    }
    if (data?.type === 'liatir-sandbox-file-read') {
      const request = data as FileRead;
      readForFrame(document.files ?? {}, request)
        .then((answer) => post({ type: 'liatir-sandbox-file-data', id: request.id, ...answer }, answer.body ? [answer.body] : []))
        .catch((error) => post({ type: 'liatir-sandbox-file-data', id: request.id, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    clearTimeout(timer);
  }

  window.addEventListener('message', onMessage);
  // Started before the host page loads, so a frame the policy blocks outright is caught too.
  timer = setTimeout(() => document.onStalled(), VIEWER_START_TIMEOUT_MS);
  iframe.src = VIEWER_SANDBOX_SRC;

  return {
    destroy() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    },
  };
};
