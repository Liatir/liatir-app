#!/usr/bin/env node
// Generates frontend/src/lib/offlab-sdk-types.ts
// Usage: node scripts/generate-sdk-types.mjs
//
// Reads every _types.ts file under src-ts/, strips import statements,
// inlines primitive type aliases, and emits a single TypeScript string
// that can be fed to a TS language server (Monaco / CodeMirror worker).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, '..');
const SRC_TS   = path.join(ROOT, 'src-ts');
const OUT_FILE = path.join(ROOT, 'frontend', 'src', 'lib', 'offlab-sdk-types.ts');

// ── Collect all _types.ts files ─────────────────────────────────────────────

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.name === '_types.ts') {
      results.push(full);
    }
  }
  return results;
}

// Also include the top-level types.ts (re-exports everything)
const typeFiles = [
  ...walk(SRC_TS),
].sort();

// ── Build the types string ───────────────────────────────────────────────────

// Primitive aliases — inlined so the generated string is self-contained
const PREAMBLE = `
// ── Primitive aliases ──────────────────────────────────────────────────────
type DtrPlatform = "macos" | "linux" | "windows";
type Brand<T, B extends string> = T & { readonly __brand: B };
type U8  = Brand<number, "u8">;
type U16 = Brand<number, "u16">;
type U32 = Brand<number, "u32">;
type U64 = Brand<number, "u64">;
type I32 = Brand<number, "i32">;
`.trimStart();

let body = PREAMBLE;

for (const file of typeFiles) {
  const rel     = path.relative(ROOT, file).replaceAll('\\', '/');
  const content = fs.readFileSync(file, 'utf-8');

  // Strip import statements (single and multi-line)
  const stripped = content
    .replace(/^import\s[^;]*;(\r?\n)?/gm, '')   // single-line imports
    .replace(/^import\s[\s\S]*?from\s['"][^'"]*['"];(\r?\n)?/gm, '') // multi-line
    .trim();

  if (stripped) {
    body += `\n// Source: ${rel}\n${stripped}\n`;
  }
}

// Declare Offlab as a global constant so TS picks it up in user scripts
body += `
// ── Global declaration ─────────────────────────────────────────────────────
declare global {
  /**
   * The Offlab native bridge API.
   * Available as window.Offlab inside the Tauri webview.
   */
  const Offlab: OfflabAPI;
}
export {};
`;

// ── Write output file ────────────────────────────────────────────────────────

const sdkVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf-8')
).version ?? 'unknown';

const output = `// This file is generated automatically — do not edit.
// Run:  npm run gen:sdk-types  (from the repo root)
// Source package: offlab@${sdkVersion}
// Source directory: src-ts/**/_types.ts

export const offlabSdkTypes = ${JSON.stringify(body)};
`;

fs.writeFileSync(OUT_FILE, output, 'utf-8');
console.log(`✓ Generated ${path.relative(ROOT, OUT_FILE)}  (${(Buffer.byteLength(body) / 1024).toFixed(1)} KB)`);
