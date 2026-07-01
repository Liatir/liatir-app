import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(import.meta.dirname, '../..');
const demoDir = resolve(rootDir, 'src-tauri/resources/demo-files');
const referencePath = resolve(demoDir, 'fasta/demo_genome.fasta');
const vcfPath = resolve(demoDir, 'vcf/demo_variant_effect.vcf');
const gzVcfPath = resolve(demoDir, 'vcf/demo_variant_effect.vcf.gz');
const sourcePath = resolve(rootDir, 'frontend/src/lib/tools/ai/genomic-variant-effect.ts');
const scriptPath = resolve(rootDir, 'frontend/src/lib/tools/ai/python-scripts/genomic-variant-effect.ts');

interface VariantRecord {
  chrom: string;
  pos: number;
  id: string;
  ref: string;
  alt: string;
}

function parseFasta(text: string): Record<string, string> {
  const records: Record<string, string> = {};
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>')) {
      current = line.slice(1).trim().split(/\s+/)[0];
      records[current] = '';
    } else if (current) {
      records[current] += line.toUpperCase();
    }
  }
  return records;
}

function parseVcf(text: string): VariantRecord[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const [chrom, posRaw, id, ref, alt] = line.split('\t');
      return { chrom, pos: Number(posRaw), id, ref, alt };
    });
}

describe('genomic variant effect fixtures', () => {
  it('keeps the VCF and VCF.GZ demo files equivalent', () => {
    const plain = readFileSync(vcfPath, 'utf8');
    const compressed = gunzipSync(readFileSync(gzVcfPath)).toString('utf8');

    expect(compressed).toBe(plain);
  });

  it('keeps demo variant REF alleles aligned with the demo FASTA', () => {
    const reference = parseFasta(readFileSync(referencePath, 'utf8'));
    const variants = parseVcf(readFileSync(vcfPath, 'utf8'));

    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      const contig = reference[variant.chrom];
      expect(contig, `${variant.id} contig ${variant.chrom} missing from FASTA`).toBeTruthy();
      expect(
        contig.slice(variant.pos - 1, variant.pos - 1 + variant.ref.length),
        `${variant.id} REF mismatch`,
      ).toBe(variant.ref);
    }
  });

  it('exposes compressed VCF as an accepted variant-effect input', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain("accept: ['vcf', 'vcf.gz']");
  });

  it('keeps compressed VCF support in the Python runtime script', () => {
    const source = readFileSync(scriptPath, 'utf8');

    expect(source).toContain('import gzip');
    expect(source).toContain('gzip.open(path, "rt"');
  });
});
