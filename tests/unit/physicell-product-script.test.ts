import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHYSICELL_SCRIPT } from '../../frontend/src/lib/tools/physicell/python-scripts/physicell';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

// PhysiCell's own template settings, as the box ships them.
const TEMPLATE = readFileSync(new URL('../../runtime-boxes/scrolls/physicell/template/PhysiCell_settings.xml', import.meta.url), 'utf8');

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', PHYSICELL_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function settings(name: string, text: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'liatir-physicell-')), name);
  writeFileSync(path, text);
  return path;
}

// The runner runs inside the Linux PhysiCell box (natively or under WSL2), never under a Windows
// interpreter. The preflight reads settings with the standard library, before NumPy or PhysiCell.
describe.skipIf(process.platform === 'win32')('PhysiCell product Python script', () => {
  it('sizes the template from its settings: 5 cells, 2,500 voxels, 72,000 mechanics steps, 121 snapshots', () => {
    const result = run({ action: 'preflight-physicell', source: 'settings', settings: settings('template.xml', TEMPLATE),
      physicell: { seed: 4 } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      workloadId: 'physicell:template', tokenCount: 5, atomCount: 2500, stepCount: 72000, outputItemCount: 121,
      model: { cellTypes: ['default'], substrates: ['substrate'], twoDimensional: true, voxels: 2500, initialCells: 5 },
      options: { maxTime: 7200, seed: 4, threads: 1 },
      networkAccess: false,
    });
  });

  it('refuses entities, intracellular models and rules it was not given, before running anything', () => {
    expect(run({ action: 'preflight-physicell', source: 'settings',
      settings: settings('doctype.xml', TEMPLATE.replace('<PhysiCell_settings', '<!DOCTYPE x [<!ENTITY a "a">]>\n<PhysiCell_settings')) })
      .stderr).toContain('declare a document type or entities');
    expect(run({ action: 'preflight-physicell', source: 'settings',
      settings: settings('intracellular.xml', TEMPLATE.replace('</phenotype>', '<intracellular type="maboss"/></phenotype>')) })
      .stderr).toContain('attach intracellular models');
    expect(run({ action: 'preflight-physicell', source: 'settings',
      settings: settings('rules.xml', TEMPLATE.replace('format="csv" enabled="false"', 'format="csv" enabled="true"')) })
      .stderr).toContain('enable cell rules');
    // PhysiCell 1.14.2 crashes when a simulation starts without a cell.
    expect(run({ action: 'preflight-physicell', source: 'settings',
      settings: settings('empty.xml', TEMPLATE.replace('>5</number_of_cells>', '>0</number_of_cells>')) })
      .stderr).toContain('start no cells');
  });

  it('will not start PhysiCell without an accepted measured envelope', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-physicell-envelope-'));
    const result = run({ action: 'simulate-physicell', source: 'settings', settings: settings('template.xml', TEMPLATE),
      outputDir: join(root, 'out') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input before PhysiCell runs.');
  });
});
