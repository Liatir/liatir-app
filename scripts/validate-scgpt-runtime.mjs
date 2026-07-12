#!/usr/bin/env node

/**
 * End-to-end inference check for the scGPT Runtime Box.
 *
 * Proves the built box does not merely import cleanly, but actually produces usable embeddings:
 * it synthesises a small single-cell input, runs the *shipped* scGPT script against it inside the
 * box's own interpreter, and asserts the output has the expected shape and contains no NaN/Inf.
 *
 * The finiteness check is the substantive one. A model that silently emits NaNs still "succeeds"
 * — no exception, no crash — and would hand the user embeddings that are quietly meaningless.
 * That is exactly the failure this is here to catch.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
/** Requires the box to have been built first; this validates that build's output. */
const ARCHIVE = join(
  ROOT,
  '.runtime-box-dist',
  'scgpt-whole-human-0.2.5-beta.1-macos-aarch64-metal.zip',
);

/**
 * Builds a minimal but *valid* AnnData input: one cell, 128 genes drawn from the model's own
 * vocabulary. Taking the gene names from the box's `vocab.json` matters — genes the model does not
 * know would be dropped, and the run could pass while exercising nothing. The counts are generated
 * from a fixed formula rather than randomly, so the fixture is identical on every run.
 */
const FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import sys

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp

payload = json.loads(sys.stdin.read())
runtime = Path(payload["runtimeDir"])
with (runtime / "model-cache/scgpt-whole-human/vocab.json").open("r", encoding="utf-8") as source:
    vocab = json.load(source)
genes = sorted(gene for gene in vocab if not gene.startswith("<"))[:128]
counts = np.asarray([
    [((gene_index * 19) % 101) + 1 for gene_index in range(len(genes))]
], dtype=np.int32)
obs = pd.DataFrame(index=["cell-1"])
var = pd.DataFrame({"gene_name": genes}, index=genes)
fixture = runtime / "scgpt-validation-input.h5ad"
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture)
print(json.dumps({"inputFile": str(fixture), "cells": 1, "genes": 128}))
`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/**
 * Pulls the scGPT runner out of the TypeScript file that ships it, so the script being validated
 * is literally the one users run — not a copy that could drift out of sync.
 */
function extractEmbeddedScript(source) {
  const prefix = 'export const SCGPT_EMBEDDING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product scGPT runner.');
  return source.slice(start + prefix.length, end);
}

const workDir = await mkdtemp(join(tmpdir(), 'liatir-scgpt-validation-'));
try {
  const runtimeDir = join(workDir, 'runtime');
  run('unzip', ['-q', ARCHIVE, '-d', runtimeDir]);
  const python = join(runtimeDir, 'venv/bin/python');
  const fixtureScript = join(workDir, 'fixture.py');
  await writeFile(fixtureScript, FIXTURE_SCRIPT);
  const fixture = JSON.parse(run(
    python,
    [fixtureScript],
    { input: JSON.stringify({ runtimeDir }) },
  ));

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/scgpt-embedding.ts'),
    'utf8',
  );
  const productScript = join(workDir, 'liatir-scgpt.py');
  await writeFile(productScript, extractEmbeddedScript(productSource));
  // CPU by default: it is the deterministic, always-available path, so a failure here is a real
  // model problem rather than a GPU quirk. Set LIATIR_VALIDATE_USE_ACCELERATOR=1 to exercise Metal.
  const result = JSON.parse(run(
    python,
    [productScript],
    {
      env: process.env.LIATIR_VALIDATE_USE_ACCELERATOR === '1'
        ? {}
        : { LIATIR_AI_FORCE_CPU: '1' },
      input: JSON.stringify({
        runtimePath: runtimeDir,
        modelCacheDir: join(runtimeDir, 'model-cache/scgpt-whole-human'),
        inputFile: fixture.inputFile,
        outputDir: join(workDir, 'output'),
        species: 'human',
        batchSize: 1,
        maxCsvRows: 1,
      }),
    },
  ));
  // The real assertion: 1 cell in, a 512-dim embedding out, and every value finite. A NaN-filled
  // tensor would otherwise sail through as a "successful" run.
  const finite = result.preview.flat().every(Number.isFinite);
  if (!finite || result.summary.cellCount !== 1 || result.summary.embeddingDim !== 512) {
    throw new Error('scGPT inference output failed validation.');
  }
  console.log(JSON.stringify({
    status: 'passed',
    model: result.summary.model,
    cells: result.summary.cellCount,
    genes: result.summary.geneCount,
    embeddingShape: [result.summary.cellCount, result.summary.embeddingDim],
    accelerator: result.summary.accelerator,
    finitePreview: finite,
  }, null, 2));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
