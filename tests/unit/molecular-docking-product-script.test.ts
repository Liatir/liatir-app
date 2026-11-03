import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOLECULAR_DOCKING_SCRIPT } from '../../frontend/src/lib/tools/molecular-docking/python-scripts/docking';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', MOLECULAR_DOCKING_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function workspace(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

const PDB = [
  'ATOM      1  N   ALA A   1      11.104  13.207  10.507  1.00 20.00           N',
  'ATOM      2  CA  ALA A   1      12.560  13.207  10.507  1.00 20.00           C',
  'HETATM    3  O   HOH A 101      20.000  20.000  20.000  1.00 20.00           O',
  'HETATM    4 CL    CL A 102      21.000  20.000  20.000  1.00 20.00          CL',
  'HETATM    5  C1  STI A 201      10.000  10.000  10.000  1.00 20.00           C',
  'HETATM    6  N1  STI A 201      11.000  10.000  10.000  1.00 20.00           N',
  'END',
  '',
].join('\n');

function sdfRecord(name: string, atoms: Array<[string, number, number, number]>): string {
  const lines = [name, '  test', '', `${String(atoms.length).padStart(3)}  0  0  0  0  0  0  0  0  0999 V2000`];
  for (const [element, x, y, z] of atoms) {
    lines.push(`${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${z.toFixed(4).padStart(10)} ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  return [...lines, 'M  END', '$$$$', ''].join('\n');
}

function dockingInputs(root: string) {
  const receptor = join(root, 'receptor.pdbqt');
  writeFileSync(receptor, [
    'ATOM      1  N   ALA A   1      11.104  13.207  10.507  1.00 20.00    -0.300 N ',
    'ATOM      2  CA  ALA A   1      12.560  13.207  10.507  1.00 20.00     0.100 C ',
    '',
  ].join('\n'));
  const ligands = join(root, 'ligands.sdf');
  writeFileSync(ligands, sdfRecord('first', [['C', 1, 2, 3], ['O', 2, 2, 3]])
    + sdfRecord('second', [['C', 0, 0, 0], ['H', 0, 0, 1]]));
  return { receptor, ligands };
}

// The script runs inside the Linux docking box (natively or under WSL2), never under a Windows
// interpreter, and `socket.AF_UNIX` does not exist there; the OpenMM script test makes the same cut.
describe.skipIf(process.platform === 'win32')('molecular docking product Python script', () => {
  it('lists chains and non-polymer residues without importing the docking stack', () => {
    const root = workspace('liatir-docking-receptor-');
    const structure = join(root, 'input.pdb');
    writeFileSync(structure, PDB);
    const result = run({ action: 'preflight-receptor', inputStructure: structure });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      kind: 'liatir.molecular-docking-preflight',
      action: 'prepare-receptor',
      workloadId: 'docking:receptor-preparation',
      tokenCount: 1,
      atomCount: 6,
      chains: ['A'],
      heterogens: [
        { name: 'CL', kind: 'ion', residues: 1 },
        { name: 'STI', kind: 'ligand-or-cofactor', residues: 1 },
        { name: 'HOH', kind: 'water', residues: 1 },
      ],
      stepCount: 1,
      outputItemCount: 1,
      inputBytes: Buffer.byteLength(PDB),
      networkAccess: false,
    });
  });

  it('refuses a multi-model structure before preparation', () => {
    const root = workspace('liatir-docking-models-');
    const structure = join(root, 'models.pdb');
    writeFileSync(structure, `MODEL        1\n${PDB}MODEL        2\n${PDB}`);
    const result = run({ action: 'preflight-receptor', inputStructure: structure });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Select a single structure model');
  });

  it('measures a docking request in the dimensions its hardware envelope is recorded in', () => {
    const root = workspace('liatir-docking-request-');
    const { receptor, ligands } = dockingInputs(root);
    const result = run({ action: 'preflight-dock', receptorPdbqt: receptor, ligandsSdf: ligands,
      site: { mode: 'box', center: [1, 2, 3], size: [20, 20, 20] }, docking: { cpu: 1 } });
    expect(result.status, result.stderr).toBe(0);
    const metrics = JSON.parse(result.stdout);
    expect(metrics).toMatchObject({
      workloadId: 'vina:dock:vina', tokenCount: 2, atomCount: 2, stepCount: 8, outputItemCount: 18,
      ligandCount: 2, maxLigandHeavyAtoms: 2, networkAccess: false,
      site: { mode: 'box', center: [1, 2, 3], size: [20, 20, 20], volumeCubicAngstrom: 8000, largeSearchSpace: false },
    });
  });

  it('builds the box around a reference ligand with its padding', () => {
    const root = workspace('liatir-docking-reference-');
    const { receptor, ligands } = dockingInputs(root);
    const reference = join(root, 'reference.sdf');
    writeFileSync(reference, sdfRecord('ref', [['C', 0, 0, 0], ['C', 4, 2, 0]]));
    const result = run({ action: 'preflight-dock', receptorPdbqt: receptor, ligandsSdf: ligands,
      site: { mode: 'reference-ligand', referenceLigand: reference, paddingAngstrom: 5 }, docking: { cpu: 1 } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).site).toMatchObject({ center: [2, 1, 0], size: [14, 12, 10], paddingAngstrom: 5 });
  });

  it('refuses a ligand file where a receptor belongs, and an oversized box', () => {
    const root = workspace('liatir-docking-refusals-');
    const { ligands } = dockingInputs(root);
    const ligandPdbqt = join(root, 'ligand.pdbqt');
    writeFileSync(ligandPdbqt, 'ROOT\nATOM      1  C   LIG A   1       1.000   2.000   3.000  1.00  0.00     0.000 C \nENDROOT\nTORSDOF 0\n');
    const asReceptor = run({ action: 'preflight-dock', receptorPdbqt: ligandPdbqt, ligandsSdf: ligands,
      site: { mode: 'box', center: [0, 0, 0], size: [20, 20, 20] }, docking: { cpu: 1 } });
    expect(asReceptor.status).not.toBe(0);
    expect(asReceptor.stderr).toContain('torsion records');
    const { receptor } = dockingInputs(root);
    const oversized = run({ action: 'preflight-dock', receptorPdbqt: receptor, ligandsSdf: ligands,
      site: { mode: 'box', center: [0, 0, 0], size: [127, 20, 20] }, docking: { cpu: 1 } });
    expect(oversized.status).not.toBe(0);
    expect(oversized.stderr).toContain('Box size x must be at most 126');
  });

  it('refuses a ligand record that declares more atoms than it holds', () => {
    const root = workspace('liatir-docking-truncated-');
    const { receptor } = dockingInputs(root);
    const truncated = join(root, 'truncated.sdf');
    writeFileSync(truncated, sdfRecord('whole', [['C', 0, 0, 0], ['O', 1, 0, 0]]).split('\n').slice(0, 5).join('\n'));
    const result = run({ action: 'preflight-dock', receptorPdbqt: receptor, ligandsSdf: truncated,
      site: { mode: 'box', center: [0, 0, 0], size: [20, 20, 20] }, docking: { cpu: 1 } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SDF record 1 is truncated: it declares 2 atoms and holds 1.');
  });

  it('reads unnamed molecules, whose SDF title line is blank', () => {
    const root = workspace('liatir-docking-unnamed-');
    const { receptor } = dockingInputs(root);
    const ligands = join(root, 'unnamed.sdf');
    writeFileSync(ligands, sdfRecord('', [['C', 0, 0, 0], ['O', 1, 0, 0]]) + sdfRecord('', [['N', 0, 0, 0]]));
    const reference = join(root, 'unnamed-reference.sdf');
    writeFileSync(reference, sdfRecord('', [['C', 0, 0, 0], ['C', 4, 2, 0]]));
    const result = run({ action: 'preflight-dock', receptorPdbqt: receptor, ligandsSdf: ligands,
      site: { mode: 'reference-ligand', referenceLigand: reference, paddingAngstrom: 5 }, docking: { cpu: 1 } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ligandCount: 2, maxLigandHeavyAtoms: 2,
      site: { center: [2, 1, 0], size: [14, 12, 10] } });
  });

  it('will not load the scientific stack without an accepted measured envelope', () => {
    const root = workspace('liatir-docking-envelope-');
    const structure = join(root, 'input.pdb');
    writeFileSync(structure, PDB);
    const result = run({ action: 'prepare-receptor', inputStructure: structure, outputDir: join(root, 'out') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input');
  });
});
