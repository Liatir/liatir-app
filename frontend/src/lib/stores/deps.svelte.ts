import { offlab } from '$lib/api';

export interface DepResult {
  binary: string;
  available: boolean;
  path: string | null;
  version: string | null;
}

export const COMMON_TOOLS = [
  'fastqc',
  'bwa',
  'samtools',
  'minimap2',
  'hisat2',
  'star',
  'nextflow',
  'snakemake',
  'bcftools',
  'bedtools',
] as const;

function createDepsStore() {
  let results = $state<DepResult[]>([]);
  let loading = $state(false);
  let checked = $state(false);

  return {
    get results() { return results; },
    get loading() { return loading; },
    get checked() { return checked; },

    get availableCount() {
      return results.filter((r) => r.available).length;
    },

    async checkAll() {
      const api = offlab();
      if (!api) return;
      loading = true;
      try {
        results = await api.deps.checkMany([...COMMON_TOOLS]);
        checked = true;
      } finally {
        loading = false;
      }
    },

    async checkOne(binary: string): Promise<DepResult | null> {
      const api = offlab();
      if (!api) return null;
      return await api.deps.check(binary);
    },
  };
}

export const depsStore = createDepsStore();
