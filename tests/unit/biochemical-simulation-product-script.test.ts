import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOCHEMICAL_SIMULATION_SCRIPT } from '../../frontend/src/lib/tools/biochemical-simulation/python-scripts/biochemical';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', BIOCHEMICAL_SIMULATION_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function bngl(name: string, text: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'liatir-biochemical-')), name);
  writeFileSync(path, text);
  return path;
}

const MODEL = `begin model
begin parameters
  k1 0.1
end parameters
begin molecule types
  A()
end molecule types
begin seed species
  A() 100
end seed species
begin observables
  Molecules A_total A()
end observables
begin reaction rules
  A() -> 0 k1
end reaction rules
end model
generate_network({overwrite=>1})
simulate({method=>"ode",t_end=>10,n_steps=>10})
`;

// The runner runs inside the Linux biochemical box (natively or under WSL2), never under a Windows
// interpreter. These cases are refused by the standard-library checks, before PySB or BioNetGen is needed.
describe.skipIf(process.platform === 'win32')('biochemical simulation product Python script', () => {
  it('refuses what it cannot read or run before loading PySB', () => {
    const unknownBlock = bngl('unknown.bngl', MODEL.replace('begin observables', 'begin anchors\nend anchors\nbegin observables'));
    expect(run({ action: 'preflight-network', source: 'bngl', bngl: unknownBlock }).stderr)
      .toContain('The BNGL file has a block this tool does not read: anchors.');
    const silent = bngl('silent.bngl', MODEL.replace('  Molecules A_total A()\n', ''));
    expect(run({ action: 'preflight-network', source: 'bngl', bngl: silent }).stderr)
      .toContain('declares no observables, so a simulation would report nothing');
    const model = bngl('decay.bngl', MODEL);
    expect(run({ action: 'preflight-network', source: 'bngl', bngl: model,
      simulation: { parameters: [{ name: 'k2', value: 1 }] } }).stderr)
      .toContain('These parameters are not in the BNGL file: k2.');
    expect(run({ action: 'preflight-network', source: 'builtin', builtinModel: 'os' }).stderr)
      .toContain('The built-in model must be one of: bngwiki_egfr_simple, earm_1_0');
    expect(run({ action: 'preflight-network', source: 'builtin', builtinModel: 'synth_deg',
      simulation: { method: 'ssa', runs: 10, seed: 2_147_483_647 } }).stderr).toContain('Seed must be at most 2147483638.');
    expect(run({ action: 'preflight-network', source: 'builtin', builtinModel: 'synth_deg',
      simulation: { method: 'ssa', spacing: 'log', tFirst: 1 } }).stderr).toContain('choose linear spacing');
  });

  it('will not load PySB without an accepted measured envelope', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-biochemical-envelope-'));
    const result = run({ action: 'simulate-network', source: 'builtin', builtinModel: 'synth_deg', outputDir: join(root, 'out') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input before PySB is loaded.');
  });
});
