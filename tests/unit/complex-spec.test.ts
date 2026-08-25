import { describe, expect, it } from 'vitest';
import { validateLiatirComplexSpec, type LiatirComplexSpec } from '@liatir/core';

describe('LiatirComplexSpec v1', () => {
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
});
