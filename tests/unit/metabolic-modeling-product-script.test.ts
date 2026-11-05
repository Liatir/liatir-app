import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { METABOLIC_MODELING_SCRIPT } from '../../frontend/src/lib/tools/metabolic-modeling/python-scripts/metabolic';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

function run(payload: Record<string, unknown>) {
  return spawnSync(PYTHON, ['-c', METABOLIC_MODELING_SCRIPT], { encoding: 'utf8', input: JSON.stringify(payload) });
}

function workspace(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Three reactions, two species and two gene products, written the way COBRApy writes SBML: ids carry
// R_ and G_ prefixes and dots are escaped, and COBRApy reads them as EX_a, A_B, BIOMASS, g1 and g2.1.
const SBML = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version1/core" xmlns:fbc="http://www.sbml.org/sbml/level3/version1/fbc/version2" level="3" version="1" fbc:required="false">
  <model id="toy" fbc:strict="true">
    <listOfSpecies>
      <species id="M_a_c" compartment="c" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
      <species id="M_b_c" compartment="c" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>
    </listOfSpecies>
    <listOfReactions>
      <reaction id="R_EX_a" reversible="true" fast="false"/>
      <reaction id="R_A_B" reversible="false" fast="false"/>
      <reaction id="R_BIOMASS" reversible="false" fast="false"/>
    </listOfReactions>
    <fbc:listOfObjectives fbc:activeObjective="obj">
      <fbc:objective fbc:id="obj" fbc:type="maximize">
        <fbc:listOfFluxObjectives><fbc:fluxObjective fbc:reaction="R_BIOMASS" fbc:coefficient="1"/></fbc:listOfFluxObjectives>
      </fbc:objective>
    </fbc:listOfObjectives>
    <fbc:listOfGeneProducts>
      <fbc:geneProduct fbc:id="G_g1" fbc:label="g1"/>
      <fbc:geneProduct fbc:id="G_g2__SBML_DOT__1" fbc:label="g2.1"/>
    </fbc:listOfGeneProducts>
  </model>
</sbml>
`;

const JSON_MODEL = {
  id: 'toy',
  metabolites: [{ id: 'a_c' }, { id: 'b_c' }],
  reactions: [
    { id: 'EX_a', metabolites: { a_c: -1 }, lower_bound: -10, upper_bound: 1000 },
    { id: 'A_B', metabolites: { a_c: -1, b_c: 1 }, lower_bound: 0, upper_bound: 1000, gene_reaction_rule: 'g1' },
    { id: 'BIOMASS', metabolites: { b_c: -1 }, lower_bound: 0, upper_bound: 1000, objective_coefficient: 1 },
  ],
  genes: [{ id: 'g1' }],
};

// The runner runs inside the Linux metabolic box (natively or under WSL2), never under a Windows
// interpreter, and `socket.AF_UNIX` does not exist there; the other product script tests make the same cut.
describe.skipIf(process.platform === 'win32')('metabolic modeling product Python script', () => {
  it('sizes a flux variability request from SBML without importing COBRApy, with COBRApy identifiers', () => {
    const root = workspace('liatir-metabolic-sbml-');
    const model = join(root, 'toy.xml.gz');
    writeFileSync(model, gzipSync(SBML));
    const result = run({ action: 'preflight-metabolic', model, metabolic: { analysis: 'fva',
      bounds: [{ reaction: 'EX_a', lower: -5, upper: 0 }], knockouts: ['g2.1'] } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      workloadId: 'cobra:fva', tokenCount: 2, atomCount: 3, stepCount: 7, outputItemCount: 3,
      model: { format: 'sbml', sbmlLevel: '3', reactions: 3, metabolites: 2, genes: 2, hasObjective: true },
      options: { analysis: 'fva', direction: 'max', knockouts: ['g2.1'], crossCheck: true },
      networkAccess: false,
    });
  });

  it('sizes gene deletions on a COBRA JSON model, one problem per gene and one for the reference', () => {
    const root = workspace('liatir-metabolic-json-');
    const model = join(root, 'toy.json');
    writeFileSync(model, JSON.stringify(JSON_MODEL));
    const result = run({ action: 'preflight-metabolic', model, metabolic: { analysis: 'gene-deletion', crossCheck: false } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ workloadId: 'cobra:gene-deletion', tokenCount: 1, atomCount: 3,
      stepCount: 2, outputItemCount: 1, model: { format: 'cobra-json', genes: 1 } });
  });

  it('refuses entity declarations, unknown reactions and genes, and inverted bounds', () => {
    const root = workspace('liatir-metabolic-refusals-');
    const entities = join(root, 'entities.xml');
    writeFileSync(entities, SBML.replace('?>', '?>\n<!DOCTYPE sbml [<!ENTITY x "x">]>'));
    expect(run({ action: 'preflight-metabolic', model: entities }).stderr)
      .toContain('declares a document type or entities');
    const model = join(root, 'toy.xml');
    writeFileSync(model, SBML);
    expect(run({ action: 'preflight-metabolic', model, metabolic: { bounds: [{ reaction: 'R_EX_a', lower: 0, upper: 1 }] } })
      .stderr).toContain('names R_EX_a, which is not a reaction in the model');
    expect(run({ action: 'preflight-metabolic', model, metabolic: { knockouts: 'g3' } }).stderr)
      .toContain('These genes are not in the model: g3.');
    expect(run({ action: 'preflight-metabolic', model, metabolic: { bounds: [{ reaction: 'EX_a', lower: 1, upper: 0 }] } })
      .stderr).toContain('The lower bound of EX_a exceeds its upper bound.');
  });

  it('will not load COBRApy without an accepted measured envelope', () => {
    const root = workspace('liatir-metabolic-envelope-');
    const model = join(root, 'toy.xml');
    writeFileSync(model, SBML);
    const result = run({ action: 'analyze-metabolic', model, outputDir: join(root, 'out') });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('A measured hardware preflight must accept this input before COBRApy is loaded.');
  });
});
