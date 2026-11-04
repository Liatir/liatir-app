import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOLECULAR_ANALYSIS_SCRIPT } from '../../frontend/src/lib/tools/molecular-analysis/python-scripts/analysis';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';
const AKMA_PICOSECONDS = 0.04888821;

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', MOLECULAR_ANALYSIS_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function workspace(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function atom(serial: number, name: string, residue: string, chain: string, number: number, x: number, element: string,
  record = 'ATOM  ') {
  return `${record}${String(serial).padStart(5)} ${name.padEnd(4)} ${residue.padEnd(4)}${chain}${String(number).padStart(4)}    `
    + `${x.toFixed(3).padStart(8)}${'0.000'.padStart(8)}${'0.000'.padStart(8)}  1.00  0.00          ${element.padStart(2)}`;
}

// Two protein residues, a three-atom ligand with its bonds, a water and a sodium ion: 10 atoms.
const TOPOLOGY = [
  atom(1, 'N', 'ALA', 'A', 1, 0, 'N'), atom(2, 'CA', 'ALA', 'A', 1, 1.5, 'C'), atom(3, 'H', 'ALA', 'A', 1, -1, 'H'),
  atom(4, 'N', 'GLY', 'A', 2, 3, 'N'), atom(5, 'CA', 'GLY', 'A', 2, 4.5, 'C'),
  atom(6, 'C1', 'LIG', 'L', 1, 8, 'C', 'HETATM'), atom(7, 'O1', 'LIG', 'L', 1, 9.2, 'O', 'HETATM'),
  atom(8, 'H1', 'LIG', 'L', 1, 7, 'H', 'HETATM'), atom(9, 'O', 'HOH', 'W', 1, 20, 'O', 'HETATM'),
  atom(10, 'NA', 'NA', 'I', 1, 25, 'NA', 'HETATM'),
  'CONECT    6    7    8', 'CONECT    7    6', 'CONECT    8    6', 'END', '',
].join('\n');
// The first eight atoms: small enough for the uncompressed XTC frames GROMACS writes up to nine atoms.
const SMALL_TOPOLOGY = TOPOLOGY.split('\n').filter((line) => !/^HETATM\s+(?:9|10) /u.test(line)
  && !line.startsWith('CONECT')).join('\n');

/** A CHARMM-format DCD as OpenMM writes it: start step, save interval and timestep in AKMA units. */
function dcd(atoms: number, frames: number, { periodic = false, istart = 50, nsavc = 50, delta = 0.002 / AKMA_PICOSECONDS } = {}) {
  const record = (body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeInt32LE(body.length);
    return Buffer.concat([length, body, length]);
  };
  const header = Buffer.alloc(84);
  header.write('CORD', 0, 'ascii');
  const control = [frames, istart, nsavc, 0, 0, 0, 0, 0, 0, 0, periodic ? 1 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 24];
  control.forEach((value, index) => header.writeInt32LE(value, 4 + 4 * index));
  header.writeFloatLE(delta, 40);
  const title = Buffer.alloc(84);
  title.writeInt32LE(1, 0);
  const count = Buffer.alloc(4);
  count.writeInt32LE(atoms);
  const parts = [record(header), record(title), record(count)];
  for (let frame = 0; frame < frames; frame += 1) {
    if (periodic) {
      const cell = Buffer.alloc(48);
      [30, 90, 30, 90, 90, 30].forEach((value, index) => cell.writeDoubleLE(value, 8 * index));
      parts.push(record(cell));
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const values = Buffer.alloc(4 * atoms);
      for (let index = 0; index < atoms; index += 1) values.writeFloatLE(index + axis + frame / 10, 4 * index);
      parts.push(record(values));
    }
  }
  return Buffer.concat(parts);
}

/** An XTC of at most nine atoms, which GROMACS stores uncompressed. */
function xtc(atoms: number, times: number[], box = 3) {
  return Buffer.concat(times.map((time, frame) => {
    const values = Buffer.alloc(56 + 12 * atoms);
    values.writeInt32BE(1995, 0);
    values.writeInt32BE(atoms, 4);
    values.writeInt32BE(frame * 100, 8);
    values.writeFloatBE(time, 12);
    [box, 0, 0, 0, box, 0, 0, 0, box].forEach((value, index) => values.writeFloatBE(value, 16 + 4 * index));
    values.writeInt32BE(atoms, 52);
    for (let index = 0; index < 3 * atoms; index += 1) values.writeFloatBE(index / 10, 56 + 4 * index);
    return values;
  }));
}

function sdf(atoms: Array<[string, number]>) {
  const lines = ['', '     RDKit          3D', '', `${String(atoms.length).padStart(3)}  0  0  0  0  0  0  0  0  0999 V2000`];
  for (const [element, x] of atoms) {
    lines.push(`${x.toFixed(4).padStart(10)}${'0.0000'.padStart(10)}${'0.0000'.padStart(10)} ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  return [...lines, 'M  END', '$$$$', ''].join('\n');
}

function files(root: string) {
  const topology = join(root, 'topology.pdb');
  writeFileSync(topology, TOPOLOGY);
  const trajectory = join(root, 'trajectory.dcd');
  writeFileSync(trajectory, dcd(10, 4));
  return { topology, trajectory };
}

// The runner runs inside the Linux analysis box (natively or under WSL2), never under a Windows
// interpreter, and `socket.AF_UNIX` does not exist there; the docking script test makes the same cut.
describe.skipIf(process.platform === 'win32')('molecular analysis product Python script', () => {
  it('sizes a trajectory request and finds the ligand without importing MDAnalysis', () => {
    const root = workspace('liatir-analysis-dcd-');
    const result = run({ action: 'preflight-trajectory', ...files(root),
      analysis: { distances: [{ label: 'Ligand to glycine', selectionA: 'resname LIG', selectionB: 'resid 2' }], stride: 3 } });
    expect(result.status, result.stderr).toBe(0);
    const metrics = JSON.parse(result.stdout);
    expect(metrics).toMatchObject({
      workloadId: 'mdanalysis:trajectory-analysis', tokenCount: 4, atomCount: 10, stepCount: 2, outputItemCount: 2,
      topology: { atoms: 10, residues: 5, chains: ['A', 'L', 'W', 'I'], hydrogens: 2, elementsComplete: true,
        bondRecords: true, proteinResidues: 2, waterResidues: 1, ions: 1,
        ligandCandidates: [{ residueName: 'LIG', chain: 'L', residueNumber: '1', atoms: 3, hydrogens: 1, bondRecords: true,
          selection: 'resname LIG and resid 1 and chainID L' }] },
      trajectory: { format: 'dcd', atoms: 10, frames: 4, periodic: false },
      options: { window: { start: 0, stop: 4, stride: 3, frames: 2 } },
    });
    expect(metrics.trajectory.startTimePs).toBeCloseTo(0.1, 6);
    expect(metrics.trajectory.frameIntervalPs).toBeCloseTo(0.1, 6);
  });

  it('reads every frame of a periodic trajectory, because unwrapping follows each atom frame by frame', () => {
    const root = workspace('liatir-analysis-periodic-');
    const { topology } = files(root);
    const trajectory = join(root, 'periodic.dcd');
    writeFileSync(trajectory, dcd(10, 6, { periodic: true }));
    const result = run({ action: 'preflight-trajectory', topology, trajectory, analysis: { start: 1, stop: 5, stride: 2 } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ stepCount: 5, outputItemCount: 2,
      trajectory: { periodic: true, frames: 6 } });
  });

  it('reads XTC frame headers, times and box', () => {
    const root = workspace('liatir-analysis-xtc-');
    const topology = join(root, 'small.pdb');
    writeFileSync(topology, SMALL_TOPOLOGY);
    const trajectory = join(root, 'small.xtc');
    writeFileSync(trajectory, xtc(8, [10, 12, 14]));
    const result = run({ action: 'preflight-trajectory', topology, trajectory });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).trajectory).toEqual({ format: 'xtc', atoms: 8, frames: 3, periodic: true,
      startTimePs: 10, frameIntervalPs: 2 });
  });

  it('refuses truncated trajectories, a mismatched topology and a state record of another length', () => {
    const root = workspace('liatir-analysis-refusals-');
    const { topology, trajectory } = files(root);
    const truncated = join(root, 'truncated.dcd');
    writeFileSync(truncated, dcd(10, 4).subarray(0, -3));
    expect(run({ action: 'preflight-trajectory', topology, trajectory: truncated }).stderr)
      .toContain('The DCD trajectory is truncated: its last frame is incomplete.');
    const small = join(root, 'small.pdb');
    writeFileSync(small, SMALL_TOPOLOGY);
    const truncatedXtc = join(root, 'truncated.xtc');
    writeFileSync(truncatedXtc, xtc(8, [1, 2]).subarray(0, -5));
    expect(run({ action: 'preflight-trajectory', topology: small, trajectory: truncatedXtc }).stderr)
      .toContain('The XTC trajectory is truncated: its last frame is incomplete.');
    const other = join(root, 'other.dcd');
    writeFileSync(other, dcd(12, 2));
    expect(run({ action: 'preflight-trajectory', topology, trajectory: other }).stderr)
      .toContain('The trajectory has 12 atoms per frame but the topology has 10.');
    const state = join(root, 'state.csv');
    writeFileSync(state, '#"Step","Time (ps)"\n50,0.1\n100,0.2\n');
    expect(run({ action: 'preflight-trajectory', topology, trajectory, stateCsv: state }).stderr)
      .toContain('The simulation state record has 2 rows but the trajectory holds 4 frames.');
  });

  it('sizes a docked-pose fingerprint, reads unnamed poses and refuses poses without hydrogens', () => {
    const root = workspace('liatir-analysis-poses-');
    const { topology: receptor } = files(root);
    const poses = join(root, 'poses.sdf');
    writeFileSync(poses, sdf([['C', 8], ['O', 9.2], ['H', 7]]) + sdf([['C', 8.1], ['O', 9.3], ['H', 7.1]]));
    const result = run({ action: 'preflight-fingerprint', source: 'poses', receptor, poses,
      fingerprint: { interactions: ['HBDonor', 'Hydrophobic'] } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ workloadId: 'prolif:pose-fingerprint', tokenCount: 2,
      atomCount: 10, stepCount: 2, outputItemCount: 2, interactions: ['Hydrophobic', 'HBDonor'],
      poses: { poses: 2, maxPoseAtoms: 3 } });
    const bare = join(root, 'bare.sdf');
    writeFileSync(bare, sdf([['C', 8], ['O', 9.2]]));
    expect(run({ action: 'preflight-fingerprint', source: 'poses', receptor, poses: bare }).stderr)
      .toContain('Pose 1 has no hydrogens.');
    expect(run({ action: 'preflight-fingerprint', source: 'poses', receptor, poses,
      fingerprint: { interactions: [] } }).stderr).toContain('Choose at least one interaction.');
  });

  it('will not load the scientific stack without an accepted measured envelope', () => {
    const root = workspace('liatir-analysis-envelope-');
    const result = run({ action: 'analyze-trajectory', ...files(root), outputDir: join(root, 'out') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input');
  });
});
