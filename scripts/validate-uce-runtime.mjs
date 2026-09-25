#!/usr/bin/env node

/**
 * Focused scientific validation for the UCE 4-layer Runtime Box.
 *
 * This runs the exact Python wrapper shipped by the product, first on CPU and then on Apple Metal,
 * against one deterministic human AnnData fixture. The CPU result is the pinned upstream UCE
 * algorithm reference because the product wrapper delegates embedding to that exact packaged
 * source revision. Metal output must remain numerically close to the CPU reference.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  loadRuntimeBoxValidatorContext,
  productAcceleratorForTarget,
} from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const REVISION = '8ead6e07af0c80f75653598138bb704e865b45c8';
const MODEL_ID = 'snap-stanford-uce-4layer';
const {
  recipe: RECIPE,
  targetId: TARGET_ID,
  runtimeDir: RUNTIME_DIR,
  python: PYTHON,
  dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'uce-4layer-macos-arm64-metal',
  runtimeDirectoryEnvironment: 'LIATIR_UCE_RUNTIME_DIR',
});
const TARGET_ACCELERATOR = productAcceleratorForTarget(RECIPE.target);
const PRODUCT_SOURCE = join(
  ROOT,
  'frontend/src/lib/tools/ai/python-scripts/uce-embedding.ts',
);
const EXPECTED_INPUT_WARNING =
  'UCE expects .X to contain scRNA-seq counts and var_names to contain gene symbols, not Ensembl IDs.';
const ABSOLUTE_TOLERANCE = 0.02;
const RELATIVE_TOLERANCE = 0.02;
const MINIMUM_COSINE_SIMILARITY = 0.999;

const FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import sys

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch

payload = json.loads(sys.stdin.read())
runtime = Path(payload["runtimeDir"])
model_files = runtime / "model-cache/uce/model_files"
protein_file = model_files / "protein_embeddings/Homo_sapiens.GRCh38.gene_symbol_to_embedding_ESM2.pt"
chromosome_file = model_files / "species_chrom.csv"

protein_genes = {str(gene).upper() for gene in torch.load(protein_file, map_location="cpu")}
chromosomes = pd.read_csv(chromosome_file)
human_chromosome_genes = {
    str(gene).upper()
    for gene in chromosomes.loc[chromosomes["species"] == "human", "gene_symbol"]
}
genes = sorted(protein_genes & human_chromosome_genes)[:32]
if len(genes) != 32:
    raise SystemExit(f"UCE fixture requires 32 verified human genes, found {len(genes)}.")

counts = np.asarray([
    [((cell_index + 3) * (gene_index + 5) % 29) + 1 for gene_index in range(len(genes))]
    for cell_index in range(10)
], dtype=np.int32)
obs = pd.DataFrame(index=[f"cell-{index + 1}" for index in range(10)])
var = pd.DataFrame(index=genes)
fixture_path = Path(payload["fixturePath"])
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture_path)
print(json.dumps({
    "inputFile": str(fixture_path),
    "cells": int(counts.shape[0]),
    "genes": int(counts.shape[1]),
    "geneSymbols": genes,
}))
`;

const OUTPUT_VALIDATION_SCRIPT = String.raw`
import csv
import json
from pathlib import Path
import sys

import anndata
import numpy as np

payload = json.loads(sys.stdin.read())

def validate_run(label, result, expected_accelerator):
    summary = result["summary"]
    if summary["cellCount"] != 10 or summary["inputCellCount"] != 10:
        raise SystemExit(f"{label}: unexpected cell count")
    if summary["geneCount"] != 32 or summary["inputGeneCount"] != 32:
        raise SystemExit(f"{label}: unexpected gene count")
    if summary["embeddingDim"] != 1280 or summary["embeddingKey"] != "X_uce":
        raise SystemExit(f"{label}: unexpected embedding contract")
    if summary["species"] != "human" or summary["batchSize"] != 1:
        raise SystemExit(f"{label}: unexpected scientific parameters")
    if summary["randomSeed"] != 23:
        raise SystemExit(f"{label}: missing deterministic seed")
    if not str(summary["accelerator"]).startswith(expected_accelerator):
        raise SystemExit(
            f"{label}: requested {expected_accelerator}, got {summary['accelerator']}"
        )
    if payload["expectedWarning"] not in summary["warnings"]:
        raise SystemExit(f"{label}: expected input warning is missing")

    embedded_path = Path(result["embeddedAnnDataPath"])
    preview_path = Path(result["embeddingPreviewPath"])
    summary_path = Path(result["summaryPath"])
    if embedded_path == Path(payload["inputFile"]):
        raise SystemExit(f"{label}: output replaced the raw input")
    for path in (embedded_path, preview_path, summary_path):
        if not path.is_file():
            raise SystemExit(f"{label}: missing output {path.name}")

    persisted_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if persisted_summary != summary:
        raise SystemExit(f"{label}: persisted summary differs from stdout")

    # The product runner writes two viewer projection columns before the embedding, so the
    # header is checked by name rather than counted.
    with preview_path.open("r", encoding="utf-8", newline="") as source:
        rows = list(csv.reader(source))
    expected_header = ["cell_id", "preview_pc_1", "preview_pc_2"] + [f"dim_{i}" for i in range(1280)]
    if len(rows) != 11 or rows[0] != expected_header:
        raise SystemExit(f"{label}: CSV preview has the wrong shape")
    if any(len(row) != len(expected_header) for row in rows[1:]):
        raise SystemExit(f"{label}: a CSV preview row does not match its header")

    expected_intermediates = {
        "uce-validation-input_proc.h5ad",
        "uce-validation-input_chroms.pkl",
        "uce-validation-input_counts.npz",
        "uce-validation-input_pe_idx.torch",
        "uce-validation-input_shapes_dict.pkl",
        "uce-validation-input_starts.pkl",
    }
    intermediates = {Path(path).name for path in result["intermediatePaths"]}
    if intermediates != expected_intermediates:
        raise SystemExit(f"{label}: intermediate artifact set differs: {sorted(intermediates)}")
    if any(not Path(path).is_file() for path in result["intermediatePaths"]):
        raise SystemExit(f"{label}: an intermediate artifact is missing")

    embedded = anndata.read_h5ad(embedded_path)
    if "X_uce" not in embedded.obsm:
        raise SystemExit(f"{label}: X_uce is missing")
    values = np.asarray(embedded.obsm["X_uce"], dtype=np.float64)
    if values.shape != (10, 1280) or not np.isfinite(values).all():
        raise SystemExit(f"{label}: embeddings are non-finite or have the wrong shape")
    return values

runs = payload["runs"]
cpu = validate_run("cpu", runs[0], "cpu")
comparison = None
if len(runs) == 2:
    accelerated = validate_run("accelerator", runs[1], payload["expectedAccelerator"])
    absolute = np.abs(cpu - accelerated)
    denominator = np.linalg.norm(cpu, axis=1) * np.linalg.norm(accelerated, axis=1)
    cosine = np.sum(cpu * accelerated, axis=1) / np.maximum(denominator, 1e-12)
    close = np.allclose(
        cpu,
        accelerated,
        atol=float(payload["absoluteTolerance"]),
        rtol=float(payload["relativeTolerance"]),
    )
    comparison = {
        "allClose": bool(close),
        "maximumAbsoluteDifference": float(absolute.max()),
        "meanAbsoluteDifference": float(absolute.mean()),
        "minimumCosineSimilarity": float(cosine.min()),
    }
    if not close or comparison["minimumCosineSimilarity"] < float(payload["minimumCosine"]):
        print(json.dumps(comparison), file=sys.stderr)
        raise SystemExit("Accelerator output exceeds the explicit CPU-reference tolerance")

print(json.dumps({
    "status": "passed",
    "embeddingShape": list(cpu.shape),
    "finite": bool(np.isfinite(cpu).all()),
    "comparison": comparison,
}))
`;

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 4 * 60 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${result.status}\n${result.stderr || result.stdout}`,
    );
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    durationMs: Date.now() - startedAt,
  };
}

/** Runs one portable inference and records duration; host-specific memory telemetry stays optional. */
function runTimedPython(python, script, input, accelerator) {
  const result = run(python, [script], {
    input,
    env: {
      ACCELERATE_USE_CPU: accelerator === 'cpu' ? 'true' : 'false',
      ...(accelerator === 'mps' ? { PYTORCH_ENABLE_MPS_FALLBACK: '0' } : {}),
    },
  });
  return {
    ...result,
    maximumResidentSetBytes: null,
    peakMemoryFootprintBytes: null,
  };
}

function extractEmbeddedScript(source) {
  const prefix = 'export const UCE_EMBEDDING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product UCE runner.');
  return source.slice(start + prefix.length, end);
}

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
  throw new Error('UCE runner did not emit a final JSON result.');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', resolveHash);
  });
  return hash.digest('hex');
}

await access(PYTHON);
await access(join(RUNTIME_DIR, 'source/UCE/eval_single_anndata.py'));
await access(join(RUNTIME_DIR, 'model-cache/uce/model_files/4layer_model.torch'));
await access(join(RUNTIME_DIR, 'model-cache/uce/model_files/protein_embeddings'));

if (RECIPE.labels.model !== MODEL_ID || RECIPE.sourceRevision !== REVISION) {
  throw new Error('UCE validation recipe provenance differs from the pinned model contract.');
}

const productSource = await readFile(PRODUCT_SOURCE, 'utf8');
const productRunner = extractEmbeddedScript(productSource);
const productRunnerSha256 = createHash('sha256').update(productRunner).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-uce-validation-'));
const keepWorkDir = process.env.LIATIR_KEEP_UCE_VALIDATION === '1';

try {
  const python = PYTHON;
  const productScript = join(workDir, 'liatir-uce.py');
  const fixtureScript = join(workDir, 'fixture.py');
  const outputValidationScript = join(workDir, 'validate-output.py');
  const inputFile = join(workDir, 'uce-validation-input.h5ad');
  await writeFile(productScript, productRunner);
  await writeFile(fixtureScript, FIXTURE_SCRIPT);
  await writeFile(outputValidationScript, OUTPUT_VALIDATION_SCRIPT);

  const framework = JSON.parse(run(python, ['-c', [
    'import json, torch',
    'print(json.dumps({"mpsBuilt": hasattr(torch.backends, "mps") and torch.backends.mps.is_built(), "mpsAvailable": hasattr(torch.backends, "mps") and torch.backends.mps.is_available(), "cudaAvailable": torch.cuda.is_available(), "torchVersion": torch.__version__, "reportedCudaCompatibility": torch.version.cuda}))',
  ].join(';')]).stdout);
  if (TARGET_ACCELERATOR === 'mps' && (!framework.mpsBuilt || !framework.mpsAvailable)) {
    throw new Error('UCE Apple Metal validation requires packaged Torch with available MPS.');
  }
  if (TARGET_ACCELERATOR === 'cuda' && !framework.cudaAvailable) {
    throw new Error('UCE CUDA validation requires packaged Torch with available CUDA.');
  }

  const fixture = JSON.parse(run(python, [fixtureScript], {
    input: JSON.stringify({ runtimeDir: RUNTIME_DIR, fixturePath: inputFile }),
  }).stdout);
  const inputSha256Before = await sha256File(inputFile);

  const runProduct = (accelerator) => {
    const outputDir = join(workDir, `output-${accelerator}`);
    const timed = runTimedPython(
      python,
      productScript,
      JSON.stringify({
        runtimePath: RUNTIME_DIR,
        modelCacheDir: join(RUNTIME_DIR, 'model-cache/uce'),
        inputFile,
        outputDir,
        species: 'human',
        batchSize: 1,
        maxCsvRows: 10,
        randomSeed: 23,
        accelerator,
      }),
      accelerator,
    );
    return { result: parseLastJson(timed.stdout), timing: timed };
  };

  // CPU must pass the complete scientific/output contract before Metal is allowed to run.
  const cpu = runProduct('cpu');
  run(python, [outputValidationScript], {
    input: JSON.stringify({
      runs: [cpu.result],
      inputFile,
      expectedWarning: EXPECTED_INPUT_WARNING,
      absoluteTolerance: ABSOLUTE_TOLERANCE,
      relativeTolerance: RELATIVE_TOLERANCE,
      minimumCosine: MINIMUM_COSINE_SIMILARITY,
      expectedAccelerator: 'cpu',
    }),
  });

  const accelerated = TARGET_ACCELERATOR === 'cpu' ? null : runProduct(TARGET_ACCELERATOR);
  const scientific = JSON.parse(run(python, [outputValidationScript], {
    input: JSON.stringify({
      runs: [cpu.result, ...(accelerated ? [accelerated.result] : [])],
      inputFile,
      expectedWarning: EXPECTED_INPUT_WARNING,
      absoluteTolerance: ABSOLUTE_TOLERANCE,
      relativeTolerance: RELATIVE_TOLERANCE,
      minimumCosine: MINIMUM_COSINE_SIMILARITY,
      expectedAccelerator: TARGET_ACCELERATOR,
    }),
  }).stdout);
  const inputSha256After = await sha256File(inputFile);
  if (inputSha256After !== inputSha256Before) {
    throw new Error('UCE product runner mutated the raw AnnData fixture.');
  }

  console.log(JSON.stringify({
    status: 'passed',
    modelId: MODEL_ID,
    sourceRevision: REVISION,
    targetId: TARGET_ID,
    productRunnerSha256,
    fixture: {
      cells: fixture.cells,
      genes: fixture.genes,
      sha256: inputSha256Before,
      rawInputPreserved: true,
    },
    output: scientific,
    tolerance: {
      absolute: ABSOLUTE_TOLERANCE,
      relative: RELATIVE_TOLERANCE,
      minimumCosineSimilarity: MINIMUM_COSINE_SIMILARITY,
    },
    cpu: {
      accelerator: cpu.result.summary.accelerator,
      durationMs: cpu.timing.durationMs,
      maximumResidentSetBytes: cpu.timing.maximumResidentSetBytes,
      peakMemoryFootprintBytes: cpu.timing.peakMemoryFootprintBytes,
    },
    accelerator: accelerated ? {
      accelerator: accelerated.result.summary.accelerator,
      durationMs: accelerated.timing.durationMs,
      maximumResidentSetBytes: accelerated.timing.maximumResidentSetBytes,
      peakMemoryFootprintBytes: accelerated.timing.peakMemoryFootprintBytes,
    } : null,
    provenance: {
      runtimeDir: RUNTIME_DIR,
      recipeId: RECIPE.recipeId,
      recipeVersion: RECIPE.recipeVersion,
      pythonVersion: RECIPE.runtime.version,
      pixiVersion: RECIPE.pixiVersion,
      dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
    },
    evidence: {
      fixture: {
        id: 'uce-pinned-human-10-cell-32-gene-v1',
        sha256: inputSha256Before,
        inputShapes: { counts: [fixture.cells, fixture.genes] },
      },
      framework: {
        name: 'torch',
        version: framework.torchVersion,
        backend: accelerated ? `cpu-reference-and-${RECIPE.target.accelerator}` : 'cpu',
        reportedCudaCompatibility: framework.reportedCudaCompatibility,
      },
      accelerator: {
        kind: RECIPE.target.accelerator,
        gpuModel: null,
        driverVersion: null,
        reportedCudaCompatibility: framework.reportedCudaCompatibility,
      },
      outputShapes: { embeddings: scientific.embeddingShape },
      finiteValues: scientific.finite,
      tolerances: {
        absolute: ABSOLUTE_TOLERANCE,
        relative: RELATIVE_TOLERANCE,
        minimumCosineSimilarity: MINIMUM_COSINE_SIMILARITY,
      },
      parity: {
        reference: 'pinned-cpu-product-runner',
        passed: scientific.comparison?.allClose ?? true,
        cpuBaselinePassed: true,
        acceleratorPassed: accelerated ? scientific.comparison?.allClose === true : null,
        maximumAbsoluteDifference: scientific.comparison?.maximumAbsoluteDifference ?? null,
        meanAbsoluteDifference: scientific.comparison?.meanAbsoluteDifference ?? null,
        minimumCosineSimilarity: scientific.comparison?.minimumCosineSimilarity ?? null,
      },
      peakRamBytes: Math.max(
        cpu.timing.maximumResidentSetBytes ?? 0,
        accelerated?.timing.maximumResidentSetBytes ?? 0,
        cpu.timing.peakMemoryFootprintBytes ?? 0,
        accelerated?.timing.peakMemoryFootprintBytes ?? 0,
      ) || null,
      peakVramBytes: accelerated?.result.summary.peakVramBytes ?? null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
  }, null, 2));
} finally {
  if (keepWorkDir) {
    console.error(`Preserved UCE validation workspace: ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true });
  }
}
