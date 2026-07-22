#!/usr/bin/env node

/** Validates real scGPT inference through the exact product runner on the checked target. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadRuntimeBoxValidatorContext,
  productAcceleratorForTarget,
  runtimeBoxAcceleratorKind,
} from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REVISION = 'cebd6fae655b9c585a4807daa3ac31bb764f06b4';
const MODEL_ID = 'bowang-scgpt-whole-human';
const ABSOLUTE_TOLERANCE = 0.02;
const RELATIVE_TOLERANCE = 0.02;
const MINIMUM_COSINE_SIMILARITY = 0.999;
const {
  recipe: RECIPE,
  targetId: TARGET_ID,
  runtimeDir: RUNTIME_DIR,
  python: PYTHON,
  dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'scgpt-whole-human-macos-arm64-metal',
  runtimeDirectoryEnvironment: 'LIATIR_SCGPT_RUNTIME_DIR',
});
if (RECIPE.modelId !== MODEL_ID || RECIPE.sourceRevision !== REVISION) {
  throw new Error('scGPT validation recipe provenance differs from the pinned model contract.');
}

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
fixture = Path(payload["fixturePath"])
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture)
print(json.dumps({"inputFile": str(fixture), "cells": 1, "genes": 128}))
`;

/** Runs a bounded child process and retains the output needed for scientific evidence. */
function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 30 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}\n${result.stderr || result.stdout}`);
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    durationMs: Date.now() - startedAt,
  };
}

/** Extracts the exact embedded runner shipped by the frontend. */
function extractEmbeddedScript(source) {
  const prefix = 'export const SCGPT_EMBEDDING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product scGPT runner.');
  return source.slice(start + prefix.length, end);
}

/** Finds the product runner's final structured result without trusting incidental stdout. */
function parseLastJson(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Continue to the previous structured line.
    }
  }
  throw new Error('scGPT runner did not emit a final JSON result.');
}

/** Reads the complete one-cell embedding from the product CSV artifact. */
async function readEmbedding(result) {
  const rows = (await readFile(result.embeddingPreviewPath, 'utf8')).trim().split(/\r?\n/);
  if (rows.length !== 2) throw new Error('scGPT preview must contain one header and one cell.');
  const values = rows[1].split(',').slice(1).map(Number);
  if (values.length !== 512 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('scGPT embedding artifact is non-finite or has the wrong shape.');
  }
  return values;
}

/** Compares an accelerator result to the deterministic CPU reference. */
function compareEmbeddings(cpu, accelerated) {
  const differences = cpu.map((value, index) => Math.abs(value - accelerated[index]));
  const allClose = differences.every(
    (difference, index) => difference <= ABSOLUTE_TOLERANCE
      + RELATIVE_TOLERANCE * Math.abs(cpu[index]),
  );
  const dot = cpu.reduce((total, value, index) => total + value * accelerated[index], 0);
  const cpuNorm = Math.sqrt(cpu.reduce((total, value) => total + value * value, 0));
  const acceleratedNorm = Math.sqrt(
    accelerated.reduce((total, value) => total + value * value, 0),
  );
  const cosine = dot / Math.max(cpuNorm * acceleratedNorm, 1e-12);
  const comparison = {
    allClose,
    maximumAbsoluteDifference: Math.max(...differences),
    meanAbsoluteDifference: differences.reduce((total, value) => total + value, 0)
      / differences.length,
    minimumCosineSimilarity: cosine,
  };
  if (!allClose || cosine < MINIMUM_COSINE_SIMILARITY) {
    throw new Error(`scGPT accelerator output exceeds tolerance: ${JSON.stringify(comparison)}`);
  }
  return comparison;
}

const workDir = await mkdtemp(join(tmpdir(), 'liatir-scgpt-validation-'));
try {
  const fixtureScript = join(workDir, 'fixture.py');
  const fixturePath = join(workDir, 'scgpt-validation-input.h5ad');
  await writeFile(fixtureScript, FIXTURE_SCRIPT);
  const fixture = JSON.parse(run(PYTHON, [fixtureScript], {
    input: JSON.stringify({ runtimeDir: RUNTIME_DIR, fixturePath }),
  }).stdout);
  const fixtureSha256 = createHash('sha256')
    .update(await readFile(fixture.inputFile))
    .digest('hex');
  const framework = JSON.parse(run(PYTHON, ['-c', [
    'import json, torch',
    'print(json.dumps({"name":"torch","version":torch.__version__,"reportedCudaCompatibility":torch.version.cuda}))',
  ].join(';')]).stdout);

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/scgpt-embedding.ts'),
    'utf8',
  );
  const productRunner = extractEmbeddedScript(productSource);
  const productRunnerSha256 = createHash('sha256').update(productRunner).digest('hex');
  const productScript = join(workDir, 'liatir-scgpt.py');
  await writeFile(productScript, productRunner);

  const runProduct = async (accelerator) => {
    const execution = run(PYTHON, [productScript], {
      input: JSON.stringify({
        runtimePath: RUNTIME_DIR,
        modelCacheDir: join(RUNTIME_DIR, 'model-cache/scgpt-whole-human'),
        inputFile: fixture.inputFile,
        outputDir: join(workDir, `output-${accelerator}`),
        species: 'human',
        batchSize: 1,
        maxCsvRows: 1,
        accelerator,
      }),
    });
    const result = parseLastJson(execution.stdout);
    const actualKind = runtimeBoxAcceleratorKind(result.summary.accelerator);
    const expectedKind = accelerator === 'mps' ? 'metal' : accelerator;
    if (actualKind !== expectedKind) {
      throw new Error(`scGPT requested ${accelerator}, but reported ${result.summary.accelerator}.`);
    }
    if (result.summary.cellCount !== 1 || result.summary.embeddingDim !== 512) {
      throw new Error('scGPT inference output has the wrong shape.');
    }
    return { result, execution, embedding: await readEmbedding(result) };
  };

  const cpu = await runProduct('cpu');
  const targetAccelerator = productAcceleratorForTarget(RECIPE.target);
  const accelerated = targetAccelerator === 'cpu'
    ? null
    : await runProduct(targetAccelerator);
  const comparison = accelerated ? compareEmbeddings(cpu.embedding, accelerated.embedding) : null;
  const targetRun = accelerated ?? cpu;
  const finite = [...cpu.embedding, ...(accelerated?.embedding ?? [])].every(Number.isFinite);

  console.log(JSON.stringify({
    status: 'passed',
    modelId: MODEL_ID,
    sourceRevision: REVISION,
    targetId: TARGET_ID,
    productRunnerSha256,
    embeddingShape: [1, 512],
    accelerator: targetRun.result.summary.accelerator,
    finitePreview: finite,
    cpuDurationMs: cpu.execution.durationMs,
    acceleratorDurationMs: accelerated?.execution.durationMs ?? null,
    comparison,
    provenance: {
      recipeId: RECIPE.recipeId,
      recipeVersion: RECIPE.recipeVersion,
      pythonVersion: RECIPE.pythonVersion,
      uvVersion: RECIPE.uvVersion,
      dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
    },
    evidence: {
      fixture: {
        id: 'scgpt-pinned-1-cell-128-gene-v1',
        sha256: fixtureSha256,
        inputShapes: { counts: [fixture.cells, fixture.genes] },
      },
      framework: {
        ...framework,
        backend: String(targetRun.result.summary.accelerator),
      },
      accelerator: {
        kind: RECIPE.target.accelerator,
        gpuModel: null,
        driverVersion: null,
        reportedCudaCompatibility: framework.reportedCudaCompatibility,
      },
      outputShapes: { embeddings: [1, 512] },
      finiteValues: finite,
      tolerances: accelerated ? {
        absolute: ABSOLUTE_TOLERANCE,
        relative: RELATIVE_TOLERANCE,
        minimumCosineSimilarity: MINIMUM_COSINE_SIMILARITY,
      } : {},
      parity: {
        reference: 'pinned-cpu-product-runner',
        passed: comparison?.allClose ?? true,
        cpuBaselinePassed: true,
        acceleratorPassed: accelerated ? comparison?.allClose === true : null,
        maximumAbsoluteDifference: comparison?.maximumAbsoluteDifference ?? null,
        meanAbsoluteDifference: comparison?.meanAbsoluteDifference ?? null,
        minimumCosineSimilarity: comparison?.minimumCosineSimilarity ?? null,
      },
      peakRamBytes: null,
      peakVramBytes: targetRun.result.summary.peakVramBytes ?? null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
  }, null, 2));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
