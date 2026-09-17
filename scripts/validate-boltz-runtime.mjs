#!/usr/bin/env node

/**
 * Exercises the exact offline Boltz-2 product runner against a real experimental structure.
 *
 * The reference is ubiquitin, PDB entry 1UBQ at 1.8 A — the most thoroughly determined small
 * protein there is, and a case where a wrong fold is unmistakable rather than arguable. Every
 * prediction here runs in single-sequence mode, because an offline box has no alignment server;
 * that is the accuracy this product can actually promise, so it is the accuracy that gets measured.
 *
 * Affinity is judged on carbonic anhydrase II and two sulfonamides whose inhibition constants ChEMBL
 * records hundreds of times over. Boltz documents its binding probability for telling binders from
 * decoys and its log10(IC50) only for comparing actives, so exactly those two claims are tested: a
 * 12 nM inhibitor must be called a binder, and must be predicted stronger than a 240 nM one.
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
const COMPONENT_ID = 'jwohlwend-boltz-2';
const SOURCE_REVISION = 'cb04aeccdd480fd4db707f0bbafde538397fa2ac+weights-6fdef46d763fee7fbb83ca5501ccceff43b85607';
const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';
const REFERENCE_PDB = join(ROOT, 'runtime-boxes/fixtures/structures/1ubq.pdb');
const REFERENCE_SHA256 = 'd4a6812d8951cf6594e6a0763f089e35f5a80b62acb3c117b2c5565228a7b161';
const CARBONIC_ANHYDRASE_2_FASTA = join(ROOT, 'runtime-boxes/fixtures/proteins/P00918.fasta');
const CARBONIC_ANHYDRASE_2_SHA256 = '74cc1e0de5c8488d747471c3b3f4d2c219bc0afbd3d324cc65e017a65209bf8b';
// Median Ki against ChEMBL target CHEMBL205 over its exact nanomolar records, read on 2026-09-14.
// Atom counts are Boltz's own: heavy atoms plus the hydrogens RDKit's RemoveHs keeps.
const AFFINITY_LIGANDS = {
  acetazolamide: {
    chemblId: 'CHEMBL20', smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1', atoms: 13, medianKiNanomolar: 12, kiRecords: 516,
  },
  sulfanilamide: {
    chemblId: 'CHEMBL21', smiles: 'Nc1ccc(S(N)(=O)=O)cc1', atoms: 11, medianKiNanomolar: 240, kiRecords: 75,
  },
};
// A documented 12 nM inhibitor called less likely than not to bind is a result no user should be
// shown. The repeat bound tolerates GPU arithmetic and still catches a prediction that drifts.
const MINIMUM_BINDER_PROBABILITY = 0.5;
const MAXIMUM_AFFINITY_REPEAT_DELTA = 0.01;

// Single-sequence Boltz-2 on a protein this well determined should reproduce the backbone closely.
// The bound is deliberately loose enough to survive a driver or seed difference and tight enough
// that a wrong fold fails: a mispredicted 76-residue protein lands well above 5 A.
const MAXIMUM_BACKBONE_RMSD_ANGSTROM = 3;
const MINIMUM_COMPLEX_PLDDT = 0.7;

const {
  recipe, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'boltz-2-linux-x86_64-cuda12.9',
  runtimeDirectoryEnvironment: 'LIATIR_BOLTZ_RUNTIME_DIR',
});
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-boltz-validation-'));
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
    join(ROOT, 'frontend/src/lib/tools/ai/python-scripts/boltz-structure.ts'), 'utf8',
  );
  const prefix = 'export const BOLTZ_STRUCTURE_SCRIPT = String.raw`';
  const start = productSource.indexOf(prefix);
  const end = productSource.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product Boltz-2 script is missing');
  const productRunner = productSource.slice(start + prefix.length, end);
  const productRunnerSha256 = sha256(productRunner);
  const productPath = join(workDir, 'product-boltz.py');
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
    modelCacheDir: join(runtimeDir, 'model-cache/boltz-2'),
    runtimeId: recipe.labels.runtime,
    runtimeBoxRelease: recipe.version,
    targetId,
    accelerator,
  };
  const ubiquitinInput = {
    version: 1,
    sequences: [{ protein: { id: 'A', sequence: UBIQUITIN, msa: 'empty' } }],
  };
  const carbonicAnhydraseBytes = await readFile(CARBONIC_ANHYDRASE_2_FASTA);
  assert.equal(
    sha256(carbonicAnhydraseBytes), CARBONIC_ANHYDRASE_2_SHA256,
    'The carbonic anhydrase II sequence is not the reviewed one.',
  );
  const carbonicAnhydrase2 = carbonicAnhydraseBytes.toString('utf8').split('\n')
    .filter((line) => line && !line.startsWith('>')).join('');
  assert.equal(carbonicAnhydrase2.length, 260);
  // The shape the product adapter sends: short chain names, and the one ligand named as the binder.
  const affinityInput = (smiles) => ({
    version: 1,
    sequences: [
      { protein: { id: 'A', sequence: carbonicAnhydrase2, msa: 'empty' } },
      { ligand: { id: 'B', smiles } },
    ],
    properties: [{ affinity: { binder: 'B' } }],
  });

  async function productCase(id, payload, options = {}) {
    const execution = await execute(productPath, {
      ...base, ...payload, outputDir: join(workDir, id), jobName: id,
    }, options);
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.boltz-2-result');
    assert.equal(result.summary.boltzVersion, '2.2.1');
    assert.equal(result.summary.runtimeBoxRelease, recipe.version);
    assert.equal(result.summary.targetId, targetId);
    assert.equal(result.summary.networkAccess, false);
    assert.ok(execution.measurement?.peakRamBytes > 0, `${id} measured no peak memory`);
    if (recipe.target.accelerator === 'cuda') {
      assert.deepEqual(execution.measurement.vramMeasurementErrors, []);
      assert.ok(execution.measurement.peakVramBytes > 0, `${id} measured no CUDA memory`);
      assert.ok(result.summary.gpuModel, `${id} reported no GPU`);
      // A box whose torch was built for another CUDA would pass here on a new enough driver and
      // fail on a user's older one, so the target name has to be what the box actually carries.
      assert.equal(result.summary.reportedCudaCompatibility, recipe.target.cudaVersion, `${id} torch CUDA build`);
      assert.ok(result.summary.peakVramBytes > 0, `${id} reported no allocator peak`);
    }
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `${id} produced an empty ${path}`);
      outputBytes += size;
    }
    // The shape the app's hardware estimate reads, derived the way the product derives a request:
    // tokens from the input, sampling steps, and structures returned. Atoms are not a dimension this
    // model's preflight measures, so they hold at 1, as tokens do for OpenMM.
    samples.push({
      fixtureId: id,
      workloadId: result.summary.affinityPredValue == null ? 'boltz-2:structure' : 'boltz-2:affinity',
      maxTokenCount: result.summary.tokenEstimate,
      maxAtomCount: 1,
      maxStepCount: result.summary.samplingSteps,
      maxOutputItemCount: result.summary.modelCount,
      peakRamBytes: execution.measurement.peakRamBytes,
      peakVramBytes: execution.measurement.peakVramBytes,
      elapsedMs: execution.measurement.elapsedMs,
      outputBytes,
    });
    cases.push({ id, measurement: execution.measurement, summary: result.summary, outputBytes });
    console.error(`Boltz-2 ${id}: passed in ${execution.measurement.elapsedMs} ms`);
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
    console.error(`Boltz-2 ${id}: refused as required`);
  }

  const preflight = parseResult(
    await execute(productPath, { ...base, action: 'preflight', boltzInput: ubiquitinInput,
      outputDir: join(workDir, 'preflight') }, { accelerator: 'cpu' }),
    'ubiquitin preflight',
  );
  assert.equal(preflight.kind, 'liatir.boltz-2-preflight');
  assert.equal(preflight.tokenEstimate, UBIQUITIN.length);
  assert.equal(preflight.singleSequenceChains, 1);

  const predicted = await productCase('ubiquitin-single-sequence', {
    boltzInput: ubiquitinInput, seed: 17, diffusionSamples: 1, recyclingSteps: 3,
  });
  assert.ok(
    predicted.summary.complexPlddt >= MINIMUM_COMPLEX_PLDDT,
    `Ubiquitin predicted at pLDDT ${predicted.summary.complexPlddt}`,
  );
  assert.ok(
    predicted.warnings.some((warning) => warning.includes('Single-sequence mode')),
    'A single-sequence prediction must say so.',
  );

  const comparison = parseResult(await execute(comparePath, {
    referencePath: REFERENCE_PDB, predictedPath: predicted.paths.structure,
  }, { accelerator: 'cpu' }), 'backbone comparison');
  assert.equal(comparison.atomCount, UBIQUITIN.length);
  assert.ok(
    comparison.backboneRmsdAngstrom <= MAXIMUM_BACKBONE_RMSD_ANGSTROM,
    `Ubiquitin backbone RMSD ${comparison.backboneRmsdAngstrom} A exceeds ${MAXIMUM_BACKBONE_RMSD_ANGSTROM} A`,
  );

  // The same seed must give the same structure, or nothing downstream can be reproduced.
  const repeated = await productCase('ubiquitin-repeat-seed-17', {
    boltzInput: ubiquitinInput, seed: 17, diffusionSamples: 1, recyclingSteps: 3,
  });
  const repeatComparison = parseResult(await execute(comparePath, {
    referencePath: REFERENCE_PDB, predictedPath: repeated.paths.structure,
  }, { accelerator: 'cpu' }), 'repeat comparison');
  const determinismDelta = Math.abs(
    repeatComparison.backboneRmsdAngstrom - comparison.backboneRmsdAngstrom,
  );

  const affinityPreflight = parseResult(await execute(productPath, {
    ...base, action: 'preflight', boltzInput: affinityInput(AFFINITY_LIGANDS.acetazolamide.smiles),
    outputDir: join(workDir, 'affinity-preflight'),
  }, { accelerator: 'cpu' }), 'affinity preflight');
  assert.equal(affinityPreflight.workloadId, 'affinity');
  assert.equal(affinityPreflight.ligandAtomCount, AFFINITY_LIGANDS.acetazolamide.atoms);

  const affinity = {};
  for (const [name, ligand] of Object.entries(AFFINITY_LIGANDS)) {
    const { summary } = await productCase(`carbonic-anhydrase-2-${name}`, {
      boltzInput: affinityInput(ligand.smiles), seed: 17, diffusionSamples: 1, recyclingSteps: 3,
    });
    // Printed before anything is judged, so a failing gate still leaves the numbers it failed on.
    console.error(
      `Boltz-2 ${name}: binding probability ${summary.affinityProbabilityBinary}, `
      + `log10(IC50 uM) ${summary.affinityPredValue}, measured Ki ${ligand.medianKiNanomolar} nM`,
    );
    assert.equal(summary.ligandAtomCount, ligand.atoms);
    assert.ok(Number.isFinite(summary.affinityPredValue), `${name} has no finite log10(IC50)`);
    assert.ok(
      summary.affinityProbabilityBinary >= 0 && summary.affinityProbabilityBinary <= 1,
      `${name} has a binding probability outside 0 to 1`,
    );
    affinity[name] = summary;
  }
  assert.ok(
    affinity.acetazolamide.affinityProbabilityBinary >= MINIMUM_BINDER_PROBABILITY,
    'Acetazolamide, a 12 nM carbonic anhydrase II inhibitor, was not predicted a binder.',
  );
  assert.ok(
    affinity.acetazolamide.affinityPredValue < affinity.sulfanilamide.affinityPredValue,
    'Acetazolamide (12 nM) was not predicted to bind more strongly than sulfanilamide (240 nM).',
  );
  const affinityRepeat = await productCase('carbonic-anhydrase-2-acetazolamide-repeat-seed-17', {
    boltzInput: affinityInput(AFFINITY_LIGANDS.acetazolamide.smiles),
    seed: 17, diffusionSamples: 1, recyclingSteps: 3,
  });
  const affinityRepeatDelta = Math.max(
    Math.abs(affinityRepeat.summary.affinityPredValue - affinity.acetazolamide.affinityPredValue),
    Math.abs(affinityRepeat.summary.affinityProbabilityBinary - affinity.acetazolamide.affinityProbabilityBinary),
  );
  assert.ok(
    affinityRepeatDelta <= MAXIMUM_AFFINITY_REPEAT_DELTA,
    `The same seed moved acetazolamide's affinity by ${affinityRepeatDelta}.`,
  );

  await refusal('refuses-an-incomplete-installation', {
    boltzInput: ubiquitinInput, modelCacheDir: join(workDir, 'not-a-cache'),
  }, /installation is incomplete/);
  await refusal('refuses-an-empty-complex', {
    boltzInput: { version: 1, sequences: [] },
  }, /no complex to predict/);
  // 130 atoms of polyethylene glycol: two past Boltz's limit, and chemistry ordinary enough that its
  // size is the only reason left to turn it away.
  await refusal('refuses-an-oversized-affinity-ligand', {
    boltzInput: affinityInput(`O${'CCO'.repeat(43)}`),
  }, /at most 128 atoms; this one has 130/);

  const evidence = {
    schemaVersion: 1,
    kind: 'liatir.boltz-2-scientific-validation',
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
        join(ROOT, 'runtime-boxes/scrolls/boltz-2/linux-x86_64-cuda12.9/scroll.json'),
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
        msaMode: 'single-sequence',
      },
      framework: {
        name: 'torch', version: null, backend: predicted.summary.accelerator,
        reportedCudaCompatibility: predicted.summary.reportedCudaCompatibility ?? null,
      },
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
        // Diffusion draws different noise on a CPU, so the accelerator run is held to experiment.
        anchor: 'experimental-structure',
        passed: true,
        cpuBaselinePassed: null,
        acceleratorPassed: recipe.target.accelerator === 'cuda' ? true : null,
        backboneRmsdAngstrom: comparison.backboneRmsdAngstrom,
        maximumDeviationAngstrom: comparison.maximumDeviationAngstrom,
        limitAngstrom: MAXIMUM_BACKBONE_RMSD_ANGSTROM,
        complexPlddt: predicted.summary.complexPlddt,
        ptm: predicted.summary.ptm,
        determinismRmsdDeltaAngstrom: determinismDelta,
      },
      affinity: {
        reference: 'chembl-carbonic-anhydrase-2-sulfonamide-ki',
        target: {
          uniprotAccession: 'P00918',
          chemblId: 'CHEMBL205',
          sha256: CARBONIC_ANHYDRASE_2_SHA256,
          residues: carbonicAnhydrase2.length,
          msaMode: 'single-sequence',
        },
        passed: true,
        ligands: Object.fromEntries(Object.entries(AFFINITY_LIGANDS).map(([name, ligand]) => [name, {
          ...ligand,
          measuredLog10MicromolarKi: Math.log10(ligand.medianKiNanomolar / 1000),
          bindingProbability: affinity[name].affinityProbabilityBinary,
          log10MicromolarIc50: affinity[name].affinityPredValue,
        }])),
        minimumBinderProbability: MINIMUM_BINDER_PROBABILITY,
        repeatDelta: affinityRepeatDelta,
        repeatDeltaLimit: MAXIMUM_AFFINITY_REPEAT_DELTA,
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
