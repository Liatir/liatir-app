import { describe, expect, it } from 'vitest';

import {
  parseTutorReport,
  tutorReportToMarkdown,
} from '../../frontend/src/lib/tutor/report';
import { summarizeToolOutput } from '../../frontend/src/lib/tutor/output-summary';

describe('Tutor reports', () => {
  it('parses a structured report and renders stable markdown', () => {
    const report = parseTutorReport(JSON.stringify({
      title: 'FASTQ QC report',
      subject: 'result:run-a',
      runStatus: 'done',
      executiveSummary: 'The run completed and produced QC metrics.',
      methods: ['Reviewed structured output and log evidence.'],
      findings: [
        {
          title: 'Read count observed',
          interpretation: 'The result contains an observed read count.',
          evidence: ['SeqKit reported 42 reads.'],
          citationIds: ['result:run-a'],
        },
      ],
      limitations: ['No raw FASTQ was inspected by the Tutor.'],
      recommendedNextSteps: ['Validate adapter and quality profiles.'],
      citationIds: ['result:run-a'],
    }), '2026-07-09T12:00:00.000Z');

    expect(report.runStatus).toBe('done');
    expect(report.findings[0].citationIds).toEqual(['result:run-a']);

    const markdown = tutorReportToMarkdown(report);
    expect(markdown).toContain('# FASTQ QC report');
    expect(markdown).toContain('Sources: [result:run-a]');
    expect(markdown).toContain('- [result:run-a]');
  });

  it('rejects malformed report payloads instead of accepting uncited prose', () => {
    expect(() => parseTutorReport('not json')).toThrow(/invalid structured report/);
    expect(() => parseTutorReport(JSON.stringify({ title: 'Incomplete' }))).toThrow(/missing/);
  });

  it('summarizes heterogeneous ToolOutput sections for model context', () => {
    const summary = summarizeToolOutput({
      sections: [
        { type: 'stats', items: [{ label: 'reads', value: 42 }] },
        { type: 'number', label: 'GC', value: 51.2, unit: '%' },
        { type: 'text', label: 'Warnings', content: 'Adapter content was elevated.' },
      ],
    });

    expect(summary).toContain('reads=42');
    expect(summary).toContain('GC=51.2 %');
    expect(summary).toContain('Adapter content');
  });
});
