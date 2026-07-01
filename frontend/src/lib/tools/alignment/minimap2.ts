import type { PipelineStepDefinition } from '$lib/types/pipeline';
import { threadInputSchema } from '$lib/utils/execution-resources';

// Parsers and presets now live in the shared @liatir/output-parser package
// (single source of truth). The pipeline-step definition stays here.
export {
  MINIMAP2_PRESETS,
  parseMinimap2Stats,
  minimap2ToToolOutput,
  type Minimap2Preset,
  type Minimap2Stats,
} from '@liatir/output-parser';

export const minimap2Definition: PipelineStepDefinition = {
  id: 'minimap2',
  type: 'native-tool',
  label: 'Minimap2',
  description: 'Versatile alignment for long and short reads. Outputs SAM format.',
  category: 'Alignment',
  inputSchema: {
    reference: { type: 'file', label: 'Reference FASTA', required: true, accept: ['fa', 'fasta', 'fa.gz', 'fasta.gz', 'mmi'] },
    reads:     { type: 'file', label: 'Reads (FASTQ/FASTA)', required: true, accept: ['fastq', 'fastq.gz', 'fq', 'fq.gz', 'fa', 'fasta'] },
    threads: threadInputSchema('Worker threads for minimap2. 0 lets Liatir choose a safe local value.'),
  },
  outputSchema: {
    outputSam: { type: 'file', label: 'Output SAM', ext: ['sam'] },
  },
};
