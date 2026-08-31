#!/usr/bin/env node
/** Build the statically linked Linux helper that consumes boxes inside WSL2. */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'tools', 'native-tools-box-consumer', 'Cargo.toml');
const TARGET = 'x86_64-unknown-linux-musl';
const OUTPUT = path.join(ROOT, 'src-tauri', 'resources', 'native-tools', 'native-tools-box-consumer');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The WSL2 Scrollcase consumer must be built on Linux x86_64.');
}
const result = spawnSync('cargo', [
  'build', '--locked', '--release', '--target', TARGET, '--manifest-path', MANIFEST,
], { cwd: ROOT, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`cargo exited with status ${result.status}.`);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.copyFileSync(
  path.join(ROOT, 'tools', 'native-tools-box-consumer', 'target', TARGET, 'release', 'native-tools-box-consumer'),
  OUTPUT,
);
fs.chmodSync(OUTPUT, 0o755);
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
