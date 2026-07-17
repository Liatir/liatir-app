#!/usr/bin/env node
// Single source of truth → Quenta retrieval documents.
//
// This is the ONE generator that turns a folder of Markdown into the retrieval documents Quenta
// reads. It is corpus-agnostic on purpose: the same chunking/hashing logic serves every corpus, so
// the app seed and the online artifact can never drift apart (they come from this same function).
//
// Corpora (declared in CORPORA below):
//   - `knowledge` → quenta-knowledge/**/*.md  (curated bio knowledge, metadata from frontmatter)
//   - `docs`      → docs/**/*.md              (user-facing Liatir docs, metadata derived from path)
//
// Outputs are chosen by the --out extension:
//   - `.ts`   → a typed seed module imported into the app bundle (committed, deterministic)
//   - `.json` → the machine-readable artifact published next to the docs site (fetched at runtime)
//
// Usage (paths are always resolved relative to the repo root, regardless of cwd):
//   node scripts/build-quenta-docs.mjs <corpus> --out <path>
//   node scripts/build-quenta-docs.mjs knowledge --out frontend/src/lib/quenta/generated/quenta-knowledge.generated.ts
//   node scripts/build-quenta-docs.mjs docs --out docs/public/quenta-docs.json

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Corpus definitions ───────────────────────────────────────────────────────
// Each corpus says where its Markdown lives and how to derive a document's identity/metadata.
//   metadata: 'frontmatter' → id/sourceKind/title/locator come from the file's YAML-ish header.
//   metadata: 'path'        → derived from the file path (docs have no frontmatter of their own).
const CORPORA = {
  knowledge: {
    srcDir: 'quenta-knowledge',
    metadata: 'frontmatter',
    seedExport: 'QUENTA_KNOWLEDGE_SEED',
    // Files that are documentation about this folder, not retrieval content.
    exclude: ['README.md'],
  },
  docs: {
    srcDir: 'docs',
    metadata: 'path',
    seedExport: 'QUENTA_DOCS_SEED',
    defaultSourceKind: 'documentation',
    idPrefix: 'docs:',
    locatorPrefix: 'Docs',
    // Site scaffolding, dependencies and legal/marketing pages carry no product knowledge.
    excludeDirs: ['node_modules', 'public', '.vitepress'],
    exclude: [
      'DEPLOY-cloudflare.md',
      'index.md',
      'privacy.md',
      'terms.md',
      'donate.md',
      'branding.md',
    ],
  },
};

// ── Filesystem walk ──────────────────────────────────────────────────────────
// Collects every Markdown file under `dir`, skipping excluded directories. Sorted for a stable
// document order, which is what keeps the content hash deterministic across machines.
function collectMarkdown(dir, corpus, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ((corpus.excludeDirs ?? []).includes(entry.name)) continue;
      collectMarkdown(full, corpus, results);
    } else if (entry.name.endsWith('.md') && !(corpus.exclude ?? []).includes(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── Frontmatter ──────────────────────────────────────────────────────────────
// A deliberately tiny parser: our frontmatter is flat `key: value` lines, so pulling in a YAML
// dependency would be overkill. Returns { data, body } with the header stripped from the body.
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Tolerate quoted values without a full YAML implementation.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

// Turns a heading into a URL/id-safe slug used to address a sub-section document.
function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

// Collapses whitespace and clips to a retrieval-friendly excerpt.
function excerptOf(text, max = 260) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// ── Chunking ─────────────────────────────────────────────────────────────────
// One Markdown file → one or more retrieval documents, split on `##` headings so a subtopic is its
// own retrievable unit (better ranking than one giant blob). Text before the first `##` becomes an
// overview document carrying the file's base id; each `##` section becomes `<baseId>#<section-slug>`.
function chunkFile(fullPath, corpus) {
  const raw = fs.readFileSync(fullPath, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const rel = path.relative(path.join(ROOT, corpus.srcDir), fullPath).replace(/\\/g, '/');

  // Base identity: from frontmatter, or derived from the file path for corpora without headers.
  const base = deriveBaseIdentity(data, rel, body, corpus);

  // Split the body into an intro (pre-`##`) plus each `##` section.
  const lines = body.split(/\r?\n/);
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      sections.push(current);
      current = { heading: h2[1].trim(), lines: [] };
    } else {
      // Drop the top-level `# Title` line: its content is already captured by `base.title`.
      if (/^#\s+/.test(line) && current.heading === null && sections.length === 0) continue;
      current.lines.push(line);
    }
  }
  sections.push(current);

  const documents = [];
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (!text) continue;
    const isIntro = section.heading === null;
    const id = isIntro ? base.id : `${base.id}#${slugify(section.heading)}`;
    const title = isIntro ? base.title : `${base.title} — ${section.heading}`;
    const locator = isIntro ? base.locator : `${base.locator} / ${section.heading}`;
    const content = isIntro ? text : `${section.heading}\n${text}`;
    documents.push({
      id,
      sourceKind: base.sourceKind,
      title,
      locator,
      excerpt: excerptOf(content),
      content,
    });
  }
  return documents;
}

// Resolves a file's base id/title/locator/sourceKind from either frontmatter or its path.
function deriveBaseIdentity(data, rel, body, corpus) {
  if (corpus.metadata === 'frontmatter') {
    if (!data.id || !data.sourceKind || !data.title || !data.locator) {
      throw new Error(`Missing frontmatter (id/sourceKind/title/locator) in ${corpus.srcDir}/${rel}`);
    }
    return { id: data.id, sourceKind: data.sourceKind, title: data.title, locator: data.locator };
  }
  // Path-derived: e.g. "tools/fastp.md" → id "docs:tools/fastp", locator "Docs / Tools / fastp".
  const withoutExt = rel.replace(/\.md$/, '');
  const parts = withoutExt.split('/');
  const h1 = /^#\s+(.*)$/m.exec(body);
  const title = h1 ? h1[1].trim() : parts[parts.length - 1];
  const locator = [corpus.locatorPrefix, ...parts.map((p) => p.replace(/[-_]/g, ' '))]
    .map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' / ');
  return {
    id: `${corpus.idPrefix}${withoutExt}`,
    sourceKind: corpus.defaultSourceKind,
    title,
    locator,
  };
}

// ── Build ────────────────────────────────────────────────────────────────────
function buildCorpus(name) {
  const corpus = CORPORA[name];
  if (!corpus) throw new Error(`Unknown corpus "${name}". Known: ${Object.keys(CORPORA).join(', ')}`);
  const files = collectMarkdown(path.join(ROOT, corpus.srcDir), corpus);
  const documents = [];
  const seenIds = new Set();
  for (const file of files) {
    for (const doc of chunkFile(file, corpus)) {
      if (seenIds.has(doc.id)) throw new Error(`Duplicate document id "${doc.id}" (from ${file})`);
      seenIds.add(doc.id);
      documents.push(doc);
    }
  }
  // Content-only hash (no timestamps): identical content → identical hash, on any machine. This is
  // exactly what the runtime sync compares to decide whether the online artifact is newer.
  const hash = crypto.createHash('sha256').update(JSON.stringify(documents)).digest('hex');
  return { corpus, documents, hash };
}

// ── Output writers ───────────────────────────────────────────────────────────
function writeTsSeed(outPath, exportName, documents, hash) {
  const banner =
    '// AUTO-GENERATED by scripts/build-quenta-docs.mjs — do not edit by hand.\n' +
    '// Regenerate with: node scripts/build-quenta-docs.mjs <corpus> --out <this file>\n';
  const body =
    `import type { LiatirQuentaContextDocument } from '@liatir/core';\n\n` +
    `export const ${exportName}_HASH = ${JSON.stringify(hash)};\n\n` +
    `export const ${exportName}: LiatirQuentaContextDocument[] = ${JSON.stringify(documents, null, 2)};\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${banner}\n${body}`);
}

function writeJson(outPath, name, documents, hash) {
  const payload = { corpus: name, hash, generatedAt: new Date().toISOString(), documents };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  const outIdx = args.indexOf('--out');
  if (!name || outIdx === -1 || !args[outIdx + 1]) {
    console.error('Usage: node scripts/build-quenta-docs.mjs <corpus> --out <path>');
    process.exit(1);
  }
  const outPath = path.isAbsolute(args[outIdx + 1]) ? args[outIdx + 1] : path.join(ROOT, args[outIdx + 1]);
  const { corpus, documents, hash } = buildCorpus(name);
  if (outPath.endsWith('.ts')) {
    writeTsSeed(outPath, corpus.seedExport, documents, hash);
  } else if (outPath.endsWith('.json')) {
    writeJson(outPath, name, documents, hash);
  } else {
    console.error(`Unsupported output extension for ${outPath} (use .ts or .json)`);
    process.exit(1);
  }
  console.log(`quenta-docs: ${name} → ${path.relative(ROOT, outPath)} (${documents.length} docs, hash ${hash.slice(0, 12)})`);
}

main();
