#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const REVISION = '04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5';
const ARCHIVE = join(
  ROOT,
  '.runtime-box-dist',
  'geneformer-v1-10m-1.0.0-beta.1-macos-aarch64-metal.zip',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}${result.stderr ? `\n${result.stderr}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function extractEmbeddedScript(source) {
  const prefix = 'export const GENEFORMER_EMBEDDING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product Geneformer runner.');
  return source.slice(start + prefix.length, end);
}

const workDir = await mkdtemp(join(tmpdir(), 'liatir-geneformer-parity-'));
try {
  const runtimeDir = join(workDir, 'runtime');
  const upstreamDir = join(workDir, 'Geneformer');
  run('unzip', ['-q', ARCHIVE, '-d', runtimeDir]);
  run('git', [
    'clone', '--quiet', '--filter=blob:none', '--no-checkout',
    'https://huggingface.co/ctheodoris/Geneformer', upstreamDir,
  ]);
  run('git', ['checkout', '--quiet', REVISION, '--', 'geneformer/tokenizer.py'], { cwd: upstreamDir });

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/geneformer-embedding.ts'),
    'utf8',
  );
  const productScript = join(workDir, 'liatir-geneformer.py');
  await writeFile(productScript, extractEmbeddedScript(productSource));
  const output = run(
    join(runtimeDir, 'venv/bin/python'),
    [
      join(ROOT, 'scripts/ai-validation/geneformer-parity.py'),
      '--runtime-dir', runtimeDir,
      '--product-script', productScript,
      '--upstream-tokenizer', join(upstreamDir, 'geneformer/tokenizer.py'),
      '--work-dir', join(workDir, 'validation'),
    ],
    { capture: true },
  );
  console.log(output);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
