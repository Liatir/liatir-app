import type {
  LiatirQuentaCitation,
  LiatirQuentaContextDocument,
} from '@liatir/core';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
  'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
  'was', 'what', 'when', 'where', 'which', 'with', 'why',
]);

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}._:-]+/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function scoreDocument(query: string, document: LiatirQuentaContextDocument): number {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return 0;
  const titleTerms = new Set(terms(document.title));
  const contentTerms = terms(`${document.locator} ${document.content}`);
  const frequencies = new Map<string, number>();
  for (const term of contentTerms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);

  let score = 0;
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
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      const aRequired = requiredIds.has(a.document.id) ? 1 : 0;
      const bRequired = requiredIds.has(b.document.id) ? 1 : 0;
      return bRequired - aRequired || b.score - a.score || a.index - b.index;
    });

  const selected: LiatirQuentaContextDocument[] = [];
  let usedChars = 0;
  for (const item of ranked) {
    if (selected.length >= limit) break;
    const cost = item.document.content.length + item.document.title.length + 80;
    if (selected.length > 0 && usedChars + cost > maxChars) continue;
    selected.push(item.document);
    usedChars += cost;
  }

  const context = selected
    .map((document) =>
      `<source id="${document.id}" kind="${document.sourceKind}" locator="${document.locator}">\n` +
      `${document.title}\n${document.content}\n</source>`)
    .join('\n\n');
  const citations = selected.map(({ content: _content, updatedAt: _updatedAt, ...citation }) => ({
    ...citation,
    excerpt: citation.excerpt ?? _content.slice(0, 240),
  }));
  return { documents: selected, citations, context };
}

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
