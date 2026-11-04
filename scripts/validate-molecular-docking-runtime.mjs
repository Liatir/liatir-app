#!/usr/bin/env node

/** Exercise the exact offline docking runner against the official AutoDock Vina 1IEP example. */
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
const SOURCE_REVISION = 'vina-1.2.7+meeko-0.8.0+ringtail-2.3.1+pdbfixer-1.12+openmm-8.5.1+rdkit-2024.09.6';
const COMPONENT_ID = 'autodock-vina-molecular-docking';
// The standard redocking success criterion of the Vina 1.2 and GNINA evaluations: the top-ranked
// pose within 2 Å heavy-atom RMSD of the crystallographic ligand.
const REDOCKING_RMSD_ANGSTROM = 2.0;
// What the official tutorial reports for this system at exhaustiveness 32, kept for comparison.
const OFFICIAL_TOP_SCORE_KCAL_PER_MOL = -13.234;
const OFFICIAL_BOX = { mode: 'box', center: [15.19, 53.903, 16.917], size: [20, 20, 20] };
// PDB entry 1IEP as distributed by RCSB on 2026-11-03 (CC0), committed so the raw path is offline.
const RAW_1IEP = { path: 'runtime-boxes/fixtures/structures/1iep.cif',
  sha256: '0929a6fae4aa67875ed0c8d06b650f0a4ec7bb104011abfc7c8ee402c672ca27' };
const MISMATCHED_RECEPTOR = 'runtime-boxes/fixtures/structures/1ubq.pdb';

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'molecular-docking-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_MOLECULAR_DOCKING_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
assert.equal(recipe.target.accelerator, 'cpu');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-docking-validation-'));
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
const reference = join(runtimeDir, 'reference/vina-1iep');
const threads = Math.max(1, Math.min(6, cpus().length));
const samples = [];
const cases = [];

function execute(script, payload, { measured = true, timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const args = measured ? [measurementPath, '--accelerator', 'cpu', '--process-tree', script] : ['-I', script];
    const child = spawn(python, args, { cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
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

// Builds the screening library and the malformed inputs inside the signed payload's own Python, so
// every molecule is made by the exact RDKit the runner uses. Ligands are drawn neutral, as given.
const PREPARE_FIXTURES = String.raw`
import json, pathlib, sqlite3, sys
from rdkit import Chem
from rdkit.Chem import AllChem
p = json.load(sys.stdin)
root = pathlib.Path(p['root'])
crystal = Chem.MolFromMolFile(p['crystal'], removeHs=False)
assert crystal is not None and crystal.GetNumAtoms() == 69

def embedded(smiles, name):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = 7
    assert AllChem.EmbedMolecule(mol, params) == 0, name
    AllChem.MMFFOptimizeMolecule(mol)
    mol.SetProp('_Name', name)
    return mol

def named(mol, name):
    mol = Chem.Mol(mol)
    mol.SetProp('_Name', name)
    return mol

library = []
library.append(named(crystal, 'imatinib-crystal'))
library.append(named(Chem.RemoveHs(crystal), 'imatinib-without-hydrogens'))
library.append(embedded('Cc1cn(-c2cc(NC(=O)c3ccc(C)c(Nc4nccc(-c5cccnc5)n4)c3)cc(C(F)(F)F)c2)cn1', 'nilotinib'))
library.append(embedded('Cc1nc(Nc2ncc(C(=O)Nc3c(C)cccc3Cl)s2)cc(N2CCN(CCO)CC2)n1', 'dasatinib'))
library.append(embedded('Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'decoy'))
library.append(embedded('CC(=O)Oc1ccccc1C(=O)O', 'decoy'))
flat = Chem.Mol(Chem.RemoveHs(crystal))
AllChem.Compute2DCoords(flat)
library.append(named(flat, 'imatinib-2d'))
salt = Chem.CombineMols(crystal, Chem.AddHs(Chem.MolFromSmiles('[Cl-]')))
salt_conformer = salt.GetConformer()
salt_conformer.SetAtomPosition(salt.GetNumAtoms() - 1, (30.0, 60.0, 20.0))
library.append(named(salt, 'imatinib-chloride-salt'))
library.append(embedded('OB(O)c1ccccc1', 'phenylboronic-acid'))
with Chem.SDWriter(str(root / 'library.sdf')) as writer:
    for mol in library:
        writer.write(mol)
with Chem.SDWriter(str(root / 'late-ligand.sdf')) as writer:
    writer.write(embedded('CC(=O)Nc1ccc(O)cc1', 'paracetamol'))
text = (root / 'library.sdf').read_text()
(root / 'truncated.sdf').write_text('\n'.join(text.splitlines()[:6]) + '\n')
sqlite3.connect(str(root / 'foreign.db')).execute('CREATE TABLE unrelated (x INTEGER)').connection.commit()
print(json.dumps({'libraryMolecules': len(library)}))
`;

const ANALYZE = String.raw`
import json, sys
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from meeko import MoleculePreparation, PDBQTWriterLegacy
p = json.load(sys.stdin)
result = {}
if p.get('poses'):
    crystal = Chem.RemoveHs(Chem.MolFromMolFile(p['crystal'], removeHs=False))
    poses = [mol for mol in Chem.SDMolSupplier(p['poses'], removeHs=False)]
    assert all(mol is not None for mol in poses)
    rows = []
    for mol in poses:
        row = {name: mol.GetProp(name) for name in ('liatir_ligand', 'liatir_pose_rank', 'vina_score_kcal_per_mol')}
        if row['liatir_ligand'] == p.get('crystalLigand'):
            row['heavyAtomRmsdAngstrom'] = rdMolAlign.CalcRMS(Chem.RemoveHs(mol), crystal)
        rows.append(row)
    result['poses'] = rows
    result['coordinateSha256'] = __import__('hashlib').sha256(
        ''.join(Chem.MolToMolBlock(mol) for mol in poses).encode()).hexdigest()
if p.get('officialLigandPdbqt'):
    mol = Chem.MolFromMolFile(p['crystal'], removeHs=False)
    ours, ok, error = PDBQTWriterLegacy.write_string(MoleculePreparation().prepare(mol)[0])
    assert ok, error
    def typing(text):
        atoms = [line for line in text.splitlines() if line.startswith(('ATOM', 'HETATM'))]
        torsdof = [line.split()[1] for line in text.splitlines() if line.startswith('TORSDOF')]
        return sorted(line[77:79].strip() for line in atoms), torsdof
    official = open(p['officialLigandPdbqt']).read()
    result['ligandPdbqt'] = {'ours': typing(ours), 'official': typing(official)}
print(json.dumps(result))
`;

try {
  let runtimeEvidence = { kind: 'development-environment', signedPayloadVerified: false };
  if (releasePath) {
    const signedBytes = await readFile(releasePath);
    const release = await verifySignedDocument(JSON.parse(signedBytes), publicPath);
    assert.equal(release.kind, 'liatir.runtime-box.release');
    assert.equal(release.boxId, recipe.boxId);
    assert.equal(release.labels.runtime, recipe.labels.runtime);
    assert.equal(release.version, recipe.version);
    assert.deepEqual(release.target, recipe.target);
    assert.equal(release.provenance.dependencyLockSha256, dependencyLockSha256);
    assert.equal(release.provenance.sourceRevision, SOURCE_REVISION);
    await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
    runtimeEvidence = { kind: 'signed-payload', signedPayloadVerified: true,
      releaseManifestSha256: sha256(signedBytes), archiveSha256: release.archive.sha256,
      payloadDigestSha256: release.payloadDigest.sha256, provenance: release.provenance };
  }
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/molecular-docking/python-scripts/docking.ts'), 'utf8');
  const prefix = 'export const MOLECULAR_DOCKING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product docking script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-docking.py');
  const fixturesPath = join(workDir, 'prepare-fixtures.py');
  const analyzePath = join(workDir, 'analyze.py');
  await writeFile(productPath, productRunner);
  await writeFile(fixturesPath, PREPARE_FIXTURES);
  await writeFile(analyzePath, ANALYZE);
  const raw1iep = join(ROOT, RAW_1IEP.path);
  assert.equal(sha256(await readFile(raw1iep)), RAW_1IEP.sha256, 'Raw 1IEP fixture changed');
  const crystal = join(reference, '1iep_ligand.sdf');
  const fixture = parseResult(await execute(fixturesPath, { root: workDir, crystal }, { measured: false }),
    'Fixture preparation');
  assert.equal(fixture.libraryMolecules, 9);
  const base = { runtimeBoxRelease: recipe.version, targetId };

  async function analyze(input) {
    return parseResult(await execute(analyzePath, { crystal, ...input }, { measured: false }), 'Analysis');
  }

  async function productCase(id, action, input) {
    const payload = { ...base, ...input, outputDir: join(workDir, id) };
    const preflightAction = { 'prepare-receptor': 'preflight-receptor', dock: 'preflight-dock',
      'select-complex': 'preflight-select-complex' }[action];
    const metrics = parseResult(await execute(productPath, { ...payload, action: preflightAction }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action, measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.molecular-docking-result');
    assert.equal(result.action, action);
    assert.equal(result.summary.networkAccess, false);
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    assert.deepEqual(measurement.processTreeMeasurementErrors, []);
    // The runner hands Ringtail to a child process, so the envelope keeps the larger of the parent's
    // own peak and the whole process tree's proportional peak.
    const peakRamBytes = Math.max(measurement.peakRamBytes, measurement.peakProcessTreePssBytes ?? 0);
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes, peakVramBytes: null, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics, measurement: { ...measurement, peakRamBytes }, outputBytes });
    console.error(`docking ${id}: passed`);
    return result;
  }

  async function refused(id, action, input, message) {
    const execution = await execute(productPath, { ...base, ...input, action, measurementMode: true,
      outputDir: join(workDir, id) }, { measured: false });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr}`);
    cases.push({ id, rejected: true, message });
    console.error(`docking ${id}: refused as expected`);
  }

  // Receptor preparation from the official, Reduce-protonated receptor.
  const official = await productCase('official-receptor-preparation', 'prepare-receptor', {
    inputStructure: join(reference, '1iep_receptorH.pdb'), preparation: { removeWaters: true, ph: 7.4 } });
  const officialSteps = official.summary.changes.map((change) => change.step);
  assert.deepEqual(officialSteps, ['remove-input-hydrogens', 'add-missing-atoms', 'add-hydrogens']);
  assert.equal(official.summary.changes[0].count, 2183);
  assert.deepEqual(official.summary.changes[1].residues, []);
  assert.deepEqual(official.summary.changes[1].terminals, [{ residue: 'A:498 GLN', atoms: ['OXT'] }]);
  assert.equal(official.summary.before.heterogens.length, 0);

  // The raw PDB entry, both chains, waters, ions and two copies of imatinib: nothing may disappear
  // unless named, and a residue without a template is refused by name.
  await refused('raw-receptor-unknown-residue', 'prepare-receptor', { inputStructure: raw1iep,
    preparation: { keepChains: ['A'], removeWaters: true, ph: 7.4 } }, 'STI');
  const raw = await productCase('raw-receptor-preparation', 'prepare-receptor', { inputStructure: raw1iep,
    preparation: { keepChains: ['A'], removeWaters: true, removeResidueNames: ['STI'], ph: 7.4 } });
  // Chain A keeps its own ions: the author chain, not the mmCIF label chain each ion is filed under.
  const chainChange = raw.summary.changes.find((change) => change.step === 'remove-chains');
  assert.deepEqual(chainChange.chains, ['B']);
  assert.ok(chainChange.residues.every((item) => item.residue.startsWith('B:')), JSON.stringify(chainChange.residues));
  const removed = raw.summary.changes.find((change) => change.step === 'remove-residues').residues;
  assert.ok(removed.every((item) => item.kind === 'water' || item.residue === 'A:201 STI'),
    `Unrequested residues removed: ${JSON.stringify(removed)}`);
  const keptIons = raw.summary.after.heterogens.filter((item) => item.name === 'CL');
  assert.ok(keptIons.length > 0 && keptIons.every((item) => item.residue.startsWith('A:')), JSON.stringify(keptIons));
  await refused('raw-receptor-absent-residue', 'prepare-receptor', { inputStructure: raw1iep,
    preparation: { removeResidueNames: ['NAG'] } }, 'not in the structure');

  // Ligand preparation against the official solution.
  const parity = await analyze({ officialLigandPdbqt: join(reference, '1iep_ligand.pdbqt') });
  assert.deepEqual(parity.ligandPdbqt.ours, parity.ligandPdbqt.official,
    `Meeko ligand typing differs from the official solution: ${JSON.stringify(parity.ligandPdbqt)}`);

  // Redocking: the official receptor, the receptor prepared here from the same file, and the raw entry.
  const redock = {};
  const redockResults = {};
  for (const [id, receptorPdbqt, receptorStructure] of [
    ['official-redocking', join(reference, '1iep_receptor.pdbqt'), ''],
    ['prepared-redocking', official.paths.receptorPdbqt, official.paths.preparedReceptorPdb],
    ['raw-structure-redocking', raw.paths.receptorPdbqt, raw.paths.preparedReceptorPdb],
  ]) {
    const result = await productCase(id, 'dock', { receptorPdbqt, receptorStructure, ligandsSdf: crystal,
      site: OFFICIAL_BOX, docking: { exhaustiveness: 32, numPoses: 9, seed: 42, cpu: threads } });
    const analysis = await analyze({ poses: result.paths.posesSdf, crystalLigand: 'STI' });
    const top = analysis.poses.find((row) => row.liatir_pose_rank === '1');
    assert.ok(top.heavyAtomRmsdAngstrom <= REDOCKING_RMSD_ANGSTROM,
      `${id}: top pose ${top.heavyAtomRmsdAngstrom} Å from the crystal ligand`);
    const scores = analysis.poses.map((row) => Number(row.vina_score_kcal_per_mol));
    assert.deepEqual(scores, [...scores].sort((left, right) => left - right), `${id}: poses not best-first`);
    assert.equal(Number(top.vina_score_kcal_per_mol), result.summary.ranking[0].scoreKcalPerMol);
    if (receptorStructure) assert.ok(result.paths.bestPoseComplexPdb, `${id}: no receptor-plus-pose complex`);
    redock[id] = { topPoseRmsdAngstrom: top.heavyAtomRmsdAngstrom, topScoreKcalPerMol: Number(top.vina_score_kcal_per_mol),
      poses: analysis.poses.length, coordinateSha256: analysis.coordinateSha256 };
    redockResults[id] = result;
    cases.find((item) => item.id === id).redocking = redock[id];
  }

  // The selected complex hands one pose to a simulation: the receptor it was docked into, then the
  // pose itself with every hydrogen and bond, and the same pose as the ligand's own SDF.
  const selection = { posesSdf: redockResults['prepared-redocking'].paths.posesSdf,
    receptorPdbqt: official.paths.receptorPdbqt, receptorStructure: official.paths.preparedReceptorPdb, ligand: 'STI',
    poseRank: 1 };
  const selected = await productCase('select-complex', 'select-complex', selection);
  assert.equal(selected.summary.complex.ligandAtoms, 69);
  assert.equal(selected.summary.complex.receptorAtoms, official.summary.after.atoms);
  const selectedPose = await analyze({ poses: selected.paths.ligandSdf, crystalLigand: 'STI' });
  assert.equal(selectedPose.poses.length, 1);
  assert.ok(Math.abs(selectedPose.poses[0].heavyAtomRmsdAngstrom - redock['prepared-redocking'].topPoseRmsdAngstrom) < 1e-6);
  const complexLigandLines = (await readFile(selected.paths.complexPdb, 'utf8')).split(/\r?\n/u)
    .filter((line) => line.startsWith('HETATM') && line.slice(17, 20) === 'LIG');
  assert.equal(complexLigandLines.length, 69);
  cases.find((item) => item.id === 'select-complex').complex = selected.summary.complex;
  await refused('select-complex-other-receptor', 'select-complex',
    { ...selection, posesSdf: redockResults['official-redocking'].paths.posesSdf }, 'were not docked into this receptor PDBQT');
  await refused('select-complex-absent-pose', 'select-complex', { ...selection, ligand: 'nilotinib' },
    'hold 0 poses of nilotinib at rank 1');

  // Reproducibility, measured rather than assumed: the same seed and thread count twice, then one thread.
  const reproducibility = {};
  for (const [id, cpu] of [['repeat-a', threads], ['repeat-b', threads], ['repeat-one-thread', 1]]) {
    const result = await productCase(`reproducibility-${id}`, 'dock', { receptorPdbqt: join(reference, '1iep_receptor.pdbqt'),
      ligandsSdf: crystal, site: OFFICIAL_BOX, docking: { exhaustiveness: 8, numPoses: 9, seed: 42, cpu } });
    const analysis = await analyze({ poses: result.paths.posesSdf, crystalLigand: 'STI' });
    reproducibility[id] = { cpu, coordinateSha256: analysis.coordinateSha256,
      scores: analysis.poses.map((row) => Number(row.vina_score_kcal_per_mol)) };
  }
  reproducibility.sameSeedSameThreadsIdentical =
    reproducibility['repeat-a'].coordinateSha256 === reproducibility['repeat-b'].coordinateSha256;
  reproducibility.oneThreadMatchesManyThreads =
    reproducibility['repeat-a'].coordinateSha256 === reproducibility['repeat-one-thread'].coordinateSha256;
  assert.ok(reproducibility.sameSeedSameThreadsIdentical, 'The same seed and thread count gave different poses');

  // A small screen: six dockable molecules and three that must be refused with a reason.
  const batch = await productCase('batch-screen', 'dock', { receptorPdbqt: official.paths.receptorPdbqt,
    receptorStructure: official.paths.preparedReceptorPdb, ligandsSdf: join(workDir, 'library.sdf'),
    site: { mode: 'reference-ligand', referenceLigand: crystal, paddingAngstrom: 5 },
    docking: { exhaustiveness: 8, numPoses: 9, seed: 42, cpu: threads } });
  assert.equal(batch.summary.ligandCount, 9);
  assert.equal(batch.summary.dockedLigands, 6);
  const reasons = Object.fromEntries(batch.summary.rejectedLigands.map((item) => [item.inputName, item.reason]));
  assert.match(reasons['imatinib-2d'], /no 3D coordinates/u);
  assert.match(reasons['imatinib-chloride-salt'], /disconnected fragments/u);
  assert.match(reasons['phenylboronic-acid'], /Elements B/u);
  const ranked = batch.summary.ranking.map((row) => row.ligand);
  assert.ok(ranked.includes('decoy') && ranked.some((name) => /^decoy_\d+$/u.test(name)), `duplicate names: ${ranked}`);
  const withoutHydrogens = batch.summary.ranking.find((row) => row.ligand === 'imatinib-without-hydrogens');
  assert.equal(withoutHydrogens.hydrogensAdded, 32);
  assert.equal(batch.summary.database.storedLigands, 6);
  const csvRows = (await readFile(batch.paths.scoresCsv, 'utf8')).trim().split(/\r?\n/u).length - 1;
  assert.equal(csvRows, batch.summary.poseCount);
  const batchAnalysis = await analyze({ poses: batch.paths.posesSdf, crystalLigand: 'imatinib-crystal' });
  assert.equal(batchAnalysis.poses.length, batch.summary.poseCount);
  cases.find((item) => item.id === 'batch-screen').screen = {
    ranking: batch.summary.ranking.map((row) => ({ ligand: row.ligand, scoreKcalPerMol: row.scoreKcalPerMol })),
    rejected: batch.summary.rejectedLigands,
    crystalTopPoseRmsdAngstrom: batchAnalysis.poses.find((row) => row.liatir_ligand === 'imatinib-crystal'
      && row.liatir_pose_rank === '1').heavyAtomRmsdAngstrom,
  };

  // The database belongs to one experiment.
  const sameExperiment = { receptorPdbqt: official.paths.receptorPdbqt, ligandsSdf: join(workDir, 'late-ligand.sdf'),
    site: { mode: 'reference-ligand', referenceLigand: crystal, paddingAngstrom: 5 },
    docking: { exhaustiveness: 8, numPoses: 9, seed: 42, cpu: threads }, screeningDatabase: batch.paths.screeningDatabase };
  const batchDatabaseBefore = sha256(await readFile(batch.paths.screeningDatabase));
  const appended = await productCase('append-same-experiment', 'dock', sameExperiment);
  assert.equal(appended.summary.database.appended, true);
  assert.equal(appended.summary.database.storedLigands, 7);
  assert.equal(appended.summary.database.sourceSha256, batchDatabaseBefore);
  // Extending writes a new database in the run's own Results and leaves the chosen one untouched.
  assert.notEqual(appended.paths.screeningDatabase, batch.paths.screeningDatabase);
  assert.equal(sha256(await readFile(batch.paths.screeningDatabase)), batchDatabaseBefore);
  await refused('append-different-site', 'dock', { ...sameExperiment, site: { ...sameExperiment.site, paddingAngstrom: 6 } },
    'different docking experiment');
  await refused('append-foreign-database', 'dock', { ...sameExperiment, screeningDatabase: join(workDir, 'foreign.db') },
    'was not created by Liatir');

  // Malformed and mismatched inputs fail before any docking with an actionable message.
  await refused('truncated-ligand-file', 'dock', { ...sameExperiment, screeningDatabase: '',
    ligandsSdf: join(workDir, 'truncated.sdf') }, 'truncated');
  await refused('ligand-as-receptor', 'dock', { ...sameExperiment, screeningDatabase: '',
    receptorPdbqt: join(reference, '1iep_ligand.pdbqt') }, 'torsion records');
  await refused('oversized-box', 'dock', { ...sameExperiment, screeningDatabase: '',
    site: { mode: 'box', center: OFFICIAL_BOX.center, size: [200, 20, 20] } }, 'Box size x');
  await refused('mismatched-receptor-structure', 'dock', { ...sameExperiment, screeningDatabase: '',
    receptorStructure: join(ROOT, MISMATCHED_RECEPTOR) }, 'does not match the receptor PDBQT');

  const validation = { schemaVersion: 1, kind: 'liatir.molecular-docking-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: { officialTopScoreKcalPerMol: OFFICIAL_TOP_SCORE_KCAL_PER_MOL, redockingRmsdAngstrom: REDOCKING_RMSD_ANGSTROM,
      redock, reproducibility, ligandPdbqtParity: parity.ligandPdbqt },
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
    provenance: { recipeId: authoringId, recipeVersion: authoringVersion, pythonVersion: recipe.runtime.version,
      ...builderVersionFields(recipe), dependencyLockSha256 },
    evidence: {
      fixture: { id: 'autodock-vina-1.2.7-basic-docking-1iep', sha256: sha256(await readFile(crystal)),
        rawStructureSha256: RAW_1IEP.sha256 },
      framework: { name: 'autodock-vina', version: '1.2.7', backend: 'cpu' },
      accelerator: { kind: 'cpu' },
      finiteValues: true,
      peakRamBytes: Math.max(...samples.map((sample) => sample.peakRamBytes)),
      peakVramBytes: null,
      outputContract: 'passed', provenanceContract: 'passed',
    },
  };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify(validation, null, 2));
} finally {
  if (keep) console.error(`Preserved docking validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
