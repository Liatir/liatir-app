/**
 * The single-cell chain's two brittle points, held still.
 *
 * A quantification is a long, expensive run whose result is read entirely from the reports it
 * leaves behind. Everything asserted here is taken from a real `simpleaf quant --anndata-out`
 * run of a spliced+intronic index — three cells, two genes — so the shapes are the tool's, not
 * an invention of the test.
 */
import { describe, expect, it } from 'vitest';

import {
  LIATIR_SINGLE_CELL_INDEX_KIND,
  liatirSingleCellCountsAreWhole,
  liatirSingleCellFeatureNamespace,
  parseLiatirSingleCellIndexManifest,
} from '../../packages/liatir-core/src/single-cell';
import {
  alevinFryToToolOutput,
  parseAlevinFryGeneIds,
  parseAlevinFryPermitList,
  parseAlevinFryQuant,
  parseSimpleafMapInfo,
} from '../../packages/liatir-output-parser/src/single-cell/simpleaf';

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  kind: LIATIR_SINGLE_CELL_INDEX_KIND,
  indexDir: '/runs/abc/output/index/index',
  t2gMap: '/runs/abc/output/index/index/t2g_3col.tsv',
  geneIdToName: '/runs/abc/output/index/index/gene_id_to_name.tsv',
  referenceType: 'spliced+intronic',
  readLength: 91,
  sources: {
    genomeFasta: '/data/GRCh38.primary_assembly.genome.fa',
    annotation: '/data/gencode.v46.annotation.gtf',
    annotationFormat: 'gtf',
  },
  createdAt: '2026-08-24T00:00:00.000Z',
});

// Verbatim from a real run, trimmed to the fields Liatir reads.
const QUANT_JSON = JSON.stringify({
  num_genes: 6,
  num_quantified_cells: 3,
  resolution_strategy: 'CellRangerLike',
  usa_mode: true,
  version_str: '0.18.0',
});

const MAP_INFO_JSON = JSON.stringify({
  num_mapped: 44,
  num_reads: 48,
  percent_mapped: '91.67',
  piscem_rs_version: '0.9.2',
  mode: 'sc-rna',
});

const PERMIT_JSON = JSON.stringify({
  correction_stats: {
    ambiguous_reads: 1,
    corrected_reads: 6,
    exact_reads: 40,
    not_found_reads: 2,
  },
  gpl_options: { fmeth: { ExplicitList: 'barcodes.txt' } },
});

describe('single-cell index manifest', () => {
  it('reads the index a quantification needs', () => {
    const manifest = parseLiatirSingleCellIndexManifest(MANIFEST);
    expect(manifest.indexDir).toBe('/runs/abc/output/index/index');
    expect(manifest.t2gMap).toBe('/runs/abc/output/index/index/t2g_3col.tsv');
    expect(manifest.geneIdToName).toBe('/runs/abc/output/index/index/gene_id_to_name.tsv');
    expect(manifest.readLength).toBe(91);
    expect(manifest.sources.annotationFormat).toBe('gtf');
  });

  it('refuses a file that is not an index rather than starting a long run against it', () => {
    expect(() => parseLiatirSingleCellIndexManifest('not json')).toThrow(/readable JSON/);
    expect(() => parseLiatirSingleCellIndexManifest('{"kind":"something-else"}'))
      .toThrow(/not a Liatir single-cell index/);
    expect(() => parseLiatirSingleCellIndexManifest(
      JSON.stringify({ kind: LIATIR_SINGLE_CELL_INDEX_KIND, schemaVersion: 2 }),
    )).toThrow(/newer version of Liatir/);
  });

  it('refuses a manifest whose index it could not actually find', () => {
    const incomplete = JSON.parse(MANIFEST);
    delete incomplete.t2gMap;
    expect(() => parseLiatirSingleCellIndexManifest(JSON.stringify(incomplete)))
      .toThrow(/t2gMap/);
    const noReadLength = JSON.parse(MANIFEST);
    noReadLength.readLength = 0;
    expect(() => parseLiatirSingleCellIndexManifest(JSON.stringify(noReadLength)))
      .toThrow(/readLength/);
  });

  it('keeps an index without gene symbols usable', () => {
    const bare = JSON.parse(MANIFEST);
    delete bare.geneIdToName;
    expect(parseLiatirSingleCellIndexManifest(JSON.stringify(bare)).geneIdToName)
      .toBeUndefined();
  });
});

describe('single-cell scientific declarations', () => {
  it('calls only the non-EM resolutions whole counts', () => {
    expect(liatirSingleCellCountsAreWhole('cr-like')).toBe(true);
    expect(liatirSingleCellCountsAreWhole('parsimony')).toBe(true);
    expect(liatirSingleCellCountsAreWhole('parsimony-gene')).toBe(true);
    expect(liatirSingleCellCountsAreWhole('cr-like-em')).toBe(false);
    expect(liatirSingleCellCountsAreWhole('parsimony-gene-em')).toBe(false);
  });

  it('names the feature namespace only when it can be recognised', () => {
    expect(liatirSingleCellFeatureNamespace(['ENSG00000141510', 'ENSG00000012048']))
      .toBe('ensembl-gene-id');
    // GENCODE carries a version suffix, and it is still an Ensembl gene id.
    expect(liatirSingleCellFeatureNamespace(['ENSG00000141510.17', 'ENSMUSG00000017146.9']))
      .toBe('ensembl-gene-id');
    // Gene symbols are arbitrary words: unknown is the truth, not "not Ensembl".
    expect(liatirSingleCellFeatureNamespace(['TP53', 'BRCA1'])).toBeUndefined();
    expect(liatirSingleCellFeatureNamespace([])).toBeUndefined();
    // A handful of odd entries must not lose a genuinely Ensembl reference.
    const mostly = [...Array(19).fill('ENSG00000141510'), 'SPIKE-IN-1'];
    expect(liatirSingleCellFeatureNamespace(mostly)).toBe('ensembl-gene-id');
  });
});

describe('alevin-fry reports', () => {
  it('reads the matrix shape in genes, not USA columns', () => {
    const quant = parseAlevinFryQuant(QUANT_JSON);
    expect(quant.usaMode).toBe(true);
    expect(quant.cells).toBe(3);
    expect(quant.genes).toBe(2);
    expect(quant.resolution).toBe('CellRangerLike');
  });

  it('reads a plain, non-USA quantification unchanged', () => {
    const quant = parseAlevinFryQuant(
      JSON.stringify({ num_genes: 3, num_quantified_cells: 4, usa_mode: false, version_str: '0.18.0' }),
    );
    expect(quant.genes).toBe(3);
    expect(quant.usaMode).toBe(false);
  });

  it('refuses a report that contradicts itself', () => {
    expect(() => parseAlevinFryQuant(
      JSON.stringify({ num_genes: 5, num_quantified_cells: 3, usa_mode: true }),
    )).toThrow(/divisible by three/);
    expect(() => parseAlevinFryQuant(JSON.stringify({ num_genes: 0 })))
      .toThrow(/no genes/);
    expect(() => parseAlevinFryQuant('{')).toThrow(/readable JSON/);
  });

  it('takes the first block of a USA-mode column list as the gene list', () => {
    const columns = 'G1\nG2\nG1-U\nG2-U\nG1-A\nG2-A\n';
    expect(parseAlevinFryGeneIds(columns, true)).toEqual(['G1', 'G2']);
    expect(parseAlevinFryGeneIds('G1\nG2\nG3\n', false)).toEqual(['G1', 'G2', 'G3']);
    expect(() => parseAlevinFryGeneIds('G1\nG2\n', true)).toThrow(/three USA-mode blocks/);
  });

  it('separates the reads that were mapped from the barcodes that were kept', () => {
    const mapping = parseSimpleafMapInfo(MAP_INFO_JSON);
    expect(mapping.reads).toBe(48);
    expect(mapping.percentMapped).toBeCloseTo(91.67, 2);
    expect(mapping.mapper).toBe('piscem 0.9.2');

    const permit = parseAlevinFryPermitList(PERMIT_JSON);
    expect(permit.exactReads).toBe(40);
    expect(permit.correctedReads).toBe(6);
    // Ambiguous and not-found are both reads that reached no cell.
    expect(permit.discardedReads).toBe(3);
    expect(permit.method).toBe('ExplicitList');
  });

  it('computes a mapping rate when the tool reports none', () => {
    const mapping = parseSimpleafMapInfo(JSON.stringify({ num_reads: 200, num_mapped: 50 }));
    expect(mapping.percentMapped).toBe(25);
    expect(parseSimpleafMapInfo(JSON.stringify({ num_reads: 0, num_mapped: 0 })).percentMapped)
      .toBe(0);
  });

  it('reports what the matrix contains, in the words of the run that made it', () => {
    const output = alevinFryToToolOutput({
      mapping: parseSimpleafMapInfo(MAP_INFO_JSON),
      permit: parseAlevinFryPermitList(PERMIT_JSON),
      quant: parseAlevinFryQuant(QUANT_JSON),
      matrixFileName: 'pbmc.h5ad',
    });
    const rendered = JSON.stringify(output);
    expect(rendered).toContain('pbmc.h5ad');
    expect(rendered).toContain('spliced + unspliced + ambiguous');
    expect(rendered).toContain('from the barcode list you supplied');
  });
});
