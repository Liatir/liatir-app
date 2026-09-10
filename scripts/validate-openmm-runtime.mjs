#!/usr/bin/env node

/** Exercise the exact offline product runner against official OpenMMForceFields validation data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { builderVersionFields } from 'scrollcase/build';
import { verifyExtractedPayload } from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REVISION = '8.5.1+openmmforcefields-0.16.0+openff-toolkit-0.17.1+openff-sage-2.3.0+nagl-0.5.5';
const COMPONENT_ID = 'openmm-openmm';
const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'openmm-macos-aarch64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_OPENMM_RUNTIME_DIR' });
assert.equal(recipe.modelId, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
assert.ok(['cpu', 'cuda'].includes(recipe.target.accelerator));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-openmm-validation-'));
const keep = process.argv.includes('--keep-work-dir');
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
assert.equal(Boolean(releasePath), Boolean(publicPath), '--release-document and --public-key are required together');
const measurementPath = join(ROOT, 'scripts/runtime-box/measure-python.py');
const samples = [];
const cases = [];

function execute(script, payload, { accelerator = recipe.target.accelerator, timeoutMs = 600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, [measurementPath, '--accelerator', accelerator, script], {
      cwd: workDir, env: { ...process.env, MPLCONFIGDIR: join(workDir, '.matplotlib') },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const marker = stderr.split(/\r?\n/u).findLast((line) => line.startsWith('LIATIR_SCIENTIFIC_MEASUREMENT '));
      const measurement = marker ? JSON.parse(marker.slice('LIATIR_SCIENTIFIC_MEASUREMENT '.length)) : null;
      resolveResult({ code, signal, stdout, stderr, measurement });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseResult(execution, label) {
  assert.equal(execution.code, 0, `${label} failed (${execution.signal ?? execution.code}):\n${execution.stderr}`);
  const line = execution.stdout.split(/\r?\n/u).findLast((value) => value.startsWith('{'));
  assert.ok(line, `${label} emitted no structured result`);
  return JSON.parse(line);
}

const PREPARE_FIXTURES = String.raw`
import json, pathlib, sys
from openmm import unit
from openmm.app import ForceField, HBonds, Modeller, NoCutoff, PDBFile, Simulation
from openmm import Platform, VerletIntegrator
from rdkit import Chem
from rdkit.Chem import AllChem
from openff.toolkit import Molecule
p = json.load(sys.stdin)
root = pathlib.Path(p['root'])
protein = PDBFile(p['official'])
assert protein.topology.getNumAtoms() == 33
heavy = Modeller(protein.topology, protein.positions)
heavy.delete([atom for atom in heavy.topology.atoms() if atom.element.symbol == 'H'])
with open(root/'protein-heavy.pdb', 'w') as handle:
    PDBFile.writeFile(heavy.topology, heavy.positions, handle)
rdmol = Chem.AddHs(Chem.MolFromSmiles('CCO'))
assert AllChem.EmbedMolecule(rdmol, randomSeed=7) == 0
conf = rdmol.GetConformer()
for index in range(rdmol.GetNumAtoms()):
    point = conf.GetAtomPosition(index)
    conf.SetAtomPosition(index, (point.x + 25, point.y, point.z))
with Chem.SDWriter(str(root/'ethanol.sdf')) as writer:
    writer.write(rdmol)
ligand = Molecule.from_file(str(root/'ethanol.sdf'), allow_undefined_stereo=False)
complex = Modeller(protein.topology, protein.positions)
complex.add(ligand.to_topology().to_openmm(), ligand.conformers[0].to_openmm())
with open(root/'protein-ligand.pdb', 'w') as handle:
    PDBFile.writeFile(complex.topology, complex.positions, handle)
# A real approved drug on a real protein: the shape a drug-discovery user actually brings.
# Ruxolitinib ships inside the signed payload as OpenFF test data, so measuring it downloads
# nothing. It is placed clear of the protein because this fixture measures the cost of
# parameterizing and relaxing a drug-sized molecule, not the correctness of a docked pose.
drug = Chem.SDMolSupplier(p['drugLigand'], removeHs=False)[0]
assert drug is not None and drug.GetNumAtoms() == 41
target = PDBFile(p['dhfr'])
target_positions = target.positions.value_in_unit(unit.angstrom)
drug_conformer = drug.GetConformer()
offset = (max(point.x for point in target_positions)
          - min(drug_conformer.GetAtomPosition(index).x for index in range(drug.GetNumAtoms())) + 15)
for index in range(drug.GetNumAtoms()):
    point = drug_conformer.GetAtomPosition(index)
    drug_conformer.SetAtomPosition(index, (point.x + offset, point.y, point.z))
with Chem.SDWriter(str(root/'drug-ligand.sdf')) as writer:
    writer.write(drug)
drug_molecule = Molecule.from_file(str(root/'drug-ligand.sdf'), allow_undefined_stereo=False)
assert not isinstance(drug_molecule, list)
drug_complex = Modeller(target.topology, target.positions)
drug_complex.add(drug_molecule.to_topology().to_openmm(), drug_molecule.conformers[0].to_openmm())
with open(root/'dhfr-drug-complex.pdb', 'w') as handle:
    PDBFile.writeFile(drug_complex.topology, drug_complex.positions, handle)
# Independent upstream Reference platform energy at identical coordinates.
forcefield = ForceField('amber19-all.xml', 'amber19/tip3pfb.xml')
system = forcefield.createSystem(protein.topology, nonbondedMethod=NoCutoff, constraints=HBonds,
                                rigidWater=True, removeCMMotion=True)
simulation = Simulation(protein.topology, system, VerletIntegrator(0.001*unit.picoseconds),
                        Platform.getPlatformByName('Reference'))
simulation.context.setPositions(protein.positions)
energy = simulation.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
print(json.dumps({'proteinAtoms': 33, 'complexAtoms': complex.topology.getNumAtoms(),
                  'ligandAtoms': ligand.n_atoms, 'referenceInitialEnergy': float(energy),
                  'drugLigandAtoms': drug_molecule.n_atoms,
                  'drugLigandHeavyAtoms': sum(1 for atom in drug_molecule.atoms if atom.atomic_number != 1),
                  'drugComplexAtoms': drug_complex.topology.getNumAtoms()}))
`;

try {
  // A version label alone is not evidence that the measured environment contains the signed bytes.
  let runtimeEvidence = { kind: 'development-environment', signedPayloadVerified: false };
  if (releasePath) {
    const signedBytes = await readFile(releasePath);
    const release = await verifySignedDocument(JSON.parse(signedBytes), publicPath);
    assert.equal(release.kind, 'liatir.runtime-box.release');
    assert.equal(release.boxId, recipe.boxId);
    assert.equal(release.runtimeId, recipe.runtimeId);
    assert.equal(release.version, recipe.version);
    assert.deepEqual(release.target, recipe.target);
    assert.equal(release.provenance.dependencyLockSha256, dependencyLockSha256);
    assert.equal(release.provenance.sourceRevision, SOURCE_REVISION);
    await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
    runtimeEvidence = { kind: 'signed-payload', signedPayloadVerified: true,
      releaseManifestSha256: sha256(signedBytes), archiveSha256: release.archive.sha256,
      payloadDigestSha256: release.payloadDigest.sha256, provenance: release.provenance };
  }
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/molecular-simulation/python-scripts/openmm.ts'), 'utf8');
  const prefix = 'export const OPENMM_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product OpenMM script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-openmm.py');
  const fixturesPath = join(workDir, 'prepare-fixtures.py');
  await writeFile(productPath, productRunner);
  await writeFile(fixturesPath, PREPARE_FIXTURES);
  const official = join(runtimeDir, 'source/openmmforcefields/openmmforcefields/data/test-ala-3.pdb');
  const officialSha256 = sha256(await readFile(official));

  // Real inputs, at the sizes people actually bring. Every structure and molecule below already
  // ships inside the signed payload — OpenMM's published benchmark set and the OpenFF toolkit's
  // test molecules — so the envelope grows without a downloaded asset or an unchecked hash.
  const examples = join(runtimeDir, 'venv/share/openmm/examples');
  const multiResidue = join(runtimeDir, 'source/openmmforcefields/openmmforcefields/data/test-aa.pdb');
  const dhfr = join(examples, 'benchmarks/5dfr_minimized.pdb');
  const drugLigand = join(runtimeDir,
    'venv/lib/python3.11/site-packages/openff/toolkit/data/molecules/ruxolitinib_conformers.sdf');
  const realFixtures = { 'openmmforcefields-test-aa': multiResidue, 'openmm-benchmark-5dfr': dhfr,
    'openff-toolkit-ruxolitinib': drugLigand };
  const realFixtureSha256 = Object.fromEntries(await Promise.all(
    Object.entries(realFixtures).map(async ([id, path]) => [id, sha256(await readFile(path))]),
  ));

  const fixture = parseResult(await execute(fixturesPath, { root: workDir, official, dhfr, drugLigand },
    { accelerator: 'cpu' }), 'Fixture preparation');
  assert.equal(fixture.complexAtoms, fixture.proteinAtoms + fixture.ligandAtoms);
  assert.equal(fixture.drugLigandAtoms, 41);
  assert.equal(fixture.drugLigandHeavyAtoms, 23);
  assert.equal(fixture.drugComplexAtoms, 2489 + fixture.drugLigandAtoms);
  const preparation = { addHydrogens: false, ph: 7.4, solvent: 'none' };
  const base = { runtimePath: runtimeDir, runtimeBoxRelease: recipe.version, targetId,
    accelerator: recipe.target.accelerator, inputStructure: official, preparation };

  async function productCase(id, input, expectedAtoms, options = {}) {
    const payload = { ...base, ...input, outputDir: join(workDir, id) };
    const metrics = parseResult(await execute(productPath, { ...payload, action: 'preflight' }, { accelerator: 'cpu' }), `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action: 'run', measurementMode: true }, options);
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.openmm-result');
    assert.equal(result.summary.openmmVersion, '8.5.1');
    assert.equal(result.summary.openmmforcefieldsVersion, '0.16.0');
    assert.equal(result.summary.openffForceFieldsVersion, '2026.1.0');
    assert.equal(result.summary.runtimeId, recipe.runtimeId);
    assert.equal(result.summary.runtimeBoxRelease, recipe.version);
    assert.equal(result.summary.targetId, targetId);
    assert.equal(result.summary.platform, recipe.target.accelerator === 'cpu' ? 'CPU' : 'CUDA');
    assert.equal(result.summary.networkAccess, false);
    assert.ok(Number.isFinite(result.summary.finalPotentialEnergyKilojoulePerMole));
    if (expectedAtoms !== undefined) assert.equal(result.summary.preparedAtomCount, expectedAtoms);
    assert.ok(result.summary.preparedAtomCount <= metrics.atomCount);
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    assert.ok(execution.measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    if (recipe.target.accelerator === 'cuda') {
      assert.deepEqual(execution.measurement.vramMeasurementErrors, []);
      assert.ok(execution.measurement.peakVramBytes > 0, 'No measured CUDA memory');
    }
    // The envelope must never claim more atoms were measured than the System actually contained.
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: result.summary.preparedAtomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes: execution.measurement.peakRamBytes, peakVramBytes: execution.measurement.peakVramBytes,
      elapsedMs: execution.measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics, preparedAtoms: result.summary.preparedAtomCount,
      measurement: execution.measurement, outputBytes });
    console.error(`OpenMM ${id}: passed (${result.summary.preparedAtomCount} atoms)`);
    return result;
  }

  const relaxation = { maxIterations: 5000, toleranceKilojoulePerMoleNanometer: 10, seed: 17 };
  const relaxed = await productCase('official-protein-relaxation', { mode: 'relaxation', relaxation }, 33);
  assert.ok(relaxed.summary.energyReductionKilojoulePerMole > 0);
  const energyDifference = Math.abs(relaxed.summary.initialPotentialEnergyKilojoulePerMole - fixture.referenceInitialEnergy);
  assert.ok(energyDifference <= 0.01, `Reference energy differs by ${energyDifference} kJ/mol`);
  await productCase('add-missing-hydrogens', { mode: 'relaxation', relaxation,
    inputStructure: join(workDir, 'protein-heavy.pdb'), preparation: { ...preparation, addHydrogens: true } }, 33);
  const ligand = await productCase('protein-ligand-relaxation', { mode: 'relaxation', relaxation,
    inputStructure: join(workDir, 'protein-ligand.pdb'), ligandSdf: join(workDir, 'ethanol.sdf') }, 42);
  assert.equal(ligand.summary.ligandAtomCount, 9);
  assert.equal(ligand.summary.naglModelSha256, '7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee');

  const dynamics = { preset: 'verification-10ps', temperatureKelvin: 300, saveIntervalPs: 1, seed: 17 };
  const first = await productCase('protein-dynamics-10ps', { mode: 'dynamics', dynamics }, 33);
  assert.equal(first.summary.frameCount, 10);
  assert.equal(first.summary.trajectoryFiniteCoordinates, true);
  assert.equal(first.summary.checkpoint.currentStep, 5000);
  const resumedInput = { mode: 'dynamics', dynamics, checkpointPath: first.paths.checkpointPath,
    checkpointMetadataPath: first.paths.checkpointMetadataPath };
  const resumed = await productCase('protein-checkpoint-resume', resumedInput, 33);
  assert.equal(resumed.summary.checkpoint.currentStep, 10000);
  assert.equal(resumed.summary.resumed, true);
  assert.equal(resumed.summary.systemSha256, first.summary.systemSha256);
  const long = await productCase('protein-dynamics-100ps', { mode: 'dynamics',
    dynamics: { ...dynamics, preset: 'short-100ps', saveIntervalPs: 10 } }, 33);
  assert.equal(long.summary.checkpoint.currentStep, 50000);
  assert.equal(long.summary.frameCount, 10);

  await productCase('multi-residue-relaxation', { mode: 'relaxation', relaxation,
    inputStructure: multiResidue }, 407);
  // Dihydrofolate reductase: the standard molecular-dynamics benchmark protein, 2,489 atoms.
  const dhfrRelaxed = await productCase('dhfr-protein-relaxation', { mode: 'relaxation', relaxation,
    inputStructure: dhfr }, 2489, { timeoutMs: 3_600_000 });
  assert.ok(dhfrRelaxed.summary.energyReductionKilojoulePerMole > 0);

  // The drug-discovery shape: that same real protein with an approved drug bound to it.
  // Ruxolitinib has 23 heavy atoms, inside the drug-like range that the 9-atom ethanol fixture
  // never reaches, and it drives the runner's slowest path — OpenFF parameterization with NAGL
  // charges — at a protein size that matters rather than on a tripeptide.
  const drugComplex = await productCase('dhfr-drug-ligand-relaxation', { mode: 'relaxation', relaxation,
    inputStructure: join(workDir, 'dhfr-drug-complex.pdb'), ligandSdf: join(workDir, 'drug-ligand.sdf') },
    fixture.drugComplexAtoms, { timeoutMs: 3_600_000 });
  assert.equal(drugComplex.summary.ligandAtomCount, fixture.drugLigandAtoms);
  assert.ok(drugComplex.summary.energyReductionKilojoulePerMole > 0);

  // The realistic production shape: a real protein the runner puts in explicit water, so the system
  // is periodic and uses PME rather than the all-pairs path every smaller fixture above exercises.
  const solvatedPreparation = { ...preparation, addHydrogens: true, solvent: 'tip3p-fb',
    solventPaddingNm: 1, ionicStrengthM: 0.15 };
  const dhfrSolvated = await productCase('dhfr-solvated-relaxation', { mode: 'relaxation', relaxation,
    inputStructure: dhfr, preparation: solvatedPreparation }, undefined, { timeoutMs: 3_600_000 });
  assert.ok(dhfrSolvated.summary.preparedAtomCount > 20_000,
    `Solvated DHFR should exceed 20,000 atoms, got ${dhfrSolvated.summary.preparedAtomCount}`);
  const dhfrDynamics = await productCase('dhfr-solvated-dynamics-10ps', { mode: 'dynamics',
    dynamics: { ...dynamics, pressureBar: 1 }, inputStructure: dhfr, preparation: solvatedPreparation },
    dhfrSolvated.summary.preparedAtomCount, { timeoutMs: 7_200_000 });
  assert.equal(dhfrDynamics.summary.frameCount, 10);
  assert.equal(dhfrDynamics.summary.trajectoryFiniteCoordinates, true);

  const solvatedInput = { mode: 'dynamics', dynamics: { ...dynamics, preset: 'custom', customDurationPs: 0.02,
    saveIntervalPs: 0.01, pressureBar: 1 },
    preparation: { ...preparation, addHydrogens: true, solvent: 'tip3p-fb', solventPaddingNm: 1, ionicStrengthM: 0.15 } };
  const solvated = await productCase('solvated-dynamics-custom', solvatedInput);
  assert.ok(solvated.summary.preparedAtomCount > 33);
  const solvatedResume = await productCase('solvated-checkpoint-resume', { ...solvatedInput,
    checkpointPath: solvated.paths.checkpointPath, checkpointMetadataPath: solvated.paths.checkpointMetadataPath },
    solvated.summary.preparedAtomCount);
  assert.equal(solvatedResume.summary.checkpoint.currentStep, 20);
  assert.equal(solvatedResume.summary.topologySha256, solvated.summary.topologySha256);
  assert.equal(solvatedResume.summary.systemSha256, solvated.summary.systemSha256);

  for (const [name, override, message] of [
    ['changed-release', { runtimeBoxRelease: '0.0.0-mismatch' }, 'Checkpoint runtimeBoxRelease'],
    ['changed-target', { targetId: 'wrong-target' }, 'Checkpoint targetId'],
    ['changed-temperature', { dynamics: { ...dynamics, temperatureKelvin: 310 } }, 'simulation settings'],
  ]) {
    const failed = await execute(productPath, { ...base, ...resumedInput, ...override, action: 'run',
      measurementMode: true, outputDir: join(workDir, name) }, { accelerator: 'cpu' });
    assert.notEqual(failed.code, 0);
    assert.ok(failed.stderr.includes(message), `${name}: ${failed.stderr}`);
    cases.push({ id: name, rejected: true });
  }
  const noLigand = await execute(productPath, { ...base, action: 'run', mode: 'relaxation', relaxation,
    ligandSdf: join(workDir, 'ethanol.sdf'), measurementMode: true, outputDir: join(workDir, 'absent-ligand') });
  assert.notEqual(noLigand.code, 0);
  assert.ok(noLigand.stderr.includes('did not parameterize a ligand'), noLigand.stderr);
  cases.push({ id: 'absent-ligand', rejected: true });

  const damagedMetadata = JSON.parse(await readFile(first.paths.checkpointMetadataPath, 'utf8'));
  damagedMetadata.state.systemXml += 'corrupted';
  const damagedMetadataPath = join(workDir, 'corrupted-checkpoint.json');
  await writeFile(damagedMetadataPath, JSON.stringify(damagedMetadata));
  const corrupted = await execute(productPath, { ...base, ...resumedInput, action: 'run',
    checkpointMetadataPath: damagedMetadataPath, measurementMode: true, outputDir: join(workDir, 'corrupted') },
    { accelerator: 'cpu' });
  assert.notEqual(corrupted.code, 0);
  assert.ok(corrupted.stderr.includes('systemXml does not match its recorded hash'), corrupted.stderr);
  cases.push({ id: 'corrupted-checkpoint-system', rejected: true });

  const validation = { schemaVersion: 1, kind: 'liatir.openmm-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples,
    runtimeEvidence,
    measurementHost: { platform: platform(), arch: arch(), osRelease: osRelease(),
      cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem() },
    validatorSource: {
      gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      sourceTreeDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
      scriptSha256: sha256(await readFile(import.meta.filename)),
      measurementScriptSha256: sha256(await readFile(measurementPath)),
      fixturePreparationSha256: sha256(PREPARE_FIXTURES),
      recipeSha256: sha256(await readFile(recipePath)),
    },
    provenance: { recipeId: authoringId, recipeVersion: authoringVersion, pythonVersion: recipe.pythonVersion,
      ...builderVersionFields(recipe), dependencyLockSha256 },
    evidence: {
      fixture: { id: 'openmmforcefields-0.16.0-official-ala3-and-ethanol-v1', sha256: officialSha256,
        inputShapes: { proteinAtoms: [33], proteinLigandAtoms: [42],
          drugLikeComplexAtoms: [fixture.drugComplexAtoms] } },
      // Real fixtures, all shipped inside the verified payload rather than downloaded.
      realProteinFixtures: realFixtureSha256,
      framework: { name: 'openmm', version: '8.5.1', backend: recipe.target.accelerator,
        reportedCudaCompatibility: recipe.target.cudaVersion ?? null },
      // Identity comes from the measured runs themselves, so a GPU figure always names the card
      // and driver that produced it rather than leaving the reader to guess the host.
      accelerator: { kind: recipe.target.accelerator,
        gpuModel: cases.find((item) => item.measurement?.gpuName)?.measurement.gpuName ?? null,
        driverVersion: cases.find((item) => item.measurement?.gpuDriverVersion)?.measurement.gpuDriverVersion ?? null,
        vramMeasurementMethod: cases.find((item) => item.measurement?.vramMeasurementMethod)
          ?.measurement.vramMeasurementMethod ?? null,
        reportedCudaCompatibility: recipe.target.cudaVersion ?? null },
      outputShapes: { relaxedStructure: [33, 3], ligandStructure: [42, 3], trajectory: [10, 33, 3] },
      finiteValues: true, tolerances: { absolute: 0.01, relative: 0 },
      parity: { reference: 'OpenMM-8.5.1-Reference-platform-official-ala3-energy', passed: true,
        cpuBaselinePassed: true, acceleratorPassed: recipe.target.accelerator === 'cuda' ? true : null,
        maximumAbsoluteDifference: energyDifference, meanAbsoluteDifference: energyDifference,
        minimumCosineSimilarity: null },
      peakRamBytes: Math.max(...samples.map((sample) => sample.peakRamBytes)),
      peakVramBytes: recipe.target.accelerator === 'cuda' ? Math.max(...samples.map((sample) => sample.peakVramBytes)) : null,
      outputContract: 'passed', provenanceContract: 'passed',
    },
  };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify(validation, null, 2));
} finally {
  if (keep) console.error(`Preserved OpenMM validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
