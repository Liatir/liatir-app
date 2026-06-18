#!/usr/bin/env node
// Generates two frontend files:
//   frontend/src/lib/liatir-sdk-types.ts       — full .d.ts string for future TS worker
//   frontend/src/lib/liatir-completions.generated.ts — CodeMirror completion tree
//
// Usage: npm run gen:sdk-types  (from repo root)

import fs   from 'fs';
import path from 'path';
import ts   from 'typescript';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__dirname, '..');
const SRC_TS  = path.join(ROOT, 'src-ts');
const OUT_DIR = path.join(ROOT, 'frontend', 'src', 'lib');

// ── 1. Collect _types.ts files ──────────────────────────────────────────────

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())      walk(full, results);
    else if (entry.name === '_types.ts') results.push(full);
  }
  return results;
}

const typeFiles = walk(SRC_TS).sort();

// ── 2. Generate liatirSdkTypes string ───────────────────────────────────────

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

let sdkBody = PREAMBLE;
for (const file of typeFiles) {
  const rel     = path.relative(ROOT, file).replaceAll('\\', '/');
  const content = fs.readFileSync(file, 'utf-8');
  const stripped = content
    .replace(/^import\s[^;]*;(\r?\n)?/gm, '')
    .replace(/^import\s[\s\S]*?from\s['"][^'"]*['"];(\r?\n)?/gm, '')
    .trim();
  if (stripped) sdkBody += `\n// Source: ${rel}\n${stripped}\n`;
}

sdkBody += `
// ── Global declaration ─────────────────────────────────────────────────────
declare global {
  /** The Liatir native bridge API — available as window.Liatir inside Tauri. */
  const Liatir: LiatirAPI;
}
export {};
`;

const sdkVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf-8')
).version ?? 'unknown';

fs.writeFileSync(
  path.join(OUT_DIR, 'liatir-sdk-types.ts'),
  `// This file is generated automatically — do not edit.\n` +
  `// Run:  npm run gen:sdk-types\n` +
  `// Source: src-ts/**/_types.ts  (liatir@${sdkVersion})\n\n` +
  `export const liatirSdkTypes = ${JSON.stringify(sdkBody)};\n`,
  'utf-8'
);
console.log(`✓ liatir-sdk-types.ts  (${(Buffer.byteLength(sdkBody) / 1024).toFixed(1)} KB)`);

// ── 3. Generate completion tree via TypeScript compiler ──────────────────────

const compilerOptions = ts.convertCompilerOptionsFromJson({
  target: 'ES2021',
  lib: ['dom', 'es2021'],
  strict: false,
  skipLibCheck: true,
  moduleResolution: 'node',
  noEmit: true,
}, ROOT).options;

const program = ts.createProgram(
  [path.join(SRC_TS, 'liatir', '_types.ts'), ...typeFiles],
  compilerOptions
);
const checker = program.getTypeChecker();

// Find a named type alias or interface across all non-node_modules source files
function findType(name) {
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules')) continue;
    for (const stmt of sf.statements) {
      if (
        (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) &&
        stmt.name.text === name
      ) {
        return checker.getTypeAtLocation(stmt.name);
      }
    }
  }
  return null;
}

// Get the declaration source file for a type symbol
function isInSrcTs(type) {
  const sym = type.aliasSymbol ?? type.symbol;
  if (!sym) return false;
  const decl = sym.declarations?.[0];
  if (!decl) return false;
  const fn = decl.getSourceFile().fileName;
  return fn.includes('/src-ts/') || fn.includes('\\src-ts\\');
}

// Stringify a type for the detail field
const FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function typeStr(type) {
  return checker.typeToString(type, undefined, FORMAT_FLAGS);
}

// Get the first JSDoc comment for a symbol
function getDoc(sym) {
  const parts = sym.getDocumentationComment(checker);
  const text  = ts.displayPartsToString(parts).trim();
  return text || undefined;
}

// Recursively build the ApiNode tree from a TypeScript type
function buildTree(type, depth = 0, visited = new Set()) {
  if (depth > 6) return {};
  const key = typeStr(type);
  if (visited.has(key)) return {};
  visited = new Set(visited); // don't mutate caller's set
  visited.add(key);

  const result = {};
  const props  = checker.getPropertiesOfType(type);

  for (const prop of props) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl) continue;

    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    const callSigs = propType.getCallSignatures();
    const isMethod = callSigs.length > 0;

    // detail: for methods use the first call signature; for props use typeStr
    let detail;
    if (isMethod) {
      detail = checker.signatureToString(
        callSigs[0],
        undefined,
        ts.TypeFormatFlags.NoTruncation,
        ts.SignatureKind.Call
      );
    } else {
      detail = typeStr(propType);
    }

    const info = getDoc(prop);

    const node = {
      type:   isMethod ? 'method' : 'property',
      detail: detail.replace(/\s+/g, ' ').trim(),
      ...(info ? { info } : {}),
    };

    // Recurse into object types from src-ts/
    if (!isMethod && isInSrcTs(propType)) {
      const children = buildTree(propType, depth + 1, visited);
      if (Object.keys(children).length > 0) node.children = children;
    }

    result[prop.name] = node;
  }

  return result;
}

const liatirType = findType('LiatirAPI');
if (!liatirType) {
  console.error('ERROR: LiatirAPI type not found in src-ts/');
  process.exit(1);
}

const tree = buildTree(liatirType);

// Serialize the tree as a TypeScript literal (with type annotations stripped)
function serialize(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = Object.entries(obj).map(([k, v]) => {
    const keyStr = /^\w+$/.test(k) ? k : JSON.stringify(k);
    const valParts = [];
    valParts.push(`type: ${JSON.stringify(v.type)}`);
    valParts.push(`detail: ${JSON.stringify(v.detail)}`);
    if (v.info)      valParts.push(`info: ${JSON.stringify(v.info)}`);
    if (v.children)  valParts.push(`children: {\n${serialize(v.children, indent + 2)}\n${pad}  }`);
    return `${pad}  ${keyStr}: { ${valParts.join(', ')} },`;
  });
  return lines.join('\n');
}

const completionsOutput =
`// This file is generated automatically — do not edit.
// Run:  npm run gen:sdk-types
// Source: src-ts/liatir/_types.ts → LiatirAPI  (liatir@${sdkVersion})

import type { ApiNode } from './liatir-editor';

export const LIATIR_API: Record<string, ApiNode> = {
${serialize(tree, 0)}
};
`;

fs.writeFileSync(path.join(OUT_DIR, 'liatir-completions.generated.ts'), completionsOutput, 'utf-8');
console.log(`✓ liatir-completions.generated.ts  (${Object.keys(tree).length} top-level entries)`);
