import { describe, expect, it } from 'vitest';

import {
  citedSources,
  retrieveTutorContext,
} from '../../frontend/src/lib/tutor/retrieval';
import type { LiatirTutorContextDocument } from '../../packages/liatir-core/src';

const docs: LiatirTutorContextDocument[] = [
  {
    id: 'result:run-a',
    sourceKind: 'result',
    title: 'SeqKit QC result',
    locator: 'Results / seqkit / run-a',
    content: 'SeqKit reported 42 reads and GC content warnings for the FASTQ input.',
  },
  {
    id: 'pipeline:align',
    sourceKind: 'pipeline',
    title: 'Alignment pipeline',
    locator: 'Pipelines / align',
    content: 'A minimap2 step feeds a samtools flagstat quality-control step.',
  },
  {
    id: 'job:failed',
    sourceKind: 'job',
    title: 'Failed native tool job',
    locator: 'Jobs / failed',
    content: 'stderr: missing reference index caused the native tool to fail.',
  },
];

describe('Tutor retrieval', () => {
  it('selects relevant local sources and emits source-wrapped context', () => {
    const result = retrieveTutorContext('why did the native tool fail with missing reference index', docs);

    expect(result.documents.map((doc) => doc.id)).toContain('job:failed');
    expect(result.context).toContain('<source id="job:failed"');
    expect(result.citations.find((citation) => citation.id === 'job:failed')?.excerpt).toContain('missing reference');
  });

  it('forces focused source IDs into the retrieval set', () => {
    const result = retrieveTutorContext('general quality control explanation', docs, {
      requiredIds: ['result:run-a'],
      limit: 1,
    });

    expect(result.documents.map((doc) => doc.id)).toEqual(['result:run-a']);
  });

  it('extracts explicit citations from model text', () => {
    const citations = citedSources('The failure is visible in [job:failed], not [missing:id].', docs);

    expect(citations.map((citation) => citation.id)).toEqual(['job:failed']);
  });
});
