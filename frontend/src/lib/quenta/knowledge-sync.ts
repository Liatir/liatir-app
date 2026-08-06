/**
 * Keeps Quenta's reference corpora up to date without ever leaving the assistant worse off.
 *
 * Two corpora flow through here — the curated bioinformatics knowledge (`quenta-knowledge/`) and the
 * user-facing Liatir docs (`docs/`) — each with three layers, every one a fallback for the next:
 *
 *   1. a build-time **seed** compiled into the app (always present, fully offline);
 *   2. a **cache** on disk, written by the last successful online sync;
 *   3. the **online** artifact on the docs site, fetched in the background at startup.
 *
 * The online update is transactional end to end — the Rust bridge validates the download and swaps
 * the cache atomically, so any failure (offline, HTTP error, malformed or inconsistent payload) is a
 * silent no-op. As a result the pool always holds a valid version of every corpus; a bad network day
 * only ever means "not the newest yet", never "broken" or "empty".
 *
 * The native Liatir/boundary knowledge is NOT synced — it lives compiled into the bundle in
 * `knowledge.ts`, because a security boundary must never sit on a path that can change at runtime.
 */
import { liatir } from '$lib/api';
import type { LiatirQuentaContextDocument } from '@liatir/core';
import {
  QUENTA_KNOWLEDGE_SEED,
  QUENTA_KNOWLEDGE_SEED_HASH,
} from './generated/quenta-knowledge.generated';
import { QUENTA_DOCS_SEED, QUENTA_DOCS_SEED_HASH } from './generated/quenta-docs.generated';

type QuentaCorpus = 'knowledge' | 'docs';
const CORPORA: QuentaCorpus[] = ['knowledge', 'docs'];

interface CorpusState {
  hash: string;
  documents: LiatirQuentaContextDocument[];
}

/**
 * The current best-known version of each corpus, seeded synchronously at module load so the pool is
 * usable from the very first question — before any cache read or network call has happened.
 */
const corpora: Record<QuentaCorpus, CorpusState> = {
  knowledge: { hash: QUENTA_KNOWLEDGE_SEED_HASH, documents: QUENTA_KNOWLEDGE_SEED },
  docs: { hash: QUENTA_DOCS_SEED_HASH, documents: QUENTA_DOCS_SEED },
};

let cachesLoaded = false;

/** The reference documents Quenta retrieves over, on top of the always-static native knowledge. */
export function syncedReferenceDocuments(): LiatirQuentaContextDocument[] {
  return [...corpora.knowledge.documents, ...corpora.docs.documents];
}

/** Narrows a parsed value to a usable document, so a corrupt cache can never enter the pool. */
function isValidDocument(value: unknown): value is LiatirQuentaContextDocument {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === 'string' && document.id.length > 0
    && typeof document.sourceKind === 'string' && document.sourceKind.length > 0
    && typeof document.title === 'string'
    && typeof document.locator === 'string'
    && typeof document.content === 'string' && document.content.length > 0
  );
}

/** Parses a cached corpus file, rejecting anything that is not a complete, valid corpus. */
function parseCorpusPayload(raw: string): CorpusState | null {
  try {
    const parsed = JSON.parse(raw) as { hash?: unknown; documents?: unknown };
    if (typeof parsed.hash !== 'string' || parsed.hash.length === 0) return null;
    if (!Array.isArray(parsed.documents) || parsed.documents.length === 0) return null;
    if (!parsed.documents.every(isValidDocument)) return null;
    return { hash: parsed.hash, documents: parsed.documents as LiatirQuentaContextDocument[] };
  } catch {
    return null;
  }
}

/** Loads a previously synced corpus from disk. A missing or corrupt cache is simply ignored. */
async function loadCache(corpus: QuentaCorpus): Promise<void> {
  const bridge = liatir();
  if (!bridge) return;
  const rel = `quenta/${corpus}-cache.json`;
  try {
    const exists = (await bridge.invoke('lia_app_exists', { rel })) as boolean;
    if (!exists) return;
    const raw = (await bridge.invoke('lia_app_read_text', { rel })) as string;
    const cached = parseCorpusPayload(raw);
    // A cache the app wrote earlier is at least as new as the seed, so it takes precedence.
    if (cached) corpora[corpus] = cached;
  } catch {
    // Unreadable or untrusted cache: not an error here — the seed already covers us.
  }
}

/** Pulls the newest online version for a corpus. Any failure leaves the current version untouched. */
async function syncCorpus(corpus: QuentaCorpus): Promise<void> {
  const bridge = liatir();
  if (!bridge) return;
  try {
    const result = (await bridge.invoke('lia_quenta_docs_sync', {
      corpus,
      knownHash: corpora[corpus].hash,
    })) as { updated?: boolean; hash?: string; documents?: unknown };
    // The bridge only reports `updated` after it has validated and atomically cached the payload;
    // we still re-check the shape here before letting anything into the retrieval pool.
    if (
      result.updated
      && typeof result.hash === 'string'
      && Array.isArray(result.documents)
      && result.documents.length > 0
      && result.documents.every(isValidDocument)
    ) {
      corpora[corpus] = {
        hash: result.hash,
        documents: result.documents as LiatirQuentaContextDocument[],
      };
    }
  } catch {
    // Offline, server error, or a rejected payload: keep the current corpus, retry next launch.
  }
}

/**
 * Brings the corpora to their best available version: caches first (fast, local), then a background
 * online refresh that must never block. Safe to call repeatedly — the caches load once, while the
 * online pass re-runs each time so a long-lived session can still pick up a later docs deploy.
 */
export async function initKnowledgeSync(): Promise<void> {
  if (!cachesLoaded) {
    cachesLoaded = true;
    await Promise.allSettled(CORPORA.map(loadCache));
  }
  void Promise.allSettled(CORPORA.map(syncCorpus));
}
