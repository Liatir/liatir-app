/**
 * Tests report generation: a structured report parses, and renders to stable markdown.
 *
 * Stability is the property under test. A report is something a user saves and shares, so the same input has to
 * produce the same document — not one that reshuffles between runs.
 */
import { describe, expect, it } from 'vitest';

import {
  parseQuentaReport,
  quentaReportToMarkdown,
} from '../../frontend/src/lib/quenta/report';
import { summarizeToolOutput } from '../../frontend/src/lib/quenta/output-summary';

describe('Quenta reports', () => {
  it('parses a structured report and renders stable markdown', () => {
    const report = parseQuentaReport(JSON.stringify({
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
      limitations: ['No raw FASTQ was inspected by Quenta.'],
      recommendedNextSteps: ['Validate adapter and quality profiles.'],
      citationIds: ['result:run-a'],
    }), '2026-07-09T12:00:00.000Z');

    expect(report.runStatus).toBe('done');
    expect(report.findings[0].citationIds).toEqual(['result:run-a']);

    const markdown = quentaReportToMarkdown(report);
    expect(markdown).toContain('# FASTQ QC report');
    expect(markdown).toContain('Sources: [result:run-a]');
    expect(markdown).toContain('- [result:run-a]');
  });

  it('rejects malformed report payloads instead of accepting uncited prose', () => {
    expect(() => parseQuentaReport('not json')).toThrow(/invalid structured report/);
    expect(() => parseQuentaReport(JSON.stringify({ title: 'Incomplete' }))).toThrow(/missing/);
  });

  it('extracts a valid structured report from common local-model wrappers', () => {
    const payload = JSON.stringify({
      title: 'Wrapped report',
      subject: 'result:wrapped',
      executiveSummary: 'Observed evidence was reviewed.',
      methods: [],
      findings: [],
      limitations: ['No additional evidence was available.'],
      recommendedNextSteps: [],
      citationIds: ['result:wrapped'],
    });

    expect(parseQuentaReport(`\`\`\`json\n${payload}\n\`\`\``).title).toBe('Wrapped report');
    expect(parseQuentaReport(`Here is the report:\n${payload}\nEnd of report.`).subject)
      .toBe('result:wrapped');
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
