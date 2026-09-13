#!/usr/bin/env node

/**
 * Exercises the exact offline Protenix product runner against a real experimental structure.
 *
 * Deliberately the same reference as the Boltz-2 validator — ubiquitin, PDB entry 1UBQ at 1.8 A —
 * so the two numbers are directly comparable. A second structure model earns its place by being an
 * independent check on the first, and that is worth nothing if each is measured against something
 * else. Every prediction here runs without an alignment, because an offline box has no alignment
 * server; that is the accuracy this product can promise, so it is the accuracy that gets measured.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { builderVersionFields } from 'scrollcase/build';
import { verifyExtractedPayload } from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
import { loadRuntimeBoxValidatorContext, productAcceleratorForTarget } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const COMPONENT_ID = 'bytedance-protenix-base-v1-0-0';
const SOURCE_REVISION = '2475421477ab414b571149ad4a875c390ff8a35d+weights-protenix_base_default_v1.0.0';
const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';
const REFERENCE_PDB = join(ROOT, 'runtime-boxes/fixtures/structures/1ubq.pdb');
const REFERENCE_SHA256 = 'd4a6812d8951cf6594e6a0763f089e35f5a80b62acb3c117b2c5565228a7b161';

// The same bound the Boltz-2 validator holds to, for the same reason: loose enough to survive a
// driver or seed difference, tight enough that a wrong fold fails, since a mispredicted 76-residue
// protein lands well above 5 A. Holding both models to one limit is what makes the pair a check.
const MAXIMUM_BACKBONE_RMSD_ANGSTROM = 3;

// Protenix reports pLDDT on 0-100 and the product runner divides it down, so this is a fraction as
// it is for Boltz-2. The bound is not decoration: measured on this box, a run that found the fold
// scored 0.93 and a run that missed it scored 0.71, so 0.7 would have waved the wrong fold through.
const MINIMUM_PLDDT = 0.85;

// Two runs at one seed must produce the same structure, not merely two structures that happen to
// sit equally far from the reference. With upstream's determinism switch on this is exactly zero;
// the allowance is for the last digit of the coordinates as written to the file.
const MAXIMUM_DETERMINISM_RMSD_ANGSTROM = 0.01;

// What the product itself sends when the caller asks for nothing in particular. Measuring anything
// else measures a configuration no user will run. Several seeds rather than one is the whole reason
// this box is usable without an alignment: a single seed found ubiquitin's fold in five of eleven
// tries, and the seeds that missed it missed it at every sample and at double the recycling.
const PRODUCT_DEFAULTS = { seedCount: 5, sampleCount: 5, recyclingSteps: 10, diffusionSteps: 200 };

const {
  recipe, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'protenix-base-v1-0-0-linux-x86_64-cuda12.6',
  runtimeDirectoryEnvironment: 'LIATIR_PROTENIX_RUNTIME_DIR',
});
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-protenix-validation-'));
const measurementPath = join(ROOT, 'scripts/runtime-box/measure-python.py');

function pathOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a file path`);
  return resolve(value);
}
const outputPath = pathOption('--output');
const releasePath = pathOption('--release-document');
const publicPath = pathOption('--public-key');
assert.equal(
  Boolean(releasePath), Boolean(publicPath),
  '--release-document and --public-key are required together',
);

/** Runs one measured child under the box's own interpreter and keeps what evidence needs. */
function execute(script, payload, { accelerator = recipe.target.accelerator, timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, [measurementPath, '--accelerator', accelerator, script], {
      cwd: workDir,
      env: { ...process.env, MPLCONFIGDIR: join(workDir, '.matplotlib') },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const marker = stderr.split(/\r?\n/u)
        .findLast((line) => line.startsWith('LIATIR_SCIENTIFIC_MEASUREMENT '));
      const measurement = marker
        ? JSON.parse(marker.slice('LIATIR_SCIENTIFIC_MEASUREMENT '.length))
        : null;
      resolveResult({ code, signal, stdout, stderr, measurement });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseResult(execution, label) {
  assert.equal(
    execution.code, 0,
    `${label} failed (${execution.signal ?? execution.code}):\n${execution.stderr}`,
  );
  const line = execution.stdout.split(/\r?\n/u).findLast((value) => value.startsWith('{'));
  assert.ok(line, `${label} emitted no structured result:\n${execution.stderr}`);
  return JSON.parse(line);
}

/**
 * Superimposes the predicted backbone onto the experimental one and reports the RMSD.
 *
 * Kabsch on CA atoms, in the box's own interpreter with its own NumPy, so the comparison uses the
 * same numerics as the prediction rather than a second stack that might disagree.
 */
const COMPARE_SCRIPT = String.raw`
import json
import sys

import gemmi
import numpy as np

payload = json.loads(sys.stdin.read())

def experimental_ca(path):
    structure = gemmi.read_structure(path)
    structure.remove_alternative_conformations()
    structure.remove_hydrogens()
    coordinates = []
    for residue in structure[0][0]:
        atom = residue.find_atom("CA", "*")
        if atom is not None:
            coordinates.append([atom.pos.x, atom.pos.y, atom.pos.z])
    return np.asarray(coordinates, dtype=float)

def predicted_ca(path):
    structure = gemmi.read_structure(path)
    structure.setup_entities()
    coordinates = []
    for residue in structure[0][0]:
        atom = residue.find_atom("CA", "*")
        if atom is not None:
            coordinates.append([atom.pos.x, atom.pos.y, atom.pos.z])
    return np.asarray(coordinates, dtype=float)

reference = experimental_ca(payload["referencePath"])
model = predicted_ca(payload["predictedPath"])
if reference.shape != model.shape:
    raise SystemExit(
        "Predicted backbone has %d CA atoms against the reference's %d."
        % (model.shape[0], reference.shape[0])
    )
if not np.isfinite(model).all():
    raise SystemExit("Predicted coordinates are not all finite.")

# Kabsch: centre both, take the rotation that minimises the squared deviation, apply it.
a = reference - reference.mean(axis=0)
b = model - model.mean(axis=0)
u, _, vt = np.linalg.svd(b.T @ a)
sign = np.sign(np.linalg.det(u @ vt))
correction = np.diag([1.0, 1.0, sign])
rotation = u @ correction @ vt
aligned = b @ rotation
deviations = np.linalg.norm(aligned - a, axis=1)

print(json.dumps({
    "atomCount": int(reference.shape[0]),
    "backboneRmsdAngstrom": float(np.sqrt((deviations ** 2).mean())),
    "maximumDeviationAngstrom": float(deviations.max()),
    "allFinite": True,
}, sort_keys=True))
`;

const samples = [];
const cases = [];

try {
  let runtimeEvidence = { kind: 'development-payload', signedPayloadVerified: false };
  if (releasePath) {
    const signedBytes = await readFile(releasePath);
    const release = await verifySignedDocument(JSON.parse(signedBytes), publicPath);
    assert.equal(release.kind, 'liatir.runtime-box.release');
    assert.equal(release.boxId, recipe.boxId);
    assert.equal(release.labels.model, COMPONENT_ID);
    assert.equal(release.labels.runtime, recipe.labels.runtime);
    assert.equal(release.version, recipe.version);
    assert.deepEqual(release.target, recipe.target);
    assert.equal(release.provenance.dependencyLockSha256, dependencyLockSha256);
    assert.equal(release.provenance.sourceRevision, SOURCE_REVISION);
    await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
    runtimeEvidence = {
      kind: 'signed-payload',
      signedPayloadVerified: true,
      releaseManifestSha256: sha256(signedBytes),
      archiveSha256: release.archive.sha256,
      payloadDigestSha256: release.payloadDigest.sha256,
      provenance: release.provenance,
    };
  }

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/protenix-structure.ts'), 'utf8',
  );
  const prefix = 'export const PROTENIX_STRUCTURE_SCRIPT = String.raw`';
  const start = productSource.indexOf(prefix);
  const end = productSource.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product Protenix script is missing');
  const productRunner = productSource.slice(start + prefix.length, end);
  const productRunnerSha256 = sha256(productRunner);
  const productPath = join(workDir, 'product-protenix.py');
  await writeFile(productPath, productRunner);
  const comparePath = join(workDir, 'compare-backbone.py');
  await writeFile(comparePath, COMPARE_SCRIPT);

  const referenceBytes = await readFile(REFERENCE_PDB);
  assert.equal(
    sha256(referenceBytes), REFERENCE_SHA256,
    'The experimental reference structure is not the reviewed one.',
  );

  const accelerator = productAcceleratorForTarget(recipe.target);
  const base = {
    runtimePath: runtimeDir,
    modelCacheDir: join(runtimeDir, 'model-cache/protenix-base-v1-0-0'),
    runtimeId: recipe.labels.runtime,
    runtimeBoxRelease: recipe.version,
    targetId,
    accelerator,
  };
  const ubiquitinInput = [{
    name: 'ubiquitin',
    sequences: [{ proteinChain: { sequence: UBIQUITIN, count: 1 } }],
  }];

  async function productCase(id, payload, options = {}) {
    const execution = await execute(productPath, {
      ...base, ...payload, outputDir: join(workDir, id), jobName: id,
    }, options);
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.protenix-result');
    assert.equal(result.summary.protenixVersion, '2.0.0');
    assert.equal(result.summary.modelName, 'protenix_base_default_v1.0.0');
    // The two settings that keep this box offline and free of closed-source kernels are
    // reported by the run itself, so a regression that quietly re-enabled either would fail here.
    assert.equal(result.summary.usedMsa, false);
    assert.equal(result.summary.kernels, 'torch');
    assert.equal(result.summary.runtimeBoxRelease, recipe.version);
    assert.equal(result.summary.targetId, targetId);
    assert.equal(result.summary.networkAccess, false);
    // Being handed fewer structures than were asked for would silently weaken every prediction,
    // because the one that is returned is the best-ranked of what was drawn.
    assert.equal(result.summary.sampleCount, payload.sampleCount);
    assert.equal(result.summary.seedCount, payload.seedCount);
    assert.equal(result.summary.structureCount, payload.seedCount * payload.sampleCount);
    assert.ok(
      Number.isInteger(result.summary.selectedSeed),
      `${id} did not say which seed it returned`,
    );
    assert.ok(execution.measurement?.peakRamBytes > 0, `${id} measured no peak memory`);
    if (recipe.target.accelerator === 'cuda') {
      assert.deepEqual(execution.measurement.vramMeasurementErrors, []);
      assert.ok(execution.measurement.peakVramBytes > 0, `${id} measured no CUDA memory`);
      assert.ok(result.summary.gpuModel, `${id} reported no GPU`);
    }
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `${id} produced an empty ${path}`);
      outputBytes += size;
    }
    // The shape the app's hardware estimate reads, derived the way the product derives a request:
    // tokens from the input, diffusion steps, and every structure drawn across all seeds, since the
    // seeds are what the run pays for. Atoms are not a dimension this model's preflight measures, so
    // they hold at 1, as tokens do for OpenMM.
    samples.push({
      fixtureId: id,
      workloadId: 'protenix:structure',
      maxTokenCount: result.summary.tokenEstimate,
      maxAtomCount: 1,
      maxStepCount: result.summary.diffusionSteps,
      maxOutputItemCount: result.summary.structureCount,
      peakRamBytes: execution.measurement.peakRamBytes,
      peakVramBytes: execution.measurement.peakVramBytes,
      elapsedMs: execution.measurement.elapsedMs,
      outputBytes,
    });
    cases.push({ id, measurement: execution.measurement, summary: result.summary, outputBytes });
    console.error(`Protenix ${id}: passed in ${execution.measurement.elapsedMs} ms`);
    return result;
  }

  /** A run that must be refused; a box that quietly carries on here is the real failure. */
  async function refusal(id, payload, expected) {
    const execution = await execute(productPath, {
      ...base, ...payload, outputDir: join(workDir, id), jobName: id,
    }, { timeoutMs: 600_000 });
    assert.notEqual(execution.code, 0, `${id} was accepted and should have been refused`);
    assert.match(execution.stderr, expected, `${id} refused for the wrong reason:\n${execution.stderr}`);
    cases.push({ id, refused: true });
    console.error(`Protenix ${id}: refused as required`);
  }

  const preflight = parseResult(
    await execute(productPath, { ...base, action: 'preflight', protenixInput: ubiquitinInput,
      outputDir: join(workDir, 'preflight') }, { accelerator: 'cpu' }),
    'ubiquitin preflight',
  );
  assert.equal(preflight.kind, 'liatir.protenix-preflight');
  assert.equal(preflight.tokenEstimate, UBIQUITIN.length);
  assert.equal(preflight.chainCount, 1);
  // Protenix has no per-chain alignment switch the way Boltz does: this box always runs without
  // one, so the preflight must say so rather than leave it to be discovered in the summary.
  assert.equal(preflight.usedMsa, false);

  const predicted = await productCase('ubiquitin-single-sequence', {
    protenixInput: ubiquitinInput, seed: 17, ...PRODUCT_DEFAULTS,
  });
  assert.equal(predicted.summary.deterministic, true);
  assert.ok(
    predicted.summary.plddt >= MINIMUM_PLDDT,
    `Ubiquitin predicted at pLDDT ${predicted.summary.plddt}`,
  );
  assert.ok(
    predicted.warnings.some((warning) => warning.includes('without a multiple sequence alignment')),
    'A prediction made without an alignment must say so.',
  );

  const comparison = parseResult(await execute(comparePath, {
    referencePath: REFERENCE_PDB, predictedPath: predicted.paths.structure,
  }, { accelerator: 'cpu' }), 'backbone comparison');
  assert.equal(comparison.atomCount, UBIQUITIN.length);
  assert.ok(
    comparison.backboneRmsdAngstrom <= MAXIMUM_BACKBONE_RMSD_ANGSTROM,
    `Ubiquitin backbone RMSD ${comparison.backboneRmsdAngstrom} A exceeds ${MAXIMUM_BACKBONE_RMSD_ANGSTROM} A`,
  );

  // The same seed must give the same structure, or nothing downstream can be reproduced. Measured
  // between the two predictions rather than between their distances to the reference: two different
  // structures can sit the same distance from a third one, so only the direct comparison is proof.
  const repeated = await productCase('ubiquitin-repeat-seed-17', {
    protenixInput: ubiquitinInput, seed: 17, ...PRODUCT_DEFAULTS,
  });
  const repeatComparison = parseResult(await execute(comparePath, {
    referencePath: REFERENCE_PDB, predictedPath: repeated.paths.structure,
  }, { accelerator: 'cpu' }), 'repeat comparison');
  const determinism = parseResult(await execute(comparePath, {
    referencePath: predicted.paths.structure, predictedPath: repeated.paths.structure,
  }, { accelerator: 'cpu' }), 'determinism comparison');
  assert.ok(
    determinism.backboneRmsdAngstrom <= MAXIMUM_DETERMINISM_RMSD_ANGSTROM,
    `One seed gave two structures ${determinism.backboneRmsdAngstrom} A apart`,
  );
  const determinismDelta = Math.abs(
    repeatComparison.backboneRmsdAngstrom - comparison.backboneRmsdAngstrom,
  );

  await refusal('refuses-an-incomplete-installation', {
    protenixInput: ubiquitinInput, modelCacheDir: join(workDir, 'not-a-cache'),
  }, /This Runtime Box is incomplete: .* are missing from/);
  await refusal('refuses-an-empty-complex', {
    protenixInput: [{ name: 'empty', sequences: [] }],
  }, /no complex to predict/);

  const evidence = {
    schemaVersion: 1,
    kind: 'liatir.protenix-scientific-validation',
    createdAt: new Date().toISOString(),
    status: 'passed',
    modelId: COMPONENT_ID,
    sourceRevision: SOURCE_REVISION,
    targetId,
    productRunnerSha256,
    runtimeEvidence,
    measurementHost: {
      platform: platform(),
      arch: arch(),
      osRelease: osRelease(),
      cpuModel: cpus()[0]?.model ?? null,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    validatorSource: {
      scriptSha256: sha256(await readFile(new URL(import.meta.url))),
      measurementScriptSha256: sha256(await readFile(measurementPath)),
      comparisonScriptSha256: sha256(COMPARE_SCRIPT),
      recipeSha256: sha256(await readFile(
        join(ROOT, 'runtime-boxes/scrolls/protenix-base-v1-0-0/linux-x86_64-cuda12.6/scroll.json'),
      )),
    },
    provenance: {
      recipeId: authoringId,
      recipeVersion: authoringVersion,
      pythonVersion: recipe.runtime.version,
      ...builderVersionFields(recipe),
      dependencyLockSha256,
    },
    evidence: {
      fixture: {
        id: 'pdb-1ubq-experimental-1.8A',
        sha256: REFERENCE_SHA256,
        residues: UBIQUITIN.length,
        msaMode: 'no-alignment',
      },
      framework: { name: 'torch', version: null, backend: predicted.summary.accelerator },
      // Every field here comes from the measuring process's own `nvidia-smi` query, because CI
      // cross-checks them against a host probe it runs separately; mixing in what PyTorch reported
      // would compare two different readings of the same card and fail on rounding. What the
      // runner saw is still load-bearing — the case assertions above refuse a run whose own
      // process could not name a GPU, which is how a silent CPU fallback gets caught.
      accelerator: {
        kind: recipe.target.accelerator,
        gpuModel: cases[0]?.measurement?.gpuName ?? null,
        gpuMemoryBytes: cases[0]?.measurement?.gpuMemoryBytes ?? null,
        computeCapability: cases[0]?.measurement?.gpuComputeCapability ?? null,
        driverVersion: cases[0]?.measurement?.gpuDriverVersion ?? null,
        vramMeasurementMethod: cases[0]?.measurement?.vramMeasurementMethod ?? null,
        runnerReportedGpuModel: predicted.summary.gpuModel ?? null,
      },
      parity: {
        reference: 'pdb-1ubq-experimental-structure',
        passed: true,
        backboneRmsdAngstrom: comparison.backboneRmsdAngstrom,
        maximumDeviationAngstrom: comparison.maximumDeviationAngstrom,
        limitAngstrom: MAXIMUM_BACKBONE_RMSD_ANGSTROM,
        plddt: predicted.summary.plddt,
        rankingScore: predicted.summary.rankingScore,
        ptm: predicted.summary.ptm,
        determinismRmsdDeltaAngstrom: determinismDelta,
        // The direct comparison of the two predictions at one seed, which is the one that proves
        // reproducibility. The delta above only says they are equally far from the reference.
        repeatRmsdAngstrom: determinism.backboneRmsdAngstrom,
        repeatMaximumDeviationAngstrom: determinism.maximumDeviationAngstrom,
        repeatLimitAngstrom: MAXIMUM_DETERMINISM_RMSD_ANGSTROM,
      },
      finiteValues: comparison.allFinite,
      peakRamBytes: Math.max(...samples.map((sample) => sample.peakRamBytes)),
      peakVramBytes: recipe.target.accelerator === 'cuda'
        ? Math.max(...samples.map((sample) => sample.peakVramBytes))
        : null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
    hardwareSamples: samples,
    cases: cases.map(({ id, refused, summary, measurement, outputBytes }) => ({
      id, refused: Boolean(refused), summary, measurement, outputBytes,
    })),
  };

  const serialized = JSON.stringify(evidence, null, 2);
  if (outputPath) await writeFile(outputPath, `${serialized}\n`);
  console.log(serialized);
} finally {
  if (!process.argv.includes('--keep-work-dir')) {
    await rm(workDir, { recursive: true, force: true });
  }
}
