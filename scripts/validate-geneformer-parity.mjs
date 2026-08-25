#!/usr/bin/env node

/**
 * Scientific-correctness check for the Geneformer runner.
 *
 * Liatir ships its own Python script to tokenise and embed single-cell data with Geneformer. A
 * subtle divergence from the upstream tokenizer would not crash anything — it would quietly
 * produce embeddings that are *wrong*, which for a scientific tool is the worst possible failure
 * mode. So this runs the shipped script and the upstream tokenizer side by side and compares them.
 *
 * Two details make the comparison meaningful rather than decorative:
 *   - the script under test is extracted from the real product source, not a copy kept in sync
 *     by hand, so what is validated is exactly what users run;
 *   - it executes inside the built Runtime Box's own interpreter, so the library versions are the
 *     ones the user will actually have.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveWorkspace } from 'scrollcase/build';
import { boxTargetId } from 'scrollcase/contract/browser';
import { downloadVerified } from './runtime-box/assets.mjs';
import { resolveRuntimeBoxAuthoringInput } from './runtime-box/authoring-input.mjs';

const ROOT = resolve(import.meta.dirname, '..');
/** Pinned upstream commit: parity must be checked against a fixed reference, not a moving branch. */
const REVISION = '04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5';
/** Exact upstream tokenizer used as the scientific reference for the pinned revision. */
const UPSTREAM_TOKENIZER = Object.freeze({
  label: 'Geneformer tokenizer',
  destinationSegments: Object.freeze(['geneformer', 'tokenizer.py']),
  url: `https://huggingface.co/ctheodoris/Geneformer/resolve/${REVISION}/geneformer/tokenizer.py`,
  sizeBytes: 34_686,
  sha256: '689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002',
});
/** Requires the box to have been built first; CI supplies the catalog-resolved recipe ID. */
const RECIPE_ID = process.env.LIATIR_RUNTIME_BOX_RECIPE_ID
  ?? 'geneformer-v1-10m-macos-arm64-metal';
const WORKSPACE = resolveWorkspace({ cwd: ROOT });
const RECIPE = resolveRuntimeBoxAuthoringInput({
  recipeId: RECIPE_ID,
  scrollsDir: WORKSPACE.scrollsDir,
}).document;
if (RECIPE.sourceRevision !== REVISION) {
  throw new Error(`Geneformer tokenizer reference is not pinned for source revision ${RECIPE.sourceRevision}.`);
}
const TARGET_ID = boxTargetId(RECIPE.target);
if (
  process.env.LIATIR_RUNTIME_BOX_TARGET_ID
  && process.env.LIATIR_RUNTIME_BOX_TARGET_ID !== TARGET_ID
) {
  throw new Error(
    `Requested target ${process.env.LIATIR_RUNTIME_BOX_TARGET_ID} does not match recipe ${TARGET_ID}.`,
  );
}
const RUNTIME_DIR = resolve(
  process.env.LIATIR_GENEFORMER_RUNTIME_DIR
    ?? join(WORKSPACE.buildDir, RECIPE_ID, 'payload'),
);

/**
 * Resolves the GPU capability floors from the catalog runner profile so the validator and the CI
 * host probe enforce the same contract. Returns null for non-GPU targets.
 */
async function gpuFloorsForRecipe() {
  if (RECIPE.target.accelerator !== 'cuda') return null;
  const catalog = JSON.parse(await readFile(join(ROOT, 'runtime-boxes', 'catalog.json'), 'utf8'));
  for (const model of catalog.components) {
    for (const target of model.targets) {
      if (target.recipeId !== RECIPE_ID) continue;
      const runner = catalog.runnerProfiles.find((candidate) => candidate.id === target.runnerProfileId);
      if (!runner?.gpu) break;
      return {
        minimumComputeCapability: runner.minimumComputeCapability,
        minimumGpuMemoryBytes: runner.minimumGpuMemoryBytes,
      };
    }
  }
  throw new Error(`No GPU runner profile found in the catalog for recipe ${RECIPE_ID}.`);
}
const GPU_FLOORS = await gpuFloorsForRecipe();

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

/**
 * Pulls the Python source out of the TypeScript file that ships it.
 *
 * The runner lives in the product as a `String.raw` template literal, so it can be sent to the
 * Python runtime at execution time. Extracting it here — rather than keeping a duplicate copy of
 * the script for testing — means the validated code and the shipped code cannot drift apart.
 */
function extractEmbeddedScript(source) {
  const prefix = 'export const GENEFORMER_EMBEDDING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product Geneformer runner.');
  return source.slice(start + prefix.length, end);
}

const workDir = await mkdtemp(join(tmpdir(), 'liatir-geneformer-parity-'));
try {
  const runtimeDir = RUNTIME_DIR;
  const upstreamTokenizer = join(workDir, ...UPSTREAM_TOKENIZER.destinationSegments);
  // Fetch the one immutable source file directly. A partial Git clone relies on platform-specific
  // demand fetching for the missing blob; the shared downloader instead enforces both bytes and
  // SHA-256 before the scientific harness can import the reference.
  await downloadVerified(UPSTREAM_TOKENIZER, upstreamTokenizer);

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/geneformer-embedding.ts'),
    'utf8',
  );
  const productScript = join(workDir, 'liatir-geneformer.py');
  await writeFile(productScript, extractEmbeddedScript(productSource));
  // Run with the box's own interpreter, so the comparison happens under the exact library versions
  // a user gets. The Python harness does the actual numeric comparison and fails on divergence.
  const output = run(
    join(runtimeDir, ...RECIPE.pythonEntryPoint.split('/')),
    [
      join(ROOT, 'scripts/ai-validation/geneformer-parity.py'),
      '--runtime-dir', runtimeDir,
      '--product-script', productScript,
      '--upstream-tokenizer', upstreamTokenizer,
      '--work-dir', join(workDir, 'validation'),
      '--target-id', TARGET_ID,
      '--accelerator', RECIPE.target.accelerator,
      ...(RECIPE.target.accelerator === 'cuda' ? [
        '--cuda-version', RECIPE.target.cudaVersion,
        '--min-nvidia-driver', RECIPE.compatibility.minNvidiaDriverVersion,
        '--min-compute-capability', GPU_FLOORS.minimumComputeCapability,
        '--min-gpu-memory-bytes', String(GPU_FLOORS.minimumGpuMemoryBytes),
      ] : []),
    ],
    { capture: true },
  );
  console.log(output);
} finally {
  // Always remove the extracted product script, pinned reference, and generated validation data.
  await rm(workDir, { recursive: true, force: true });
}
