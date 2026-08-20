/**
 * Tests the retrieval that decides what Quenta actually sees.
 *
 * This is the load-bearing step of the assistant: a correct model given the wrong context produces a confident,
 * wrong answer. So the tests cover both halves — that the *right* sources are selected, and that they are wrapped
 * in the tagged blocks that let the answer cite them and let a fabricated citation be filtered out.
 */
import { describe, expect, it } from 'vitest';

import {
  citedSources,
  isQuentaSelfDocumentation,
  retrieveQuentaContext,
} from '../../frontend/src/lib/quenta/retrieval';
import { buildQuentaMessages } from '../../frontend/src/lib/quenta/prompt';
import { quentaResponseNeedsPlainLanguageRepair } from '../../frontend/src/lib/quenta/response-safety';
import { sanitizeQuentaReasoning } from '../../frontend/src/lib/quenta/reasoning-safety';
import type { LiatirQuentaContextDocument } from '../../packages/liatir-core/src';

const docs: LiatirQuentaContextDocument[] = [
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

describe('Quenta retrieval', () => {
  it('selects relevant local sources and emits source-wrapped context', () => {
    const result = retrieveQuentaContext('why did the native tool fail with missing reference index', docs);

    expect(result.documents.map((doc) => doc.id)).toContain('job:failed');
    expect(result.context).toContain('<source id="job:failed"');
    expect(result.citations.find((citation) => citation.id === 'job:failed')?.excerpt).toContain('missing reference');
  });

  it('forces focused source IDs into the retrieval set', () => {
    const result = retrieveQuentaContext('general quality control explanation', docs, {
      requiredIds: ['result:run-a'],
      limit: 1,
    });

    expect(result.documents.map((doc) => doc.id)).toEqual(['result:run-a']);
  });

  it('identifies the exact focused result as the primary subject', () => {
    const messages = buildQuentaMessages(
      'Explain this result.',
      '<source id="result:run-a">Selected result</source>',
      [],
      'explain-result',
      { kind: 'result', entityId: 'run-a' },
    );

    expect(messages.at(-1)?.content).toContain('selected subject is exactly [result:run-a]');
    expect(messages.at(-1)?.content).toContain('Do not replace it with');
    expect(messages.at(-1)?.content).toContain('Explain the selected result thoroughly');
  });

  it('flags developer-facing answers for plain-language repair', () => {
    expect(quentaResponseNeedsPlainLanguageRepair(
      'Run `docker inspect image` and check the system PATH.',
    )).toBe(true);
    expect(quentaResponseNeedsPlainLanguageRepair(
      'The result did not complete, so no biological interpretation is available yet.',
    )).toBe(false);
  });

  it('keeps useful reasoning while redacting local paths and oversized lines', () => {
    const reasoning = sanitizeQuentaReasoning(
      `Checking /Users/lorenzo/private/result.json\n${'evidence '.repeat(200)}`,
    );

    expect(reasoning).toContain('Checking [local path]');
    expect(reasoning).not.toContain('/Users/lorenzo');
    expect(reasoning.split('\n')[1].length).toBeLessThanOrEqual(801);
  });

  it('extracts explicit citations from model text', () => {
    const citations = citedSources('The failure is visible in [job:failed], not [missing:id].', docs);

    expect(citations.map((citation) => citation.id)).toEqual(['job:failed']);
  });

  /**
   * Quenta's own usage pages describe how to *ask* for an explanation, which is never evidence for
   * what a Result means — but their wording matches such a question almost perfectly, so they
   * outranked the science and were then cited back at the user as sources for their experiment.
   */
  it('recognises Quenta usage documentation so a focused explanation can exclude it', () => {
    expect(isQuentaSelfDocumentation('docs:ai/quenta')).toBe(true);
    expect(isQuentaSelfDocumentation('docs:ai/quenta#explaining-a-result')).toBe(true);

    // Product documentation that merely mentions Quenta stays retrievable, and so does anything
    // under a path that only shares the prefix.
    expect(isQuentaSelfDocumentation('docs:ai/quenta-models')).toBe(false);
    expect(isQuentaSelfDocumentation('docs:plugins/plugin-context#runtime-validation')).toBe(false);
    expect(isQuentaSelfDocumentation('result:abc')).toBe(false);
  });
});
