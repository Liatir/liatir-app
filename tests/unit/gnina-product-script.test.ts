import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GNINA_SCRIPT } from '../../frontend/src/lib/tools/gnina/python-scripts/gnina';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

// Liatir Molecular Docking's own 1IEP redocking: six poses that record their receptor by digest.
const POSES = readFileSync(new URL('../../runtime-boxes/fixtures/gnina/1iep-redocking-poses.sdf', import.meta.url), 'utf8');
const RECORDED_RECEPTOR = 'f13cf3b36f61d87c3b58983e0b8ecf1c3456a685eb86dfe9ccfb139c7bdc2586';
const RECEPTOR = 'ATOM      1  N   ALA A   1       0.000   0.000   0.000  0.00  0.00    -0.350 N\n';

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', GNINA_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function file(name: string, text: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'liatir-gnina-')), name);
  writeFileSync(path, text);
  return path;
}

/** A one-atom receptor, and the poses rewritten to record that very receptor. */
function matched(poses = POSES) {
  const digest = createHash('sha256').update(RECEPTOR).digest('hex');
  return { receptorPdbqt: file('receptor.pdbqt', RECEPTOR), posesSdf: file('poses.sdf', poses.replaceAll(RECORDED_RECEPTOR, digest)) };
}

// The runner runs inside the Linux GNINA box (natively or under WSL2), never under a Windows
// interpreter. Its preflight reads SD and PDBQT files with the standard library, before GNINA starts.
describe.skipIf(process.platform === 'win32')('GNINA product Python script', () => {
  it('sizes a run by poses and receptor atoms', () => {
    const result = run({ action: 'preflight-rescore-poses', ...matched() });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ workloadId: 'gnina:rescore', tokenCount: 6, atomCount: 1, stepCount: 1,
      outputItemCount: 6, ligands: 1, networkAccess: false });
  });

  it('refuses poses docked into another receptor, foreign poses, unrecorded receptors and repeated poses', () => {
    const preflight = (input: Record<string, string>) => run({ action: 'preflight-rescore-poses', ...input }).stderr;
    expect(preflight({ posesSdf: file('poses.sdf', POSES), receptorPdbqt: file('receptor.pdbqt', RECEPTOR) }))
      .toContain('were not docked into this receptor PDBQT');
    expect(preflight(matched(POSES.replaceAll('<liatir_ligand>', '<ligand>'))))
      .toContain("does not come from Liatir's Molecular Docking");
    expect(preflight(matched(POSES.replace(/^>.*<liatir_receptor_pdbqt_sha256>.*\n.*\n\n/gmu, ''))))
      .toContain('do not record the receptor');
    expect(preflight(matched(POSES + POSES))).toContain('twice');
  });

  it('will not start GNINA without an accepted measured envelope', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'liatir-gnina-envelope-')), 'out');
    const result = run({ action: 'rescore-poses', ...matched(), outputDir: output });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input before GNINA runs.');
  });
});
