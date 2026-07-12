/**
 * Retrieval for Quenta: picks which context documents go into the prompt.
 *
 * A deliberately simple lexical ranker — term overlap, no embeddings, no model call. That is the
 * right trade here: it runs locally in microseconds, needs no AI Model to be installed, and the
 * things users actually ask about (a filename, a tool name, a run ID, an error string) are exact
 * tokens that term matching finds reliably.
 */
import type {
  LiatirQuentaCitation,
  LiatirQuentaContextDocument,
} from '@liatir/core';

/** Words too common to carry signal; scoring them would rank every document alike. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'what', 'when', 'where', 'which', 'with', 'why',
]);

/**
 * Splits text into comparable terms.
 *
 * Note which characters are *kept*: `.`, `_`, `:` and `-`. That is on purpose — it keeps
 * `sample.fastq`, `run:abc-123` and `scgpt_embedding` as single tokens rather than shredding the
 * exact identifiers a user is most likely to paste into a question.
 */
function terms(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._:-]+/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

/**
 * Scores one document against the query. Three signals, weighted by how much they actually mean:
 *
 *   - a query term in the **title** (+5) — the strongest hint that the document is *about* the term;
 *   - a query term in the body (+1, plus a log of its frequency) — the logarithm is what stops a
 *     long log file that repeats a word 500 times from outranking a short, precisely relevant one;
 *   - the whole query appearing **verbatim** (+8) — a pasted error message or path, which is close
 *     to proof of relevance. Guarded by a length check so short queries do not trigger it.
 */
function scoreDocument(query: string, document: LiatirQuentaContextDocument): number {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return 0;
  const titleTerms = new Set(terms(document.title));
  // The locator is folded into the body text, so "Results / bwa / …" matches a question about bwa.
  const contentTerms = terms(`${document.locator} ${document.content}`);
  const frequencies = new Map<string, number>();
  for (const term of contentTerms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);

  let score = 0;
  // Deduplicated: repeating a word in the question should not multiply its weight.
  for (const term of new Set(queryTerms)) {
    if (titleTerms.has(term)) score += 5;
    const frequency = frequencies.get(term) ?? 0;
    if (frequency > 0) score += 1 + Math.log2(frequency + 1);
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length > 5 && document.content.toLowerCase().includes(normalizedQuery)) {
    score += 8;
  }
  return score;
}

export interface QuentaRetrievalResult {
  documents: LiatirQuentaContextDocument[];
  citations: LiatirQuentaCitation[];
  context: string;
}

/**
 * Ranks the documents, fits the best of them into the character budget, and renders the prompt
 * context along with the citations the answer may refer back to.
 *
 * `requiredIds` (the focused entity — see `requiredContextIdsForFocus`) is forced to the front:
 * both by a +1000 score and by an explicit sort key, so the entity the user is asking about is in
 * the prompt even if it scores badly on words. Being the subject of the question is its relevance.
 */
export function retrieveQuentaContext(
  query: string,
  documents: LiatirQuentaContextDocument[],
  options: { limit?: number; maxChars?: number; requiredIds?: string[] } = {},
): QuentaRetrievalResult {
  const limit = options.limit ?? 8;
  const maxChars = options.maxChars ?? 14_000;
  const requiredIds = new Set(options.requiredIds ?? []);
  const ranked = documents
    .map((document, index) => ({
      document,
      index,
      score: scoreDocument(query, document) + (requiredIds.has(document.id) ? 1_000 : 0),
    }))
    // A zero score means not a single query term appeared: including it would only dilute the prompt.
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      const aRequired = requiredIds.has(a.document.id) ? 1 : 0;
      const bRequired = requiredIds.has(b.document.id) ? 1 : 0;
      // Required first, then by score, then by original order — the last key makes ties stable, so
      // the same question always retrieves the same context.
      return bRequired - aRequired || b.score - a.score || a.index - b.index;
    });

  const selected: LiatirQuentaContextDocument[] = [];
  let usedChars = 0;
  for (const item of ranked) {
    if (selected.length >= limit) break;
    // +80 approximates the wrapper markup added per document below.
    const cost = item.document.content.length + item.document.title.length + 80;
    // `continue`, not `break`: a single oversized document is skipped, but smaller ones further
    // down the ranking can still fit. And the first document is admitted unconditionally, so the
    // best match is never dropped for being large — an empty context would be worse than a full one.
    if (selected.length > 0 && usedChars + cost > maxChars) continue;
    selected.push(item.document);
    usedChars += cost;
  }

  // Wrapped in tagged blocks carrying the document's ID, so the model can cite a source by `[id]` —
  // which `citedSources` below then resolves back into a real, clickable reference.
  const context = selected
    .map((document) =>
      `<source id="${document.id}" kind="${document.sourceKind}" locator="${document.locator}">\n` +
      `${document.title}\n${document.content}\n</source>`)
    .join('\n\n');
  // Citations carry only what the UI needs to show and link a source — the full content is dropped.
  const citations = selected.map(({ content: _content, updatedAt: _updatedAt, ...citation }) => ({
    ...citation,
    excerpt: citation.excerpt ?? _content.slice(0, 240),
  }));
  return { documents: selected, citations, context };
}

/**
 * Resolves the `[source-id]` markers in an answer back to real citations.
 *
 * Filtering against `available` is what keeps citations honest: a model that invents a plausible
 * source ID gets it silently dropped rather than shown to the user as a genuine reference.
 */
export function citedSources(
  content: string,
  available: LiatirQuentaCitation[],
): LiatirQuentaCitation[] {
  const mentioned = new Set<string>();
  for (const match of content.matchAll(/\[([a-z0-9][a-z0-9:._-]+)\]/gi)) {
    mentioned.add(match[1]);
  }
  return available.filter((citation) => mentioned.has(citation.id));
}
