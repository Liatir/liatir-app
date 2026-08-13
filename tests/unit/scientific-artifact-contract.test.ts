import { describe, expect, it } from 'vitest';
import {
  LIATIR_ANNDATA_PROFILE_V1,
  checkLiatirArtifactCompatibility,
  liatirArtifactLineageSource,
  validateLiatirAnnDataArtifact,
  type LiatirArtifactRequirement,
} from '@liatir/core';

const sha256 = 'a'.repeat(64);
const validatedAt = '2026-08-13T10:00:00.000Z';

function validAnnData() {
  return validateLiatirAnnDataArtifact({
    sizeBytes: 1024,
    sha256,
    validatedAt,
    inspection: {
      hdf5Signature: true,
      observations: 3,
      variables: 4,
      matrixLocation: 'X',
      matrixPresent: true,
      finiteValues: true,
      nonNegativeValues: true,
      integerLikeValues: true,
      scientificType: 'annotated-matrix',
      organism: { taxonId: '9606', name: 'Homo sapiens' },
      modality: 'single-cell-rna',
      featureNamespace: 'ensembl-gene-id',
      preprocessing: ['raw-counts'],
      representations: ['expression'],
    },
  });
}

const geneformerRequirement: LiatirArtifactRequirement = {
  profiles: [{ ...LIATIR_ANNDATA_PROFILE_V1 }],
  formats: ['anndata-h5ad'],
  scientificTypes: ['annotated-matrix'],
  validation: 'valid-or-partial',
  qualifiers: {
    taxonIds: ['9606'],
    modalities: ['single-cell-rna'],
    featureNamespaces: ['ensembl-gene-id'],
    preprocessing: ['raw-counts'],
    representations: ['expression'],
  },
};

describe('versioned scientific artifact contract', () => {
  it('creates a stable physical identity and valid AnnData profile from complete inspection', () => {
    const artifact = validAnnData();

    expect(artifact).toMatchObject({
      schemaVersion: 1,
      physical: {
        artifactId: `sha256:${sha256}`,
        sizeBytes: 1024,
        digest: { algorithm: 'sha256', value: sha256 },
        mediaType: 'application/x-hdf5',
        format: { id: 'anndata-h5ad', container: 'hdf5' },
      },
      profile: LIATIR_ANNDATA_PROFILE_V1,
      scientificType: 'annotated-matrix',
      mutationPolicy: 'immutable-source',
      validation: { status: 'valid' },
    });
    expect(checkLiatirArtifactCompatibility(artifact, geneformerRequirement).status).toBe('compatible');
  });

  it('keeps unknown scientific metadata partial instead of guessing it', () => {
    const artifact = validateLiatirAnnDataArtifact({
      sizeBytes: 128,
      sha256,
      validatedAt,
      inspection: { hdf5Signature: true },
    });
    const report = checkLiatirArtifactCompatibility(artifact, geneformerRequirement);

    expect(artifact.validation.status).toBe('partial');
    expect(artifact.qualifiers.organism).toBeUndefined();
    expect(report.status).toBe('partial');
    expect(report.layers.transport.status).toBe('compatible');
    expect(report.layers.format.status).toBe('compatible');
    expect(report.layers.scientific.status).toBe('partial');
    expect(report.diagnostics.map((item) => item.code)).toContain('artifact.organism.unknown');
  });

  it('does not call declared raw counts valid before checking the matrix values', () => {
    const artifact = validateLiatirAnnDataArtifact({
      sizeBytes: 128,
      sha256,
      validatedAt,
      inspection: {
        hdf5Signature: true,
        observations: 2,
        variables: 3,
        matrixLocation: 'X',
        matrixPresent: true,
        scientificType: 'annotated-matrix',
        organism: { taxonId: '9606', name: 'Homo sapiens' },
        modality: 'single-cell-rna',
        featureNamespace: 'ensembl-gene-id',
        preprocessing: ['raw-counts'],
        representations: ['expression'],
      },
    });

    expect(artifact.validation.status).toBe('partial');
    expect(artifact.validation.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'anndata.values.non-finite.unknown',
      'anndata.values.negative.unknown',
      'anndata.values.integer-counts.unknown',
    ]));
  });

  it('keeps every compatibility layer partial when legacy metadata is absent', () => {
    const report = checkLiatirArtifactCompatibility(undefined, geneformerRequirement);

    expect(report.status).toBe('partial');
    expect(report.layers.transport.status).toBe('partial');
    expect(report.layers.format.status).toBe('partial');
    expect(report.layers.scientific.status).toBe('partial');
  });

  it('accepts backwards-compatible profile revisions and rejects a new major version', () => {
    const artifact = validAnnData();
    const newerMinor = {
      ...artifact,
      profile: { ...artifact.profile, version: '1.1.0' },
      validation: {
        ...artifact.validation,
        profile: { ...artifact.validation.profile, version: '1.1.0' },
      },
    };
    const nextMajor = {
      ...newerMinor,
      profile: { ...newerMinor.profile, version: '2.0.0' },
      validation: {
        ...newerMinor.validation,
        profile: { ...newerMinor.validation.profile, version: '2.0.0' },
      },
    };

    expect(checkLiatirArtifactCompatibility(newerMinor, geneformerRequirement).status).toBe('compatible');
    expect(checkLiatirArtifactCompatibility(nextMajor, geneformerRequirement).layers.format.status).toBe('incompatible');
  });

  it('rejects renamed non-HDF5 input at the format layer', () => {
    const artifact = validateLiatirAnnDataArtifact({
      sizeBytes: 12,
      sha256,
      validatedAt,
      inspection: { hdf5Signature: false },
    });
    const report = checkLiatirArtifactCompatibility(artifact, geneformerRequirement);

    expect(artifact.validation.status).toBe('invalid');
    expect(report.status).toBe('incompatible');
    expect(report.layers.format.status).toBe('incompatible');
    expect(report.diagnostics.map((item) => item.code)).toContain('anndata.container.invalid');
  });

  it('reports known organism and namespace mismatches before compute', () => {
    const artifact = validAnnData();
    const mismatched = {
      ...artifact,
      qualifiers: {
        ...artifact.qualifiers,
        organism: { taxonId: '10090', name: 'Mus musculus' },
        featureNamespace: 'gene-symbol',
      },
    };
    const report = checkLiatirArtifactCompatibility(mismatched, geneformerRequirement);

    expect(report.status).toBe('incompatible');
    expect(report.layers.transport.status).toBe('compatible');
    expect(report.layers.format.status).toBe('compatible');
    expect(report.layers.scientific.status).toBe('incompatible');
    expect(report.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'artifact.organism.mismatch',
      'artifact.feature-namespace.mismatch',
    ]));
  });

  it('preserves immutable lineage between distinct content identities', () => {
    const source = validAnnData();
    const output = validateLiatirAnnDataArtifact({
      sizeBytes: 2048,
      sha256: 'b'.repeat(64),
      validatedAt,
      inspection: {
        hdf5Signature: true,
        observations: 3,
        variables: 4,
        matrixLocation: 'X',
        matrixPresent: true,
        finiteValues: true,
        nonNegativeValues: true,
        scientificType: 'annotated-matrix',
        organism: { taxonId: '9606', name: 'Homo sapiens' },
        modality: 'single-cell-rna',
        featureNamespace: 'ensembl-gene-id',
        preprocessing: ['raw-counts'],
        representations: ['expression', 'embedding'],
        embeddingKeys: ['X_geneformer'],
      },
      lineage: {
        sources: [liatirArtifactLineageSource(source, 'input', 'inputFile')],
        transformation: {
          id: 'ai-single-cell-embedding',
          label: 'Single-cell Embedding',
          version: '1',
          parameters: { modelId: 'geneformer' },
        },
      },
    });

    expect(output.physical.artifactId).not.toBe(source.physical.artifactId);
    expect(output.lineage?.sources).toEqual([{
      artifactId: source.physical.artifactId,
      digest: source.physical.digest,
      role: 'input',
      fieldKey: 'inputFile',
    }]);
    expect(output.lineage?.transformation?.id).toBe('ai-single-cell-embedding');
  });
});
