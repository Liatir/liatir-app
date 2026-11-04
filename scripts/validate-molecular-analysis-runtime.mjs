#!/usr/bin/env node

/** Exercise the exact offline analysis runner against ProLIF's own reference data and test vectors. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { builderVersionFields } from 'scrollcase/build';
import { verifyExtractedPayload } from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REVISION = 'mdanalysis-2.11.0+prolif-2.2.3+rdkit-2026.09.1';
const COMPONENT_ID = 'mdanalysis-molecular-analysis';
// Coordinates are stored as 32-bit floats and the runner prints four decimals.
const LENGTH_TOLERANCE_ANGSTROM = 1e-3;
// Interactions ProLIF 2.2.3's own tests pin on its packaged trajectory (tests/test_fingerprint.py,
// test_run_residues): frame, ligand residue, protein residue, interaction.
const PROLIF_TRAJECTORY_ANCHORS = [
  [0, 'LIG1.G', 'VAL201.A', 'Hydrophobic'],
  [0, 'LIG1.G', 'PHE351.B', 'Hydrophobic'],
  [1, 'LIG1.G', 'MET337.B', 'Hydrophobic'],
];

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'molecular-analysis-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_MOLECULAR_ANALYSIS_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
assert.equal(recipe.target.accelerator, 'cpu');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-analysis-validation-'));
const keep = process.argv.includes('--keep-work-dir');
function pathOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(value);
}
const outputPath = pathOption('--output');
const releasePath = pathOption('--release-document');
const publicPath = pathOption('--public-key');
// The Results directory of an OpenMM dynamics run of a docked complex (scripts/validate-docking-simulation-chain.mjs).
const openmmRun = pathOption('--openmm-run');
assert.equal(Boolean(releasePath), Boolean(publicPath), '--release-document and --public-key are required together');
const measurementPath = join(ROOT, 'scripts/runtime-box/measure-python.py');
const data = join(runtimeDir, 'venv/lib/python3.11/site-packages/prolif/data');
const samples = [];
const cases = [];

function execute(script, payload, { measured = true, timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const args = measured ? [measurementPath, '--accelerator', 'cpu', script] : ['-I', script];
    const child = spawn(python, args, { cwd: workDir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
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

function csvRows(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/u);
  const names = header.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], value])));
}

// ProLIF's own interaction test vectors (tests/test_interactions.py at v2.2.3), loaded exactly as its
// conftest.py loads them, and evaluated the way its test does.
const OFFICIAL_VECTORS = String.raw`
import json, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
from MDAnalysis import Universe
try:
    from MDAnalysis.topology.guessers import guess_atom_element
except ImportError:
    from MDAnalysis.guesser.default_guesser import DefaultGuesser
    guess_atom_element = DefaultGuesser(None).guess_atom_element
from rdkit import Chem
from prolif import Fingerprint
from prolif.datafiles import datapath
from prolif.molecule import Molecule, sdf_supplier

def from_mol2(filename):
    u = Universe(str(datapath / filename))
    u.add_TopologyAttr('elements', np.array([guess_atom_element(n) for n in u.atoms.names], dtype=object))
    u.atoms.types = np.array([x.upper() for x in u.atoms.types], dtype=object)
    return Molecule.from_mda(u, force=True)

files = {'benzene': 'benzene.mol2', 'cation': 'cation.mol2', 'cation_false': 'cation_false.mol2',
         'anion': 'anion.mol2', 'ftf': 'facetoface.mol2', 'etf': 'edgetoface.mol2', 'chlorine': 'chlorine.mol2',
         'bromine': 'bromine.mol2', 'hb_donor': 'donor.mol2', 'hb_acceptor': 'acceptor.mol2',
         'hb_acceptor_false': 'acceptor_false.mol2', 'xb_donor': 'xbond_donor.mol2',
         'xb_acceptor': 'xbond_acceptor.mol2', 'xb_acceptor_false_xar': 'xbond_acceptor_false_xar.mol2',
         'xb_acceptor_false_axd': 'xbond_acceptor_false_axd.mol2', 'ligand': 'ligand.mol2', 'metal': 'metal.mol2',
         'metal_false': 'metal_false.mol2'}
molecules = {name: from_mol2(path) for name, path in files.items()}
ihb_protein = Molecule.from_rdkit(Chem.MolFromPDBFile(str(datapath / 'implicitHbond' / 'receptor.pdb')))
molecules['ihb_ligand'] = sdf_supplier(str(datapath / 'implicitHbond' / '1.D.sdf'))[0]
molecules['ihb_acceptor_tyr167b'] = Molecule(ihb_protein['TYR167.B'])
molecules['ihb_asp95a'] = Molecule(ihb_protein['ASP95.A'])
cases = json.load(sys.stdin)['cases']
fingerprint = Fingerprint(Fingerprint.list_available())
results = []
for func_name, any_mol, any_other_mol, expected in cases:
    interaction = getattr(fingerprint, func_name)
    found = next(interaction(molecules[any_mol][0], molecules[any_other_mol][0]), False)
    results.append({'case': [func_name, any_mol, any_other_mol, expected], 'passed': found is expected})
print(json.dumps({'results': results}))
`;
const OFFICIAL_CASES = [
  ['cationic', 'cation', 'anion', true], ['cationic', 'anion', 'cation', false], ['cationic', 'cation', 'benzene', false],
  ['anionic', 'cation', 'anion', false], ['anionic', 'anion', 'cation', true], ['anionic', 'anion', 'benzene', false],
  ['cationpi', 'cation', 'benzene', true], ['cationpi', 'cation_false', 'benzene', false],
  ['cationpi', 'benzene', 'cation', false], ['cationpi', 'cation', 'cation', false],
  ['cationpi', 'benzene', 'benzene', false], ['pication', 'benzene', 'cation', true],
  ['pication', 'benzene', 'cation_false', false], ['pication', 'cation', 'benzene', false],
  ['pication', 'cation', 'cation', false], ['pication', 'benzene', 'benzene', false],
  ['pistacking', 'benzene', 'etf', true], ['pistacking', 'etf', 'benzene', true], ['pistacking', 'ftf', 'benzene', true],
  ['pistacking', 'benzene', 'ftf', true], ['facetoface', 'benzene', 'ftf', true], ['facetoface', 'ftf', 'benzene', true],
  ['facetoface', 'benzene', 'etf', false], ['facetoface', 'etf', 'benzene', false], ['edgetoface', 'benzene', 'etf', true],
  ['edgetoface', 'etf', 'benzene', true], ['edgetoface', 'benzene', 'ftf', false], ['edgetoface', 'ftf', 'benzene', false],
  ['hydrophobic', 'benzene', 'etf', true], ['hydrophobic', 'benzene', 'ftf', true],
  ['hydrophobic', 'benzene', 'chlorine', false], ['hydrophobic', 'benzene', 'bromine', true],
  ['hydrophobic', 'benzene', 'anion', false], ['hydrophobic', 'benzene', 'cation', false],
  ['hbdonor', 'hb_donor', 'hb_acceptor', true], ['hbdonor', 'hb_donor', 'hb_acceptor_false', false],
  ['hbdonor', 'hb_acceptor', 'hb_donor', false], ['hbacceptor', 'hb_acceptor', 'hb_donor', true],
  ['hbacceptor', 'hb_acceptor_false', 'hb_donor', false], ['hbacceptor', 'hb_donor', 'hb_acceptor', false],
  ['xbdonor', 'xb_donor', 'xb_acceptor', true], ['xbdonor', 'xb_donor', 'xb_acceptor_false_xar', false],
  ['xbdonor', 'xb_donor', 'xb_acceptor_false_axd', false], ['xbdonor', 'xb_acceptor', 'xb_donor', false],
  ['xbacceptor', 'xb_acceptor', 'xb_donor', true], ['xbacceptor', 'xb_acceptor_false_xar', 'xb_donor', false],
  ['xbacceptor', 'xb_acceptor_false_axd', 'xb_donor', false], ['xbacceptor', 'xb_donor', 'xb_acceptor', false],
  ['metaldonor', 'metal', 'ligand', true], ['metaldonor', 'metal_false', 'ligand', false],
  ['metaldonor', 'ligand', 'metal', false], ['metalacceptor', 'ligand', 'metal', true],
  ['metalacceptor', 'ligand', 'metal_false', false], ['metalacceptor', 'metal', 'ligand', false],
  ['vdwcontact', 'benzene', 'etf', true], ['vdwcontact', 'hb_acceptor', 'metal_false', false],
  ['implicithbacceptor', 'ihb_asp95a', 'ihb_ligand', true], ['implicithbacceptor', 'ihb_acceptor_tyr167b', 'ihb_ligand', true],
  ['implicithbacceptor', 'ihb_ligand', 'ihb_acceptor_tyr167b', false], ['implicithbdonor', 'ihb_ligand', 'ihb_asp95a', true],
  ['implicithbdonor', 'ihb_ligand', 'ihb_acceptor_tyr167b', true],
];

// Inputs derived from ProLIF's packaged data inside the payload's own Python: the same trajectory as
// DCD, damaged and stripped copies for refusals, and topologies with some or all bond records removed.
// The helpers read copies: MDAnalysis caches XTC offsets beside the file it opens, and the payload's
// own files are left for the product runner, which must never write there.
const PREPARE_FIXTURES = String.raw`
import json, pathlib, shutil, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
import MDAnalysis as mda
from rdkit import Chem
import prolif
p = json.load(sys.stdin)
root, data = pathlib.Path(p['root']), pathlib.Path(p['data'])
for name in ('top.pdb', 'traj.xtc'):
    shutil.copyfile(data / name, root / ('copy-' + name))
u = mda.Universe(str(root / 'copy-top.pdb'), str(root / 'copy-traj.xtc'))
with mda.Writer(str(root / 'traj.dcd'), u.atoms.n_atoms) as writer:
    for ts in u.trajectory:
        writer.write(u.atoms)
with mda.Writer(str(root / 'nonfinite.dcd'), u.atoms.n_atoms) as writer:
    for ts in u.trajectory[:3]:
        if ts.frame == 2:
            positions = u.atoms.positions
            positions[10, 0] = np.nan
            u.atoms.positions = positions
        writer.write(u.atoms)
raw = (root / 'traj.dcd').read_bytes()
(root / 'truncated.dcd').write_bytes(raw[:-100])
xtc = (data / 'traj.xtc').read_bytes()
(root / 'truncated.xtc').write_bytes(xtc[:len(xtc) // 2 + 7])
top = (data / 'top.pdb').read_text().splitlines()
serials = {line[6:11].strip() for line in top if line.startswith(('ATOM', 'HETATM')) and line[17:21].strip() == 'LIG'}
def conect_fields(line):
    return {line[start:start + 5].strip() for start in range(6, min(len(line), 31), 5) if line[start:start + 5].strip()}
(root / 'top-no-bonds.pdb').write_text('\n'.join(line for line in top if not line.startswith('CONECT')) + '\n')
(root / 'top-ligand-bonds.pdb').write_text('\n'.join(line for line in top if not line.startswith('CONECT')
                                                  or conect_fields(line) <= serials) + '\n')
receptor = (data / 'vina' / 'rec.pdb').read_text().splitlines()
(root / 'rec-no-bonds.pdb').write_text('\n'.join(line for line in receptor if not line.startswith('CONECT')) + '\n')
(root / 'rec-no-hydrogens.pdb').write_text('\n'.join(line for line in receptor if not (
    line.startswith(('ATOM', 'HETATM')) and line[76:78].strip() == 'H') and not line.startswith('CONECT')) + '\n')
with Chem.SDWriter(str(root / 'poses-no-hydrogens.sdf')) as writer:
    for mol in Chem.SDMolSupplier(str(data / 'vina' / 'vina_output.sdf'), removeHs=False):
        writer.write(Chem.RemoveHs(mol))
ligand = prolif.Molecule.from_mda(u.select_atoms('resname LIG'))
with Chem.SDWriter(str(root / 'ligand-reference.sdf')) as writer:
    writer.write(Chem.Mol(ligand))
with Chem.SDWriter(str(root / 'other-molecule.sdf')) as writer:
    writer.write(Chem.AddHs(Chem.MolFromSmiles('c1ccccc1O'), addCoords=False))
print(json.dumps({'frames': u.trajectory.n_frames, 'atoms': u.atoms.n_atoms}))
`;

// An independent computation of what the runner reports: unwrapping by the published Kulke and
// Vermaas recurrence on an orthorhombic box, Kabsch superposition by SVD, population RMSF and
// minimum-image distances, all in NumPy without MDAnalysis's analysis code.
const REFERENCE = String.raw`
import json, sys, warnings
warnings.filterwarnings('ignore')
import numpy as np
import MDAnalysis as mda
p = json.load(sys.stdin)
u = mda.Universe(p['topology'], p['trajectory'])
pick = lambda text: u.select_atoms(text).indices
fit, groups, rmsf_atoms = pick(p['fit']), [pick(text) for text in p['rmsd']], pick(p['rmsf'])
pairs = [(pick(a), pick(b)) for a, b in p['distances']]
start, stop, stride = p['start'], p['stop'], p['stride']
previous_raw = previous = None
kept = []
for ts in u.trajectory[:stop]:
    raw = u.atoms.positions.astype(np.float64)
    lengths = ts.dimensions[:3].astype(np.float64)
    assert np.allclose(ts.dimensions[3:], 90.0)
    current = raw.copy() if previous is None else previous + (raw - previous_raw) - lengths * np.floor(
        (raw - previous_raw) / lengths + 0.5)
    previous_raw, previous = raw, current
    if ts.frame >= start and (ts.frame - start) % stride == 0:
        kept.append((ts.frame, current.copy(), lengths))
reference = kept[0][1]
ref_center = reference[fit].mean(axis=0)
rows, aligned_rmsf = [], []
def image(vector, lengths):
    return vector - lengths * np.round(vector / lengths)
for frame, x, lengths in kept:
    center = x[fit].mean(axis=0)
    h = (x[fit] - center).T @ (reference[fit] - ref_center)
    left, _, right = np.linalg.svd(h)
    sign = np.sign(np.linalg.det(right.T @ left.T))
    rotation = right.T @ np.diag([1.0, 1.0, sign]) @ left.T
    aligned = (x - center) @ rotation.T + ref_center
    row = [float(np.sqrt(((aligned[g] - reference[g]) ** 2).sum() / len(g))) for g in groups]
    for a, b in pairs:
        deltas = image(x[a][:, None, :] - x[b][None, :, :], lengths)
        row.append(float(np.sqrt((deltas ** 2).sum(axis=2)).min()))
        row.append(float(np.linalg.norm(image(x[a].mean(axis=0) - x[b].mean(axis=0), lengths))))
    rows.append([frame] + row)
    aligned_rmsf.append(aligned[rmsf_atoms])
stack = np.array(aligned_rmsf)
rmsf = np.sqrt(((stack - stack.mean(axis=0)) ** 2).sum(axis=2).mean(axis=0))
print(json.dumps({'rows': rows, 'rmsf': rmsf.tolist()}))
`;

// ProLIF run directly the way its documentation shows, on untransformed coordinates.
const DIRECT_PROLIF = String.raw`
import json, sys, warnings
warnings.filterwarnings('ignore')
import MDAnalysis as mda
import prolif
from prolif.molecule import sdf_supplier
p = json.load(sys.stdin)
fp = prolif.Fingerprint()
if p['source'] == 'trajectory':
    u = mda.Universe(p['topology'], p['trajectory'])
    fp.run(u.trajectory[p['start']:p['stop']:p['stride']], u.select_atoms(p['ligand']), u.select_atoms('protein'),
           progress=False, n_jobs=1)
    offset = 0
else:
    protein = prolif.Molecule.from_mda(mda.Universe(p['receptor']).select_atoms('protein'))
    fp.run_from_iterable(list(sdf_supplier(p['poses'])), protein, progress=False, n_jobs=1)
    offset = 1
rows = sorted([key + offset, str(l), str(r), name] for key, found in fp.ifp.items() for (l, r), names in found.items()
              for name in names)
print(json.dumps({'rows': rows}))
`;

// Bonds the runner's own function derives from distances against the bonds a file records.
const BOND_PERCEPTION = String.raw`
import importlib.util, json, sys, warnings
warnings.filterwarnings('ignore')
import MDAnalysis as mda
p = json.load(sys.stdin)
spec = importlib.util.spec_from_file_location('product_analysis', p['product'])
product = importlib.util.module_from_spec(spec)
spec.loader.exec_module(product)
recorded = mda.Universe(p['withBonds'])
derived = mda.Universe(p['withoutBonds'])
assert product.ensure_protein_bonds(derived, derived.select_atoms('protein')) == 'distance-derived'
def bonds(universe):
    atoms = set(universe.select_atoms('protein').indices)
    return sorted(sorted(map(int, pair)) for pair in universe.bonds.indices if set(map(int, pair)) <= atoms)
expected, found = bonds(recorded), bonds(derived)
print(json.dumps({'recorded': len(expected), 'derived': len(found), 'identical': expected == found}))
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
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/molecular-analysis/python-scripts/analysis.ts'), 'utf8');
  const prefix = 'export const MOLECULAR_ANALYSIS_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product analysis script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-analysis.py');
  await writeFile(productPath, productRunner);
  const helpers = {};
  for (const [name, text] of Object.entries({ OFFICIAL_VECTORS, PREPARE_FIXTURES, REFERENCE, DIRECT_PROLIF,
    BOND_PERCEPTION })) {
    helpers[name] = join(workDir, `${name.toLowerCase()}.py`);
    await writeFile(helpers[name], text);
  }
  const helper = async (name, payload) => parseResult(await execute(helpers[name], payload, { measured: false }), name);
  const fixture = await helper('PREPARE_FIXTURES', { root: workDir, data });
  assert.deepEqual(fixture, { frames: 250, atoms: 5067 });
  const topology = join(data, 'top.pdb');
  const xtc = join(data, 'traj.xtc');
  const copies = { topology: join(workDir, 'copy-top.pdb'), trajectory: join(workDir, 'copy-traj.xtc') };
  const base = { runtimeBoxRelease: recipe.version, targetId };

  async function productCase(id, action, input) {
    const payload = { ...base, ...input, outputDir: join(workDir, id) };
    const preflightAction = action === 'analyze-trajectory' ? 'preflight-trajectory' : 'preflight-fingerprint';
    const metrics = parseResult(await execute(productPath, { ...payload, action: preflightAction }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action, measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.molecular-analysis-result');
    assert.equal(result.action, action);
    assert.equal(result.summary.networkAccess, false);
    assert.equal(result.summary.runtimeId, recipe.labels.runtime);
    assert.deepEqual(result.summary.versions, { MDAnalysis: '2.11.0', prolif: '2.2.3', rdkit: '2026.9.1' });
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes: measurement.peakRamBytes, peakVramBytes: null, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics: { workloadId: metrics.workloadId, tokenCount: metrics.tokenCount,
      atomCount: metrics.atomCount, stepCount: metrics.stepCount, outputItemCount: metrics.outputItemCount },
    measurement, outputBytes });
    console.error(`analysis ${id}: passed`);
    return result;
  }

  async function refused(id, action, input, message) {
    const execution = await execute(productPath, { ...base, ...input, action, measurementMode: true,
      outputDir: join(workDir, id) }, { measured: false });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr}`);
    cases.push({ id, rejected: true, message });
    console.error(`analysis ${id}: refused as expected`);
  }

  // 1. ProLIF's own interaction test vectors inside the signed payload.
  const vectors = await helper('OFFICIAL_VECTORS', { cases: OFFICIAL_CASES });
  const failedVectors = vectors.results.filter((item) => !item.passed);
  assert.deepEqual(failedVectors, [], `ProLIF test vectors failed: ${JSON.stringify(failedVectors)}`);
  cases.push({ id: 'prolif-official-interaction-vectors', vectors: vectors.results.length, passed: vectors.results.length });

  // 2. Trajectory measures against the independent NumPy computation, on XTC and on the same frames as DCD.
  const analysis = {
    fitSelection: 'protein and name CA',
    rmsd: [{ label: 'Protein C-alpha', selection: 'protein and name CA' },
      { label: 'Ligand', selection: 'resname LIG and not element H' }],
    rmsf: { selection: 'protein and name CA' },
    distances: [{ label: 'Ligand to ASP129', selectionA: 'resname LIG', selectionB: 'resid 129 and chainID A' }],
  };
  const referenceInput = { ...copies, fit: analysis.fitSelection,
    rmsd: analysis.rmsd.map((item) => item.selection), rmsf: analysis.rmsf.selection,
    distances: analysis.distances.map((item) => [item.selectionA, item.selectionB]), start: 0, stop: 250, stride: 1 };
  const independent = await helper('REFERENCE', referenceInput);
  const comparison = {};
  for (const [id, trajectory] of [['reference-trajectory-analysis-xtc', xtc],
    ['reference-trajectory-analysis-dcd', join(workDir, 'traj.dcd')]]) {
    const result = await productCase(id, 'analyze-trajectory', { topology, trajectory, analysis });
    assert.equal(result.summary.periodic, true);
    assert.equal(result.summary.framesAnalysed, 250);
    const rmsd = csvRows(await readFile(result.paths.rmsdCsv, 'utf8'));
    const distances = csvRows(await readFile(result.paths.distancesCsv, 'utf8'));
    const rmsf = csvRows(await readFile(result.paths.rmsfCsv, 'utf8'));
    let worst = 0;
    independent.rows.forEach((row, index) => {
      const ours = [Number(rmsd[index]['Protein C-alpha RMSD (Å)']), Number(rmsd[index]['Ligand RMSD (Å)']),
        Number(distances[index]['Ligand to ASP129 minimum distance (Å)']),
        Number(distances[index]['Ligand to ASP129 centroid distance (Å)'])];
      assert.equal(Number(rmsd[index].Frame), row[0]);
      ours.forEach((value, column) => { worst = Math.max(worst, Math.abs(value - row[column + 1])); });
    });
    independent.rmsf.forEach((value, index) => { worst = Math.max(worst, Math.abs(Number(rmsf[index]['RMSF (Å)']) - value)); });
    assert.ok(worst <= LENGTH_TOLERANCE_ANGSTROM, `${id}: differs from the independent computation by ${worst} Å`);
    comparison[id] = { maxAbsoluteDifferenceAngstrom: worst, rmsd: result.summary.rmsd, rmsf: result.summary.rmsf,
      rmsdCsvSha256: sha256(await readFile(result.paths.rmsdCsv)) };
    cases.find((item) => item.id === id).independentComparison = comparison[id];
  }
  const strided = await productCase('reference-trajectory-analysis-strided', 'analyze-trajectory',
    { topology, trajectory: xtc, analysis: { ...analysis, start: 3, stride: 7 } });
  const stridedIndependent = await helper('REFERENCE', { ...referenceInput, start: 3, stride: 7 });
  const stridedRows = csvRows(await readFile(strided.paths.rmsdCsv, 'utf8'));
  assert.equal(stridedRows.length, stridedIndependent.rows.length);
  stridedIndependent.rows.forEach((row, index) => {
    assert.equal(Number(stridedRows[index].Frame), row[0]);
    assert.ok(Math.abs(Number(stridedRows[index]['Ligand RMSD (Å)']) - row[2]) <= LENGTH_TOLERANCE_ANGSTROM);
  });

  // 3. Reproducibility: the same request twice gives byte-identical tables.
  const repeat = await productCase('reference-trajectory-analysis-repeat', 'analyze-trajectory',
    { topology, trajectory: xtc, analysis });
  assert.equal(sha256(await readFile(repeat.paths.rmsdCsv)), comparison['reference-trajectory-analysis-xtc'].rmsdCsvSha256);

  // 4. Interaction fingerprints: ProLIF's pinned anchors, identity with a direct ProLIF run, and the
  // same result when the protein's bonds are derived from distances instead of read from the file.
  const fingerprintRows = async (path) => csvRows(await readFile(path, 'utf8')).map((row) => [
    Number(row.Frame ?? row.Pose), row['Ligand residue'], row['Protein residue'], row.Interaction]).sort();
  const sameRows = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  const trajectoryFingerprint = await productCase('reference-trajectory-fingerprint', 'fingerprint', { source: 'trajectory',
    topology, trajectory: xtc, fingerprint: { ligandSelection: 'resname LIG', stride: 1 } });
  const ours = await fingerprintRows(trajectoryFingerprint.paths.interactionsCsv);
  for (const anchor of PROLIF_TRAJECTORY_ANCHORS) {
    assert.ok(ours.some((row) => JSON.stringify(row) === JSON.stringify(anchor)), `ProLIF anchor missing: ${anchor}`);
  }
  const direct = await helper('DIRECT_PROLIF', { source: 'trajectory', ...copies, ligand: 'resname LIG',
    start: 0, stop: 250, stride: 1 });
  assert.ok(sameRows(ours, direct.rows), 'The runner and a direct ProLIF run disagree on the reference trajectory');
  const ligandBonds = await productCase('derived-protein-bonds-trajectory-fingerprint', 'fingerprint', { source: 'trajectory',
    topology: join(workDir, 'top-ligand-bonds.pdb'), trajectory: xtc,
    ligandReferenceSdf: join(workDir, 'ligand-reference.sdf'), fingerprint: { ligandSelection: 'resname LIG', stride: 10 } });
  assert.equal(ligandBonds.summary.bonds.protein, 'distance-derived');
  assert.ok(ligandBonds.summary.ligandReference, 'The ligand reference was not recorded');
  const everyTenth = ours.filter((row) => row[0] % 10 === 0);
  assert.ok(sameRows(await fingerprintRows(ligandBonds.paths.interactionsCsv), everyTenth),
    'Distance-derived protein bonds changed the fingerprint');
  const trajectoryBonds = await helper('BOND_PERCEPTION', { product: productPath, withBonds: topology,
    withoutBonds: join(workDir, 'top-no-bonds.pdb') });
  assert.ok(trajectoryBonds.identical, `Derived protein bonds differ from the recorded ones: ${JSON.stringify(trajectoryBonds)}`);

  const poses = { source: 'poses', receptor: join(data, 'vina/rec.pdb'), poses: join(data, 'vina/vina_output.sdf') };
  const poseFingerprint = await productCase('reference-poses-fingerprint', 'fingerprint', poses);
  const poseRows = await fingerprintRows(poseFingerprint.paths.interactionsCsv);
  const directPoses = await helper('DIRECT_PROLIF', poses);
  assert.ok(sameRows(poseRows, directPoses.rows), 'The runner and a direct ProLIF run disagree on the Vina poses');
  const derivedPoses = await productCase('derived-protein-bonds-poses-fingerprint', 'fingerprint',
    { ...poses, receptor: join(workDir, 'rec-no-bonds.pdb') });
  assert.equal(derivedPoses.summary.bonds.protein, 'distance-derived');
  assert.ok(sameRows(await fingerprintRows(derivedPoses.paths.interactionsCsv), poseRows),
    'Distance-derived receptor bonds changed the pose fingerprint');
  const receptorBonds = await helper('BOND_PERCEPTION', { product: productPath, withBonds: poses.receptor,
    withoutBonds: join(workDir, 'rec-no-bonds.pdb') });
  assert.ok(receptorBonds.identical, `Derived receptor bonds differ: ${JSON.stringify(receptorBonds)}`);
  cases.push({ id: 'prolif-reference-agreement', trajectoryRows: ours.length, poseRows: poseRows.length,
    anchors: PROLIF_TRAJECTORY_ANCHORS, bondPerception: { trajectory: trajectoryBonds, receptor: receptorBonds } });

  // 5. Malformed, mismatched and unsupported inputs are refused with an actionable message.
  const trajectoryInput = { topology, trajectory: xtc };
  await refused('mismatched-topology', 'analyze-trajectory', { topology: join(data, 'water_m2.pdb'), trajectory: xtc },
    'atoms per frame but the topology has');
  await refused('truncated-xtc', 'analyze-trajectory', { ...trajectoryInput, trajectory: join(workDir, 'truncated.xtc') },
    'truncated');
  await refused('truncated-dcd', 'analyze-trajectory', { ...trajectoryInput, trajectory: join(workDir, 'truncated.dcd') },
    'truncated');
  await refused('nonfinite-frame', 'analyze-trajectory', { ...trajectoryInput, trajectory: join(workDir, 'nonfinite.dcd') },
    'Frame 2 holds a non-finite coordinate');
  await refused('empty-selection', 'analyze-trajectory', { ...trajectoryInput,
    analysis: { rmsd: [{ label: 'Missing', selection: 'resname XYZ' }] } }, 'matched 0 atoms');
  await refused('invalid-selection', 'analyze-trajectory', { ...trajectoryInput,
    analysis: { rmsd: [{ label: 'Broken', selection: 'protein and (' }] } }, 'is not valid');
  await refused('frame-range-beyond-trajectory', 'analyze-trajectory', { ...trajectoryInput, analysis: { stop: 300 } },
    'Frame range end must be at most 250');
  await refused('ligand-without-bonds', 'fingerprint', { source: 'trajectory', topology: join(workDir, 'top-no-bonds.pdb'),
    trajectory: xtc, fingerprint: { ligandSelection: 'resname LIG' } }, 'The ligand has no bond records');
  await refused('ligand-reference-mismatch', 'fingerprint', { source: 'trajectory', ...trajectoryInput,
    ligandReferenceSdf: join(workDir, 'other-molecule.sdf'), fingerprint: { ligandSelection: 'resname LIG', stop: 1 } },
  'is not the reference molecule');
  await refused('receptor-without-hydrogens', 'fingerprint', { ...poses, receptor: join(workDir, 'rec-no-hydrogens.pdb') },
    'explicit hydrogens');
  await refused('poses-without-hydrogens', 'fingerprint', { ...poses, poses: join(workDir, 'poses-no-hydrogens.sdf') },
    'Pose 1 has no hydrogens');
  await refused('unknown-interaction', 'fingerprint', { ...poses, fingerprint: { interactions: ['WaterBridge'] } },
    'Interactions must be chosen from');

  // 6. A trajectory from the published OpenMM box, when one is supplied: the shape users bring.
  let openmm = null;
  if (openmmRun) {
    const run = JSON.parse(await readFile(join(openmmRun, 'chain-run.json'), 'utf8'));
    const result = await productCase('openmm-trajectory-analysis', 'analyze-trajectory', {
      topology: run.paths.topologyPdbPath, trajectory: run.paths.trajectoryDcdPath, stateCsv: run.paths.stateCsvPath,
      analysis: { rmsd: [{ label: 'Protein C-alpha', selection: 'protein and name CA' },
        { label: 'Ligand', selection: 'resname LIG and not element H' }] } });
    assert.equal(result.summary.stateRecordChecked, true);
    const fingerprint = await productCase('openmm-trajectory-fingerprint', 'fingerprint', { source: 'trajectory',
      topology: run.paths.topologyPdbPath, trajectory: run.paths.trajectoryDcdPath, ligandReferenceSdf: run.paths.ligandSdf,
      fingerprint: { ligandSelection: 'resname LIG' } });
    openmm = { input: run.identity, rmsd: result.summary.rmsd, mostFrequent: fingerprint.summary.mostFrequent.slice(0, 10) };
  }

  // 7. Every run above read the payload's own files; none may have written beside them.
  const leftovers = (await readdir(data)).filter((name) => name.startsWith('.'));
  assert.deepEqual(leftovers, [], `The runner wrote into the Runtime Box: ${leftovers.join(', ')}`);
  if (releasePath) await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
  cases.push({ id: 'payload-unchanged-after-runs', signedPayloadReverified: Boolean(releasePath) });

  const validation = { schemaVersion: 1, kind: 'liatir.molecular-analysis-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: { lengthToleranceAngstrom: LENGTH_TOLERANCE_ANGSTROM, comparison, officialVectors: OFFICIAL_CASES.length,
      prolifTrajectoryAnchors: PROLIF_TRAJECTORY_ANCHORS, openmm },
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
      fixture: { id: 'prolif-2.2.3-packaged-data', topologySha256: sha256(await readFile(topology)),
        trajectorySha256: sha256(await readFile(xtc)) },
      framework: { name: 'mdanalysis-prolif', version: '2.11.0+2.2.3', backend: 'cpu' },
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
  if (keep) console.error(`Preserved analysis validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
