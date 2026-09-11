#!/usr/bin/env node

/** Validates known-peptide ranking and CPU/accelerator parity through the shipped MHCflurry runner. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { builderVersionFields } from 'scrollcase/build';
import {
  loadRuntimeBoxValidatorContext,
  productAcceleratorForTarget,
  runtimeBoxAcceleratorKind,
} from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_ID = 'openvax-mhcflurry-class1-presentation';
const SOURCE_REVISION = 'v2.2.1';
const ABSOLUTE_TOLERANCE = 0.001;
const RELATIVE_TOLERANCE = 0.001;
const {
  recipe: RECIPE,
  authoringId: AUTHORING_ID,
  authoringVersion: AUTHORING_VERSION,
  targetId: TARGET_ID,
  runtimeDir: RUNTIME_DIR,
  python: PYTHON,
  dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'mhcflurry-class1-presentation-macos-aarch64-metal',
  runtimeDirectoryEnvironment: 'LIATIR_MHCFLURRY_RUNTIME_DIR',
});
if (RECIPE.labels.model !== MODEL_ID || RECIPE.sourceRevision !== SOURCE_REVISION) {
  throw new Error('MHCflurry validation provenance differs from the pinned contract.');
}

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
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), durationMs: Date.now() - startedAt };
}

function extractEmbeddedScript(source) {
  const prefix = 'export const MHCFLURRY_EPITOPE_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product MHCflurry runner.');
  return source.slice(start + prefix.length, end);
}

function parseLastJson(stdout) {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]); } catch { /* continue */ }
  }
  throw new Error('MHCflurry runner did not emit its structured result.');
}

function comparisonKey(row) {
  return [row.allele, row.peptide, row.source_name, row.position].join('|');
}

function comparePredictions(reference, candidate) {
  if (reference.length !== candidate.length) throw new Error('MHCflurry parity row counts differ.');
  const byKey = new Map(candidate.map((row) => [comparisonKey(row), row]));
  let maximumAbsoluteDifference = 0;
  let comparedValues = 0;
  for (const expected of reference) {
    const actual = byKey.get(comparisonKey(expected));
    if (!actual) throw new Error(`MHCflurry parity row is missing: ${comparisonKey(expected)}`);
    for (const column of ['affinity', 'affinity_percentile', 'processing_score', 'presentation_score']) {
      if (!(column in expected) || expected[column] === null) continue;
      const left = Number(expected[column]);
      const right = Number(actual[column]);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        throw new Error(`MHCflurry returned a non-finite ${column}.`);
      }
      const difference = Math.abs(left - right);
      maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, difference);
      comparedValues += 1;
      if (difference > ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(left)) {
        throw new Error(`MHCflurry ${column} exceeds the declared parity tolerance.`);
      }
    }
  }
  const referenceOrder = reference.map(comparisonKey);
  const candidateOrder = candidate.map(comparisonKey);
  if (JSON.stringify(referenceOrder) !== JSON.stringify(candidateOrder)) {
    throw new Error('MHCflurry ranking changed across parity runs.');
  }
  return { allClose: true, rankingStable: true, maximumAbsoluteDifference, comparedValues };
}

const workDir = await mkdtemp(join(tmpdir(), 'liatir-mhcflurry-validation-'));
try {
  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/mhcflurry-epitope.ts'),
    'utf8',
  );
  const productRunner = extractEmbeddedScript(productSource);
  const productRunnerSha256 = createHash('sha256').update(productRunner).digest('hex');
  const productScript = join(workDir, 'liatir-mhcflurry.py');
  const fixturePath = join(workDir, 'known-peptides.csv');
  await writeFile(productScript, productRunner);
  await writeFile(fixturePath, [
    'name,peptide',
    'cmv,NLVPMVATV',
    'influenza,GILGFVFTL',
    'model_control,SIINFEKL',
    'weak_control,AAAAAAAAA',
  ].join('\n') + '\n');

  const runProduct = (label, mode, accelerator) => {
    const execution = run(PYTHON, [productScript], {
      input: JSON.stringify({
        runtimePath: RUNTIME_DIR,
        modelCacheDir: join(RUNTIME_DIR, 'model-cache/mhcflurry-class1-presentation'),
        inputFile: fixturePath,
        inputKind: 'peptide-table',
        outputDir: join(workDir, `output-${label}-${mode}`),
        alleles: ['HLA-A*02:01'],
        peptideLengths: [8, 9],
        mode,
        accelerator,
        topCount: 4,
      }),
    });
    const result = parseLastJson(execution.stdout);
    const actualAccelerator = runtimeBoxAcceleratorKind(result.summary.accelerator);
    const expectedAccelerator = accelerator === 'mps' ? 'metal' : accelerator;
    if (actualAccelerator !== expectedAccelerator) {
      throw new Error(`MHCflurry requested ${accelerator}, but used ${result.summary.accelerator}.`);
    }
    if (result.summary.mhcflurryVersion !== '2.2.1' || result.summary.predictionCount !== 4) {
      throw new Error('MHCflurry returned the wrong version or prediction count.');
    }
    return { result, execution };
  };

  const cpuBinding = runProduct('cpu-1', 'binding', 'cpu');
  const cpuBindingRepeat = runProduct('cpu-2', 'binding', 'cpu');
  const cpuPresentation = runProduct('cpu-1', 'presentation', 'cpu');
  const cpuPresentationRepeat = runProduct('cpu-2', 'presentation', 'cpu');
  const bindingStability = comparePredictions(cpuBinding.result.preview, cpuBindingRepeat.result.preview);
  const presentationStability = comparePredictions(cpuPresentation.result.preview, cpuPresentationRepeat.result.preview);

  const targetAccelerator = productAcceleratorForTarget(RECIPE.target);
  let acceleratorBinding = null;
  let acceleratorPresentation = null;
  let bindingParity = bindingStability;
  let presentationParity = presentationStability;
  if (targetAccelerator !== 'cpu') {
    acceleratorBinding = runProduct('accelerator', 'binding', targetAccelerator);
    acceleratorPresentation = runProduct('accelerator', 'presentation', targetAccelerator);
    bindingParity = comparePredictions(cpuBinding.result.preview, acceleratorBinding.result.preview);
    presentationParity = comparePredictions(cpuPresentation.result.preview, acceleratorPresentation.result.preview);
  }

  const bindingOrder = cpuBinding.result.preview.map((row) => row.peptide);
  const weakControlIndex = bindingOrder.indexOf('AAAAAAAAA');
  const knownBinderIndexes = ['NLVPMVATV', 'GILGFVFTL'].map((peptide) => bindingOrder.indexOf(peptide));
  if (
    weakControlIndex < 0
    || knownBinderIndexes.some((index) => index < 0)
    || weakControlIndex < Math.max(...knownBinderIndexes)
  ) {
    throw new Error('Known HLA-A*02:01 binders ranked below the weak control.');
  }
  const framework = JSON.parse(run(PYTHON, ['-c', [
    'import json, torch',
    'print(json.dumps({"name":"torch","version":torch.__version__,"reportedCudaCompatibility":torch.version.cuda}))',
  ].join(';')]).stdout);

  console.log(JSON.stringify({
    status: 'passed',
    modelId: MODEL_ID,
    sourceRevision: SOURCE_REVISION,
    targetId: TARGET_ID,
    productRunnerSha256,
    predictionShape: [4, 1],
    accelerator: (acceleratorBinding ?? cpuBinding).result.summary.accelerator,
    cpuDurationMs: cpuBinding.execution.durationMs + cpuPresentation.execution.durationMs,
    acceleratorDurationMs: acceleratorBinding
      ? acceleratorBinding.execution.durationMs + acceleratorPresentation.execution.durationMs
      : null,
    comparison: { binding: bindingParity, presentation: presentationParity },
    provenance: {
      recipeId: AUTHORING_ID,
      recipeVersion: AUTHORING_VERSION,
      pythonVersion: RECIPE.runtime.version,
      ...builderVersionFields(RECIPE),
      dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
    },
    evidence: {
      fixture: {
        id: 'mhcflurry-known-hla-a02-peptides-v1',
        sha256: createHash('sha256').update(await readFile(fixturePath)).digest('hex'),
        inputShapes: { peptides: [4], alleles: [1] },
      },
      framework,
      accelerator: {
        kind: RECIPE.target.accelerator,
        gpuModel: null,
        gpuMemoryBytes: null,
        computeCapability: null,
        driverVersion: null,
        reportedCudaCompatibility: framework.reportedCudaCompatibility,
      },
      outputShapes: { bindingPredictions: [4], presentationPredictions: [4] },
      finiteValues: true,
      tolerances: { absolute: ABSOLUTE_TOLERANCE, relative: RELATIVE_TOLERANCE },
      parity: {
        reference: 'pinned-cpu-product-runner',
        passed: bindingParity.allClose && presentationParity.allClose,
        cpuBaselinePassed: bindingStability.rankingStable && presentationStability.rankingStable,
        acceleratorPassed: targetAccelerator === 'cpu' ? null : true,
        maximumAbsoluteDifference: Math.max(
          bindingParity.maximumAbsoluteDifference,
          presentationParity.maximumAbsoluteDifference,
        ),
        meanAbsoluteDifference: null,
        minimumCosineSimilarity: null,
      },
      peakRamBytes: null,
      peakVramBytes: null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
  }, null, 2));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
