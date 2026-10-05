import type { ToolOutput, ToolSection } from '$lib/types/tool-output';
import type { AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
import { fmtDuration, fmtBytes } from '$lib/utils';
import { loadPlotlySource } from '$lib/utils/plotly-runtime';

const TOOL_LABELS: Record<string, string> = {
  pipeline: 'Pipeline',
  fastqc: 'FastQC',
  fastp: 'fastp',
  seqkit: 'SeqKit',
  'seqkit-stats': 'SeqKit stats',
  samtools: 'Samtools',
  'samtools-flagstat': 'Samtools flagstat',
  'samtools-faidx': 'Samtools faidx',
  'bwa-mem': 'BWA-MEM',
  minimap2: 'minimap2',
  bcftools: 'BCFtools',
  'bcftools-stats': 'BCFtools stats',
  'bcftools-filter': 'BCFtools filter',
  snpeff: 'SnpEff',
  'snpsift-filter': 'SnpSift Filter',
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Neutralises any literal `</script>` inside JS embedded in the report, so a chart's data — or the
// Plotly library itself — can never close its host <script> element early and break the page.
function escScript(s: string): string {
  return s.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * The Plotly runtime, inlined into the report as a self-contained <script>.
 *
 * The export used to pull Plotly from a CDN, which left every chart blank when the report was opened
 * offline — unacceptable for a local-first app whose reports must stay readable years later. Inlining
 * the bundled library instead makes each report fully self-contained, and uses the *same* Plotly
 * version as the in-app charts. Read on demand from that same local asset only
 * when a chart exists, avoiding a second escaped JavaScript copy in the app bundle.
 */
async function inlinePlotlyRuntime(): Promise<string> {
  return `<script>${escScript(await loadPlotlySource())}</script>`;
}

function colorClass(color?: string): string {
  if (color === 'green') return 'color:#059669';
  if (color === 'red') return 'color:#dc2626';
  if (color === 'amber' || color === 'yellow') return 'color:#d97706';
  return '';
}

function renderSection(s: ToolSection, chartIdx: { n: number }): string {
  switch (s.type) {
    case 'stats': {
      const items = s.items.map(it => `
        <div class="stat">
          <div class="stat-label">${escHtml(it.label)}</div>
          <div class="stat-value" style="${colorClass(it.color)}">${escHtml(String(it.value))}</div>
          ${it.description ? `<div class="stat-desc">${escHtml(it.description)}</div>` : ''}
        </div>`).join('');
      return `<div class="stat-grid">${items}</div>`;
    }

    case 'number': {
      const fmt = (v: number, f?: string) => {
        if (f === 'percent') return (v * 100).toFixed(1) + '%';
        if (f === 'bytes') return fmtBytes(v);
        if (f === 'decimal') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return Math.round(v).toLocaleString();
      };
      return `
        <div class="number-card">
          <div class="stat-label">${escHtml(s.label)}</div>
          <div class="number-value" style="${colorClass(s.color)}">${escHtml(fmt(s.value, s.format))}${s.unit ? `<span class="number-unit"> ${escHtml(s.unit)}</span>` : ''}</div>
          ${s.description ? `<div class="stat-desc">${escHtml(s.description)}</div>` : ''}
        </div>`;
    }

    case 'text': {
      const lines = s.content.split('\n').slice(0, 2000);
      const truncated = s.content.split('\n').length > 2000;
      return `
        <h2>${escHtml(s.label)}</h2>
        ${s.description ? `<p class="section-desc">${escHtml(s.description)}</p>` : ''}
        <pre>${escHtml(lines.join('\n'))}${truncated ? '\n… (truncated)' : ''}</pre>`;
    }

    case 'table': {
      const ths = s.headers.map(h => `<th>${escHtml(h)}</th>`).join('');
      const trs = s.rows.map(row =>
        `<tr>${row.map(c => `<td>${escHtml(String(c))}</td>`).join('')}</tr>`
      ).join('');
      return `
        <h2>${escHtml(s.label)}</h2>
        <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }

    case 'plotly': {
      const id = `chart${chartIdx.n++}`;
      const dataJson = escScript(JSON.stringify(s.data));
      const layoutJson = escScript(JSON.stringify({ ...s.layout, autosize: true }));
      return `
        ${s.title ? `<h2>${escHtml(s.title)}</h2>` : ''}
        ${s.description ? `<p class="section-desc">${escHtml(s.description)}</p>` : ''}
        <div id="${id}" class="chart"></div>
        <script>Plotly.newPlot('${id}', ${dataJson}, ${layoutJson}, {responsive:true, displaylogo:false});</script>`;
    }

    default:
      return '';
  }
}

export async function exportToHtml(run: AnalysisRunMeta, output: ToolOutput): Promise<string> {
  const toolLabel = TOOL_LABELS[run.tool] ?? run.tool;
  const date = new Date(run.startedAt).toLocaleString();
  const day = new Date(run.startedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const duration = fmtDuration(run.startedAt, run.endedAt);
  const inputNames = run.inputs.map(p => p.split(/[\\/]/).pop() ?? p).join(', ');
  const chartIdx = { n: 0 };

  // Exclude raw stdout/stderr dumps — they're redundant with the run log and
  // make the printable/PDF export noisy.
  const sections = output.sections
    .filter(s => !(s.type === 'text' && s.raw))
    .map(s => renderSection(s, chartIdx))
    .join('\n');

  // Carry the Plotly runtime only when the report actually contains a chart; a report of just stats
  // and tables ships no JS at all and stays a few KB.
  const plotlyRuntime = chartIdx.n > 0 ? await inlinePlotlyRuntime() : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(toolLabel)} — ${escHtml(run.label)}</title>
${plotlyRuntime}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1.5rem; color: #111827; background: #fff; }
  h1 { font-size: 1.375rem; font-weight: 700; margin: 0 0 0.25rem; }
  h2 { font-size: 0.9375rem; font-weight: 600; margin: 2rem 0 0.625rem; color: #374151; }
  .meta { color: #6b7280; font-size: 0.8125rem; margin-bottom: 2rem; }
  .meta .spacer { margin-right: 0.6rem; margin-left: 0.6rem;}
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.625rem; margin-bottom: 1rem; }
  .stat { padding: 0.75rem 1rem; background: #f9fafb; border-radius: 0.5rem; border: 1px solid #e5e7eb; }
  .stat-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; margin-bottom: 0.25rem; }
  .stat-value { font-size: 1.0625rem; font-weight: 600; }
  .stat-desc { font-size: 0.6875rem; color: #9ca3af; margin-top: 0.25rem; }
  .number-card { display: inline-block; padding: 1rem 1.5rem; background: #f9fafb; border-radius: 0.5rem; border: 1px solid #e5e7eb; margin-bottom: 1rem; }
  .number-value { font-size: 2rem; font-weight: 700; }
  .number-unit { font-size: 1rem; font-weight: 400; color: #6b7280; }
  .section-desc { font-size: 0.8125rem; color: #6b7280; margin-top: -0.25rem; margin-bottom: 0.75rem; }
  pre { background: #111827; color: #d1d5db; padding: 1rem 1.25rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.8125rem; line-height: 1.6; white-space: pre; }
  table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; margin-bottom: 1rem; }
  thead { background: #f9fafb; }
  th { text-align: left; padding: 0.5rem 0.875rem; border-bottom: 2px solid #e5e7eb; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td { padding: 0.5rem 0.875rem; border-bottom: 1px solid #f3f4f6; }
  tr:hover td { background: #f9fafb; }
  .chart { border: 1px solid #e5e7eb; border-radius: 0.5rem; min-height: 300px; margin-bottom: 1rem; }
  #liatir-logo {
    display: flex;
    height: 12px;
    width: 12px;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    background-color: rgba(130, 130, 130);
    flex-shrink: 0;
    padding: 0.375rem;
    opacity: 0.5;
  }
  #liatir-link {
    text-decoration: none;
    color: #9ca3af;
  }
  #liatir-link:hover {
    text-decoration: underline;
  }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #f3f4f6; font-size: 0.75rem; color: #9ca3af; display: flex; align-items: center; justify-content: space-between; }
  .print-btn { padding: 0.25rem 0.625rem; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 0.25rem; font-size: 0.6875rem; color: #6b7280; cursor: pointer; }
  .print-btn:hover { background: #e5e7eb; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
<h1>${escHtml(toolLabel)}: ${escHtml(run.label)}</h1>
<p class="meta">
  <span>${escHtml(day)}</span><span class="spacer">·</span><span>Duration: ${escHtml(duration)}</span><span class="spacer">·</span>${inputNames ? `<span>Input: ${escHtml(inputNames)}</span>` : ''}<span class="spacer">·</span>${run.outputSize != null ? `<span>Output: ${escHtml(fmtBytes(run.outputSize))}</span>` : ''}
</p>

${sections}

<footer>
  <span>Generated by <strong><a href="https://liatir.com" id="liatir-link" target="_blank">Liatir</a></strong></span>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</footer>
</body>
</html>`;
}
