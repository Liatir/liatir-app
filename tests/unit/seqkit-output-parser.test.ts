import { describe, expect, it } from 'vitest';

import { parseSeqkitStats, seqkitStatsToToolOutput } from '../../packages/liatir-output-parser/src/qc/seqkit';

describe('SeqKit output parsing', () => {
  it('keeps an aligned file path with spaces from shifting scientific columns', () => {
    const stdout = [
      'file                                      format  type  num_seqs  sum_len  min_len  avg_len  max_len',
      '/data/Gate 8 reads/reads with space.fastq  FASTQ   DNA          17       680       40       40       40',
    ].join('\n');

    const parsed = parseSeqkitStats(stdout);

    expect(parsed).toMatchObject({
      file: '/data/Gate 8 reads/reads with space.fastq',
      format: 'FASTQ',
      type: 'DNA',
      numSeqs: 17,
      sumLen: 680,
      minLen: 40,
      avgLen: 40,
      maxLen: 40,
    });
    const stats = seqkitStatsToToolOutput(parsed!, stdout).sections.find((section) => section.type === 'stats');
    expect(stats?.items.find((item) => item.label === 'Sequences')?.value).toBe('17');
  });
});
