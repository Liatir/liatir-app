#!/usr/bin/env node

/**
 * Writes the manifest of the demo files bundled with the app.
 *
 * The app keeps a copy of the demo set in each installation and replaces that copy whole when the
 * bundled manifest differs from the copied one (`src-tauri/src/bridge/demo_files.rs`). That only
 * works if the manifest changes whenever a demo byte does, so it carries every file's SHA-256, and
 * the unit suite fails when a file changed without the manifest being regenerated with this script.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const DEMO_FILES_DIR = resolve(import.meta.dirname, '..', 'src-tauri', 'resources', 'demo-files');
export const DEMO_MANIFEST_NAME = 'manifest.json';

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    // Dotfiles are local noise (.DS_Store); listing one would make the manifest differ per machine.
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

/** The manifest the demo directory's current content requires, serialized exactly as committed. */
export function demoFilesManifest(root = DEMO_FILES_DIR) {
  const files = listFiles(root)
    .map((path) => ({ path: relative(root, path).split(sep).join('/'), bytes: readFileSync(path) }))
    .filter((file) => file.path !== DEMO_MANIFEST_NAME)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ path, bytes }) => ({
      path,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
  return `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  writeFileSync(join(DEMO_FILES_DIR, DEMO_MANIFEST_NAME), demoFilesManifest());
  console.log(`Wrote ${join('src-tauri', 'resources', 'demo-files', DEMO_MANIFEST_NAME)}`);
}
