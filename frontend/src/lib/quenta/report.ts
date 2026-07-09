import type { JsonValue, LiatirQuentaReport } from '@liatir/core';

export const QUENTA_REPORT_SCHEMA: JsonValue = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    subject: { type: 'string' },
    runStatus: { type: 'string', enum: ['done', 'error', 'cancelled'] },
    executiveSummary: { type: 'string' },
    methods: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          interpretation: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          citationIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'interpretation', 'evidence', 'citationIds'],
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
    recommendedNextSteps: { type: 'array', items: { type: 'string' } },
    citationIds: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'title', 'subject', 'executiveSummary', 'methods', 'findings',
    'limitations', 'recommendedNextSteps', 'citationIds',
  ],
};

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Quenta report field "${field}" must be a string array`);
  }
  return value;
}

export function parseQuentaReport(content: string, generatedAt = new Date().toISOString()): LiatirQuentaReport {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error('The local model returned an invalid structured report');
  }
  for (const key of ['title', 'subject', 'executiveSummary'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key].trim()) {
      throw new Error(`Quenta report field "${key}" is missing`);
    }
  }
  if (!Array.isArray(raw.findings)) throw new Error('Quenta report findings are missing');
  const findings = raw.findings.map((value, index) => {
    const finding = value as Record<string, unknown>;
    if (typeof finding?.title !== 'string' || typeof finding?.interpretation !== 'string') {
      throw new Error(`Quenta report finding ${index + 1} is invalid`);
    }
    return {
      title: finding.title,
      interpretation: finding.interpretation,
      evidence: stringArray(finding.evidence, `findings[${index}].evidence`),
      citationIds: stringArray(finding.citationIds, `findings[${index}].citationIds`),
    };
  });
  const runStatus = raw.runStatus;
  if (runStatus !== undefined && !['done', 'error', 'cancelled'].includes(String(runStatus))) {
    throw new Error('Quenta report runStatus is invalid');
  }
  return {
    title: raw.title as string,
    generatedAt,
    subject: raw.subject as string,
    runStatus: runStatus as LiatirQuentaReport['runStatus'],
    executiveSummary: raw.executiveSummary as string,
    methods: stringArray(raw.methods, 'methods'),
    findings,
    limitations: stringArray(raw.limitations, 'limitations'),
    recommendedNextSteps: stringArray(raw.recommendedNextSteps, 'recommendedNextSteps'),
    citationIds: stringArray(raw.citationIds, 'citationIds'),
  };
}

export function quentaReportToMarkdown(report: LiatirQuentaReport): string {
  const lines = [
    `# ${report.title}`,
    '',
    `Generated: ${report.generatedAt}`,
    `Subject: ${report.subject}`,
    ...(report.runStatus ? [`Run status: ${report.runStatus}`] : []),
    '',
    '## Executive summary',
    '',
    report.executiveSummary,
    '',
    '## Methods',
    '',
    ...report.methods.map((method) => `- ${method}`),
    '',
    '## Findings',
    '',
  ];
  for (const finding of report.findings) {
    lines.push(`### ${finding.title}`, '', finding.interpretation, '');
    if (finding.evidence.length) {
      lines.push('Evidence:', ...finding.evidence.map((item) => `- ${item}`), '');
    }
    if (finding.citationIds.length) {
      lines.push(`Sources: ${finding.citationIds.map((id) => `[${id}]`).join(' ')}`, '');
    }
  }
  lines.push(
    '## Limitations', '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
    '## Recommended next steps', '',
    ...report.recommendedNextSteps.map((item) => `- ${item}`),
    '',
    '## Sources', '',
    ...report.citationIds.map((id) => `- [${id}]`),
    '',
  );
  return lines.join('\n');
}
