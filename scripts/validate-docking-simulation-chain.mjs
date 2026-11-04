#!/usr/bin/env node

/**
 * Docking → Selected Complex → OpenMM → Trajectory Analysis, each step run by the product's own runner
 * inside its own Runtime Box, on the official AutoDock Vina imatinib/c-Abl (1IEP) example.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
// The hydrogen bonds Nagar et al. (Cancer Res. 2002;62:4236) describe for imatinib in this crystal
// structure, as ProLIF names them from the ligand's side: the pyridine accepts from Met318's backbone,
// the aminopyrimidine NH donates to Thr315, the amide NH to Glu286, the amide oxygen accepts from
// Asp381's backbone, and the protonated piperazine donates to the Ile360 carbonyl. The paper describes
// that piperazinium NH as bifurcated between the Ile360 and His361 carbonyls; it has one hydrogen, and
// ProLIF's donor-angle criterion gives it to Ile360 (N-O 2.67 Å). The His361 carbonyl, 3.19 Å away, is
// held as the van der Waals contact ProLIF records instead.
const CRYSTAL_HYDROGEN_BONDS = [
  ['MET318.A', 'HBAcceptor'], ['THR315.A', 'HBDonor'], ['GLU286.A', 'HBDonor'], ['ASP381.A', 'HBAcceptor'],
  ['ILE360.A', 'HBDonor'],
];
const CRYSTAL_BIFURCATED_CONTACT = ['HIS361.A', 'VdWContact'];
// The standard redocking success criterion (decision D6) for the pose taken into the simulation.
const POSE_RMSD_ANGSTROM = 2.0;
// The simulated ligand keeps its binding mode while the hinge contact holds in every saved frame: the
// pyridine nitrogen to Met318's backbone nitrogen is 2.90 Å in the crystal, and 3.5 Å is the donor-
// acceptor distance ProLIF's hydrogen-bond rule accepts. Ligand RMSD is reported, not thresholded: the
// solvent-exposed methylpiperazine moves several ångströms while the rest of imatinib stays in place.
const HINGE_CONTACT_ANGSTROM = 3.5;
const OFFICIAL_BOX = { mode: 'box', center: [15.19, 53.903, 16.917], size: [20, 20, 20] };

assert.equal(process.env.LIATIR_RUNTIME_BOX_RECIPE_ID, undefined,
  'The chain resolves three recipes; unset LIATIR_RUNTIME_BOX_RECIPE_ID.');
const contexts = {
  docking: await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'molecular-docking-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_MOLECULAR_DOCKING_RUNTIME_DIR' }),
  openmm: await loadRuntimeBoxValidatorContext({ root: ROOT,
    defaultRecipeId: process.env.LIATIR_OPENMM_RECIPE_ID ?? 'openmm-linux-x86_64-cuda12.9',
    runtimeDirectoryEnvironment: 'LIATIR_OPENMM_RUNTIME_DIR' }),
  analysis: await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'molecular-analysis-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_MOLECULAR_ANALYSIS_RUNTIME_DIR' }),
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function pathOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(value);
}
const outputPath = pathOption('--output', null);
// Kept after the run: the analysis validator measures its envelope on this OpenMM trajectory.
const runDir = pathOption('--run-dir', null);
assert.ok(runDir, '--run-dir is required');
await rm(runDir, { recursive: true, force: true });
await mkdir(runDir, { recursive: true });
const reference = join(contexts.docking.runtimeDir, 'reference/vina-1iep');
const crystal = join(reference, '1iep_ligand.sdf');

function execute(context, script, payload, timeoutMs = 7_200_000) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(context.python, ['-I', script], { cwd: runDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timeout); resolveResult({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

async function run(context, script, payload, label) {
  const execution = await execute(context, script, { runtimeBoxRelease: context.recipe.version,
    targetId: context.targetId, measurementMode: true, ...payload });
  assert.equal(execution.code, 0, `${label} failed (${execution.signal ?? execution.code}):\n${execution.stderr}`);
  const line = execution.stdout.split(/\r?\n/u).findLast((value) => value.startsWith('{'));
  assert.ok(line, `${label} emitted no structured result`);
  console.error(`chain ${label}: passed`);
  return JSON.parse(line);
}

async function productScript(relative, exportName) {
  const source = await readFile(join(ROOT, relative), 'utf8');
  const prefix = `export const ${exportName} = String.raw\``;
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, `${exportName} is missing`);
  const text = source.slice(start + prefix.length, end);
  const path = join(runDir, `${exportName.toLowerCase()}.py`);
  await writeFile(path, text);
  return { path, sha256: sha256(text) };
}

function csvRows(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/u);
  const names = header.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], value])));
}

const POSE_RMSD = String.raw`
import json, sys
from rdkit import Chem
from rdkit.Chem import rdMolAlign
p = json.load(sys.stdin)
crystal = Chem.RemoveHs(Chem.MolFromMolFile(p['crystal'], removeHs=False))
pose = Chem.RemoveHs(Chem.MolFromMolFile(p['pose'], removeHs=False))
print(json.dumps({'heavyAtomRmsdAngstrom': rdMolAlign.CalcRMS(pose, crystal)}))
`;

const scripts = {
  docking: await productScript('frontend/src/lib/tools/molecular-docking/python-scripts/docking.ts', 'MOLECULAR_DOCKING_SCRIPT'),
  openmm: await productScript('frontend/src/lib/tools/molecular-simulation/python-scripts/openmm.ts', 'OPENMM_SCRIPT'),
  analysis: await productScript('frontend/src/lib/tools/molecular-analysis/python-scripts/analysis.ts', 'MOLECULAR_ANALYSIS_SCRIPT'),
};
const poseRmsdPath = join(runDir, 'pose-rmsd.py');
await writeFile(poseRmsdPath, POSE_RMSD);
const threads = Math.max(1, Math.min(6, cpus().length));

// 1. Receptor preparation and redocking, as a user does them.
const prepared = await run(contexts.docking, scripts.docking.path, { action: 'prepare-receptor',
  outputDir: join(runDir, 'receptor'), inputStructure: join(reference, '1iep_receptorH.pdb'),
  preparation: { removeWaters: true, ph: 7.4 } }, 'receptor preparation');
const docked = await run(contexts.docking, scripts.docking.path, { action: 'dock', outputDir: join(runDir, 'docking'),
  receptorPdbqt: prepared.paths.receptorPdbqt, receptorStructure: prepared.paths.preparedReceptorPdb,
  ligandsSdf: crystal, site: OFFICIAL_BOX, docking: { exhaustiveness: 32, numPoses: 9, seed: 42, cpu: threads } },
'redocking');

// 2. The selected complex: the best pose of imatinib with the receptor it was docked into.
const selected = await run(contexts.docking, scripts.docking.path, { action: 'select-complex',
  outputDir: join(runDir, 'complex'), posesSdf: docked.paths.posesSdf, receptorPdbqt: prepared.paths.receptorPdbqt,
  receptorStructure: prepared.paths.preparedReceptorPdb, ligand: 'STI', poseRank: 1 }, 'selected complex');
const poseRmsd = JSON.parse(execFileSync(contexts.docking.python, ['-I', poseRmsdPath],
  { input: JSON.stringify({ crystal, pose: selected.paths.ligandSdf }), encoding: 'utf8' }));
assert.ok(poseRmsd.heavyAtomRmsdAngstrom <= POSE_RMSD_ANGSTROM, `Selected pose ${poseRmsd.heavyAtomRmsdAngstrom} Å from the crystal`);
assert.equal(selected.summary.complex.ligandAtoms, 69);

// 3. The crystal complex and the selected pose as interaction fingerprints, against the literature.
const crystalFingerprint = await run(contexts.analysis, scripts.analysis.path, { action: 'fingerprint', source: 'poses',
  outputDir: join(runDir, 'crystal-fingerprint'), receptor: prepared.paths.preparedReceptorPdb, poses: crystal },
'crystal-pose fingerprint');
const poseFingerprint = await run(contexts.analysis, scripts.analysis.path, { action: 'fingerprint', source: 'poses',
  outputDir: join(runDir, 'pose-fingerprint'), receptor: prepared.paths.preparedReceptorPdb, poses: selected.paths.ligandSdf },
'docked-pose fingerprint');
const pairs = async (path) => new Set(csvRows(await readFile(path, 'utf8'))
  .map((row) => `${row['Protein residue']}|${row.Interaction}`));
const crystalPairs = await pairs(crystalFingerprint.paths.interactionsCsv);
const posePairs = await pairs(poseFingerprint.paths.interactionsCsv);
for (const [residue, interaction] of [...CRYSTAL_HYDROGEN_BONDS, CRYSTAL_BIFURCATED_CONTACT]) {
  assert.ok(crystalPairs.has(`${residue}|${interaction}`), `Crystal pose lacks ${interaction} with ${residue}`);
}
const poseRecovered = CRYSTAL_HYDROGEN_BONDS.filter(([residue, interaction]) => posePairs.has(`${residue}|${interaction}`));

// 4. OpenMM: the complex in explicit water at constant pressure, the ligand parameterized from its own SDF.
const accelerator = contexts.openmm.recipe.target.accelerator;
const simulation = await run(contexts.openmm, scripts.openmm.path, { action: 'run', mode: 'dynamics',
  outputDir: join(runDir, 'openmm'), runtimePath: contexts.openmm.runtimeDir, accelerator,
  inputStructure: selected.paths.complexPdb, ligandSdf: selected.paths.ligandSdf,
  preparation: { addHydrogens: false, ph: 7.4, solvent: 'tip3p-fb', solventPaddingNm: 1, ionicStrengthM: 0.15 },
  dynamics: { preset: 'short-100ps', temperatureKelvin: 300, saveIntervalPs: 2, seed: 17, pressureBar: 1 } },
'OpenMM dynamics');
assert.equal(simulation.summary.frameCount, 50);
assert.equal(simulation.summary.ligandAtomCount, 69);
assert.equal(simulation.summary.forceField.ligand, 'openff-2.3.0');
const chainRun = { identity: { complexSha256: sha256(await readFile(selected.paths.complexPdb)),
  ligandSha256: sha256(await readFile(selected.paths.ligandSdf)),
  trajectorySha256: sha256(await readFile(simulation.paths.trajectoryDcdPath)) },
paths: { ...simulation.paths, ligandSdf: selected.paths.ligandSdf } };
await writeFile(join(runDir, 'chain-run.json'), JSON.stringify(chainRun, null, 2) + '\n');

// 5. The trajectory read back with its own time record, and the ligand's contacts through it.
const trajectory = await run(contexts.analysis, scripts.analysis.path, { action: 'analyze-trajectory',
  outputDir: join(runDir, 'analysis'), topology: simulation.paths.topologyPdbPath,
  trajectory: simulation.paths.trajectoryDcdPath, stateCsv: simulation.paths.stateCsvPath,
  analysis: { rmsd: [{ label: 'Protein C-alpha', selection: 'protein and name CA' },
    { label: 'Ligand', selection: 'resname LIG and not element H' }],
  distances: [{ label: 'Ligand to Met318 backbone N', selectionA: 'resname LIG and not element H',
    selectionB: 'protein and resid 318 and name N' }] } }, 'trajectory analysis');
assert.equal(trajectory.summary.stateRecordChecked, true);
assert.equal(trajectory.summary.periodic, true);
const hinge = trajectory.summary.distances.find((item) => item.label === 'Ligand to Met318 backbone N').minimumDistance;
assert.ok(hinge.maximum <= HINGE_CONTACT_ANGSTROM, `The hinge contact broke: ${hinge.maximum} Å`);
const contacts = await run(contexts.analysis, scripts.analysis.path, { action: 'fingerprint', source: 'trajectory',
  outputDir: join(runDir, 'trajectory-fingerprint'), topology: simulation.paths.topologyPdbPath,
  trajectory: simulation.paths.trajectoryDcdPath, ligandReferenceSdf: selected.paths.ligandSdf,
  fingerprint: { ligandSelection: 'resname LIG' } }, 'trajectory fingerprint');
assert.ok(contacts.summary.ligandReference, 'The simulated ligand was not checked against the docked molecule');
const frequencies = Object.fromEntries(csvRows(await readFile(contacts.paths.frequenciesCsv, 'utf8'))
  .map((row) => [`${row['Protein residue']}|${row.Interaction}`, Number(row.Fraction)]));
const persistence = Object.fromEntries(CRYSTAL_HYDROGEN_BONDS.map(([residue, interaction]) =>
  [`${residue} ${interaction}`, frequencies[`${residue}|${interaction}`] ?? 0]));
assert.ok(persistence['MET318.A HBAcceptor'] >= 0.5, `The hinge hydrogen bond held in ${persistence['MET318.A HBAcceptor']} of frames`);

const record = {
  schemaVersion: 1,
  kind: 'liatir.docking-simulation-chain-validation',
  createdAt: new Date().toISOString(),
  status: 'passed',
  boxes: Object.fromEntries(Object.entries(contexts).map(([name, context]) => [name, {
    recipeId: context.authoringId, version: context.recipe.version, targetId: context.targetId,
    dependencyLockSha256: context.dependencyLockSha256, productRunnerSha256: scripts[name].sha256 }])),
  reference: { fixture: 'autodock-vina-1.2.7-basic-docking-1iep', crystalLigandSha256: sha256(await readFile(crystal)),
    crystalHydrogenBonds: CRYSTAL_HYDROGEN_BONDS, crystalBifurcatedContact: CRYSTAL_BIFURCATED_CONTACT,
    source: 'Nagar et al., Cancer Res. 2002;62:4236-4243',
    poseRmsdAngstrom: POSE_RMSD_ANGSTROM, hingeContactAngstrom: HINGE_CONTACT_ANGSTROM },
  docking: { topScoreKcalPerMol: docked.summary.ranking[0].scoreKcalPerMol,
    selectedPoseRmsdAngstrom: poseRmsd.heavyAtomRmsdAngstrom, complex: selected.summary.complex },
  fingerprints: { crystalPose: [...crystalPairs].sort(), dockedPoseRecovers: poseRecovered.map((item) => item.join(' ')) },
  simulation: { platform: simulation.summary.platform, accelerator, preparedAtomCount: simulation.summary.preparedAtomCount,
    forceField: simulation.summary.forceField, durationPs: simulation.summary.durationPs, frameCount: simulation.summary.frameCount,
    gpuModel: simulation.summary.gpuModel ?? null, identity: chainRun.identity },
  trajectory: { rmsd: trajectory.summary.rmsd, rmsf: trajectory.summary.rmsf, distances: trajectory.summary.distances,
    stateRecordChecked: true, periodicTreatment: trajectory.summary.periodicTreatment },
  contacts: { ligandReference: contacts.summary.ligandReference, persistence, mostFrequent: contacts.summary.mostFrequent.slice(0, 15),
    bonds: contacts.summary.bonds },
  measurementHost: { platform: platform(), arch: arch(), osRelease: osRelease(), cpuModel: cpus()[0]?.model ?? null,
    logicalCpuCount: cpus().length, totalMemoryBytes: totalmem() },
  validatorSource: {
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    sourceTreeDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
      { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
    scriptSha256: sha256(await readFile(import.meta.filename)),
  },
};
if (outputPath) await writeFile(outputPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record, null, 2));
