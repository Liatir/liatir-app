#!/usr/bin/env node

/**
 * Asks a real local model for Quenta Stage pages, with exactly what the app sends (prompt, page
 * schema, source description) and exactly the app's check and single repair, and reports how each
 * request went. Run it after changing the Stage kit's elements, the prompt or the Quenta model, and
 * compare with the measurements in the Liatir 1.0 ledger. It needs Ollama running with the model
 * pulled; it downloads nothing and is never part of an automated gate.
 *
 *   node scripts/validate-quenta-presentations.mjs [--model qwen3.5:9b] [--out <dir>] [case …]
 *
 * Each accepted page is written as `<case>.json` ({ sources, page }), the shape of
 * tests/fixtures/stage-gallery.json, so it can be drawn the same way.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FRONTEND = join(ROOT, 'frontend');
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const model = option('--model', 'qwen3.5:9b');
const outDir = resolve(option('--out', mkdtempSync(join(tmpdir(), 'liatir-stage-pages-'))));
const only = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && !all[index - 1]?.startsWith('--'));
const host = process.env.OLLAMA_HOST ?? '127.0.0.1:11434';
const baseUrl = host.startsWith('http') ? host : `http://${host}`;

// The app's own modules, bundled from source so this script cannot drift from them.
const { buildSync } = createRequire(join(FRONTEND, 'package.json'))('esbuild');
const bundle = buildSync({
  stdin: {
    contents: ['src/lib/quenta/presentation-prompt', 'stage-kit/spec/tables', 'stage-kit/spec/check'].map((path) => `export * from './${path}';`).join('\n'),
    resolveDir: FRONTEND, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
}).outputFiles[0].text;
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);

const docking = [{ resultId: 'validation-docking', label: 'Docking of 4 ligands', tool: 'molecular-docking', endedAt: 1, output: { sections: [
  { type: 'table', label: 'Best pose per ligand', headers: ['Ligand', 'Vina score (kcal/mol)', 'Poses'], rows: [['imatinib', -11.2, 9], ['nilotinib', -10.4, 9], ['dasatinib', -9.1, 9], ['aspirin', -5.3, 9]] },
  { type: 'stats', items: [{ label: 'Receptor', value: '1IEP (ABL kinase)' }, { label: 'Exhaustiveness', value: 8 }, { label: 'Box', value: '22 × 22 × 22 Å' }] },
] } }];
// Sixty genes with a deterministic spread of fold changes and p-values, so the run is repeatable.
const genes = [{ resultId: 'validation-genes', label: 'Differential expression: treated vs control', tool: 'deseq2', endedAt: 1, output: { sections: [
  { type: 'table', label: 'Genes', headers: ['Gene', 'log2 fold change', 'adjusted p', 'Mean expression', 'Direction'], rows: Array.from({ length: 60 }, (_, index) => {
    const change = Number((Math.sin(index * 1.7) * 3.2).toFixed(2));
    return [`GENE${index + 1}`, change, Number((Math.abs(Math.cos(index * 0.9)) * 0.08 + 0.0001).toFixed(4)), Math.round(200 + 1800 * Math.abs(Math.sin(index))), change > 1 ? 'up' : change < -1 ? 'down' : 'unchanged'];
  }) },
  { type: 'number', label: 'Samples', value: 12 },
  { type: 'text', label: 'Design', content: 'Six treated and six control samples, paired-end RNA-seq.' },
] } }];
const CASES = [
  { name: 'docking-topic', instruction: 'spiegami come funziona il docking molecolare, in modo semplice, con un disegnino', sources: [] },
  { name: 'docking-results', instruction: 'Mostra questi risultati in modo chiaro e confronta i ligandi', sources: docking },
  { name: 'scrna-topic', instruction: 'Introduce single-cell RNA sequencing to a new lab member, with an interactive element', sources: [] },
  { name: 'genes-results', instruction: 'make a nice presentation of these results, I want to explore which genes change the most', sources: genes },
].filter((item) => !only.length || only.includes(item.name));
if (!CASES.length) throw new Error(`No case named ${only.join(', ')}.`);

/** One request as the native bridge sends it (src-tauri/src/bridge/quenta.rs), streamed. */
async function chat(messages, format) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, think: false, format, options: { temperature: 0.2, num_ctx: 16384, num_predict: app.OUTPUT_TOKENS } }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}: ${(await response.text()).slice(0, 400)}`);
  let content = '';
  let summary = {};
  let pending = '';
  for await (const chunk of response.body) {
    pending += Buffer.from(chunk).toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines.filter((item) => item.trim())) {
      const part = JSON.parse(line);
      if (part.error) throw new Error(part.error);
      content += part.message?.content ?? '';
      if (part.done) summary = part;
    }
  }
  return { content, seconds: Math.round((Date.now() - started) / 1000), outputTokens: summary.eval_count, promptTokens: summary.prompt_eval_count };
}

mkdirSync(outDir, { recursive: true });
console.log(`Model ${model} at ${baseUrl}; pages in ${outDir}`);
let failed = 0;
for (const item of CASES) {
  const tables = app.sourceTables(item.sources);
  const format = app.presentationFormat(tables);
  const messages = [
    { role: 'system', content: app.systemPrompt(tables) },
    { role: 'user', content: app.requestMessage(item.instruction, app.describeSources(item.sources, tables), undefined) },
  ];
  // As in the app: one answer, and one repair when the page is rejected.
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await chat(messages, format);
    writeFileSync(join(outDir, `${item.name}-${attempt}.answer.json`), reply.content);
    const { page, problems } = app.checkPage(reply.content, tables);
    const elements = page?.sections.flatMap((section) => section.blocks.map((block) => block.type)) ?? [];
    console.log(JSON.stringify({ case: item.name, attempt, seconds: reply.seconds, promptTokens: reply.promptTokens, outputTokens: reply.outputTokens, sections: page?.sections.length, elements, problems }));
    if (page) {
      writeFileSync(join(outDir, `${item.name}.json`), JSON.stringify({ sources: item.sources, page }, null, 1));
      break;
    }
    if (attempt === 1) failed++;
    else messages.push(...app.repairMessages(problems, reply.content));
  }
}
console.log(failed ? `${failed} of ${CASES.length} requests gave no usable page.` : `All ${CASES.length} requests gave a usable page.`);
process.exitCode = failed ? 1 : 0;
