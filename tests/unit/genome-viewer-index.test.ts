/** The Genome Track Viewer hands JBrowse the index a BAM or bgzipped VCF needs, making one if a BAM has none. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const harness = vi.hoisted(() => ({
  files: new Set<string>(),
  samtools: [] as string[][],
  samtoolsFails: false,
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({
    invoke: vi.fn(async (command: string, payload?: { path?: string }) => {
      if (command === 'lia_file_size' && harness.files.has(payload?.path ?? '')) return 1;
      throw new Error(`${command} ${payload?.path}: not found`);
    }),
  }),
}));

vi.mock('$lib/utils/native-tool', () => ({
  runNativeTool: vi.fn(async (cmd: string, args: string[]) => {
    harness.samtools.push([cmd, ...args]);
    if (harness.samtoolsFails) {
      return {
        jobId: 'job',
        stdout: '',
        // What samtools 1.24 prints for an unsorted BAM of the yeast demo reads.
        stderr: [
          '[E::hts_idx_push] Unsorted positions on sequence #1: 47799 followed by 47590',
          "[E::sam_index] Read 'SRR11697748.50' with ref_name='I', ref_length=230218, flags=163, pos=47590 cannot be indexed",
          'samtools index: failed to create index for "reads.bam"',
          '',
        ].join('\n'),
        exitCode: 1,
        ok: false,
      };
    }
    harness.files.add(`${args[1]}.bai`);
    return { jobId: 'job', stdout: '', stderr: '', exitCode: 0, ok: true };
  }),
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  SANDBOX_WORKSPACE_ID: 'sandbox',
  getDataPrefix: () => 'workspaces/workspace-a/',
}));

vi.mock('$lib/stores/app-storage', () => ({
  appStorage: { writeText: vi.fn(), readText: vi.fn(async () => ''), exists: vi.fn(async () => false) },
}));

const { runGenomeViewerStep } = await import('../../frontend/src/lib/tools/viewers/scientific-viewers');

async function viewedTrack(trackFile: string) {
  const result = await runGenomeViewerStep({ trackFile }, '', () => {});
  const section = result.output.sections[0] as { tracks: { indexPath?: string }[] };
  return section.tracks[0];
}

beforeEach(() => {
  harness.files = new Set();
  harness.samtools = [];
  harness.samtoolsFails = false;
});

describe('Genome Track Viewer indexes', () => {
  it('uses the index samtools or Picard left beside a BAM', async () => {
    harness.files.add('/data/reads.bam.bai');
    expect((await viewedTrack('/data/reads.bam')).indexPath).toBe('/data/reads.bam.bai');

    harness.files = new Set(['/data/reads.bai']);
    expect((await viewedTrack('/data/reads.bam')).indexPath).toBe('/data/reads.bai');
    expect(harness.samtools).toEqual([]);
  });

  it('indexes a BAM that arrived without one', async () => {
    expect((await viewedTrack('/data/reads.bam')).indexPath).toBe('/data/reads.bam.bai');
    expect(harness.samtools).toEqual([['samtools', 'index', '/data/reads.bam']]);
  });

  it('says why an unsorted BAM cannot be shown', async () => {
    harness.samtoolsFails = true;
    await expect(viewedTrack('/data/reads.bam')).rejects.toThrow(
      'reads.bam is not sorted by position, so it cannot be indexed or shown.',
    );
  });

  it('passes a bgzipped VCF its tabix index and reads a plain VCF whole', async () => {
    harness.files.add('/data/calls.vcf.gz.tbi');
    expect((await viewedTrack('/data/calls.vcf.gz')).indexPath).toBe('/data/calls.vcf.gz.tbi');
    expect((await viewedTrack('/data/calls.vcf')).indexPath).toBeUndefined();
    expect(harness.samtools).toEqual([]);
  });
});
