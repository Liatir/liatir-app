import { describe, expect, it } from 'vitest';
import { parseLiatirComplexSpecJson, validateLiatirComplexSpec, type LiatirComplexSpec } from '@liatir/core';

describe('LiatirComplexSpec v1', () => {
  it.each(['{', 'null', '[]', '1', '"protein"', '{}'])('reports invalid advanced input without throwing: %s', (input) => {
    expect(parseLiatirComplexSpecJson(input)).toMatchObject({ valid: false, spec: null });
  });

  it.each([
    { entities: [null] },
    { entities: [{ id: 'A', type: 'protein', sequence: 123 }] },
    { entities: [{ id: 'A', type: 'unknown', sequence: 'MST' }] },
    { entities: [{ id: 'A', type: 'protein', sequence: 'MST', msa: null }] },
    { entities: [{ id: 'A', type: 'protein', sequence: 'MST', msa: { path: '/a', format: 'fasta' } }] },
    { entities: [{ id: 'A', type: 'ligand', smiles: true }] },
    { templates: [null] },
    { templates: {} },
    { constraints: [{ type: 'bond', left: null, right: { entityId: 'A' } }] },
    { constraints: [{ type: 'distance', left: { entityId: 'A' }, right: { entityId: 'A' }, maxDistanceAngstrom: '6' }] },
  ])('rejects malformed nested advanced fields: %j', (patch) => {
    const input = { schemaVersion: 1, kind: 'liatir-complex-spec', entities: [{ id: 'A', type: 'protein', sequence: 'MST' }], ...patch };
    expect(parseLiatirComplexSpecJson(JSON.stringify(input))).toMatchObject({ valid: false, spec: null });
  });

  it('preserves valid advanced input and still checks scientific references', () => {
    const input = { schemaVersion: 1, kind: 'liatir-complex-spec', entities: [{ id: 'A', type: 'protein', sequence: 'M S T' }] };
    expect(parseLiatirComplexSpecJson(JSON.stringify(input))).toEqual({ valid: true, errors: [], spec: input });
    expect(parseLiatirComplexSpecJson(JSON.stringify({ ...input, templates: [{ id: 'T', entityId: 'missing', path: '/t.cif', format: 'mmcif' }] }))).toMatchObject({ valid: false, spec: null });
  });

  it('refuses unknown scientific instructions instead of silently dropping them', () => {
    const input = { schemaVersion: 1, kind: 'liatir-complex-spec', entities: [{ id: 'A', type: 'protein', sequence: 'MST', modification: 'phosphorylation' }] };
    const parsed = parseLiatirComplexSpecJson(JSON.stringify(input));
    expect(parsed.spec).toBeNull();
    expect(parsed.errors.join(' ')).toMatch(/modification is not supported/);
  });

  it('refuses JSON numeric overflow before adapters allocate resources', () => {
    const parsed = parseLiatirComplexSpecJson('{"schemaVersion":1,"kind":"liatir-complex-spec","entities":[{"id":"A","type":"protein","sequence":"MST","copies":1e999}]}');
    expect(parsed.spec).toBeNull();
    expect(parsed.errors.join(' ')).toMatch(/copies must be a finite number/);
  });
  it('accepts a local protein-ligand complex with MSA, template and constraint', () => {
    const spec: LiatirComplexSpec = {
      schemaVersion: 1,
      kind: 'liatir-complex-spec',
      entities: [
        { id: 'target', type: 'protein', sequence: 'MSTNPKPQR', msa: { format: 'a3m', path: '/data/target.a3m' } },
        { id: 'ligand', type: 'ligand', smiles: 'CC(=O)O' },
      ],
      templates: [{ id: 'template1', entityId: 'target', path: '/data/template.cif', format: 'mmcif', chainId: 'A' }],
      constraints: [{
        type: 'distance',
        left: { entityId: 'target', residue: 4, atom: 'CA' },
        right: { entityId: 'ligand', atom: 'O1' },
        maxDistanceAngstrom: 6,
      }],
    };
    expect(validateLiatirComplexSpec(spec)).toEqual({ valid: true, errors: [] });
  });

  it('rejects remote inputs, duplicate entities and ambiguous ligand identity', () => {
    const result = validateLiatirComplexSpec({
      schemaVersion: 1,
      kind: 'liatir-complex-spec',
      entities: [
        { id: 'A', type: 'protein', sequence: 'MST', msa: { format: 'a3m', path: 'data:text/plain,>A%0AMST' } },
        { id: 'A', type: 'ligand', smiles: 'CC', ccdCode: 'ATP' },
      ],
      constraints: [{ type: 'bond', left: { entityId: 'missing' }, right: { entityId: 'A' } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/local path/);
    expect(result.errors.join(' ')).toMatch(/Duplicate entity id/);
    expect(result.errors.join(' ')).toMatch(/exactly one of SMILES or CCD/);
    expect(result.errors.join(' ')).toMatch(/unknown entity missing/);
  });

  it('accepts native Windows paths without treating the drive letter as a URI scheme', () => {
    const result = validateLiatirComplexSpec({
      schemaVersion: 1,
      kind: 'liatir-complex-spec',
      entities: [{ id: 'A', type: 'protein', sequence: 'MST', msa: { format: 'a3m', path: String.raw`C:\data\A.a3m` } }],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('accepts local Protenix HHR template-search output', () => {
    const result = validateLiatirComplexSpec({
      schemaVersion: 1,
      kind: 'liatir-complex-spec',
      entities: [{ id: 'A', type: 'protein', sequence: 'MST' }],
      templates: [{ id: 'local_hhr', entityId: 'A', path: '/data/template.hhr', format: 'hhr' }],
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });
});
