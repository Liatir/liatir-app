import { buildSync } from 'esbuild';
import path from 'node:path';
import { createServer } from 'node:http';
import { openSandboxWorkspace, reloadLiatirApp, navigateInApp, expectNoVisibleRuntimeError } from '../support/liatir-app.mjs';

const SCRIPT_ID = 'd37955a4-8db3-4dce-b027-a977a2d898cb';
async function seed(browser) {
  await openSandboxWorkspace(browser);
  await browser.execute(async id => {
    const script = { id, name: 'Python double', language: 'python', folder: '', savedAt: 1,
      code: 'from pathlib import Path\ndef main(ctx):\n    if ctx.input.get("inputFile"):\n        assert Path(ctx.input["inputFile"]).read_text().strip() == str(ctx.input["n"])\n    value = ctx.input["n"] * 2\n    Path("counts.csv").write_text(str(value))\n    return {"count": value, "file": "counts.csv"}\n',
      inputSchema: { n: { type: 'number', required: true, default: 3 }, inputFile: { type: 'file', required: false } }, outputSchema: { count: { type: 'number', required: true }, file: { type: 'file', required: true, ext: ['csv'] } }, python: {} };
    const pipeline = { id: 'v1-script-pipeline', name: 'Python chaining', updatedAt: Date.now(), nodes: [
      { id: 'first', type: 'tool', position: { x: 50, y: 100 }, data: { stepId: 'script:' + id, label: 'First', inputs: { n: '3' } } },
      { id: 'second', type: 'tool', position: { x: 450, y: 100 }, data: { stepId: 'script:' + id, label: 'Second', inputs: { n: '@pipe:first:count', inputFile: '@pipe:first:file' } } },
    ], edges: [{ id: 'typed', source: 'first', target: 'second', sourceHandle: 'output', targetHandle: 'input' }] };
    for (const [rel, value] of [
      ['python-scripts/catalog.json', [script]], ['pipeline-workspace.json', { current: pipeline, saved: [pipeline], runtime: [] }],
    ]) await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/' + rel, content: JSON.stringify(value), createDirs: true });
  }, SCRIPT_ID);
  await reloadLiatirApp(browser); await openSandboxWorkspace(browser);
}

export const tests = [
  { name: 'runs an unpackaged Python Script directly and chains its validated numeric output in a pipeline', async run({ browser, expect }) {
    await seed(browser);
    await navigateInApp(browser, `/code?script=${SCRIPT_ID}`);
    const run = await browser.$('[data-testid="script-run"]'); await run.waitForDisplayed({ timeout: 20000 }); await run.click();
    const read = () => browser.execute(async () => {
      try { return JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })); }
      catch { return []; }
    });
    await browser.waitUntil(async () => (await read()).some(item => item.tool === 'script:' + SCRIPT_ID), { timeout: 180000, interval: 200 });
    const direct = (await read()).find(item => item.tool === 'script:' + SCRIPT_ID);
    expect(direct.status).toBe('done'); expect(direct.params.scriptSnapshot.code).toContain('ctx.input');
    expect(direct.outputFiles[0].producer.kind).toBe('python-script');
    await navigateInApp(browser, '/pipelines');
    const open = await browser.$('[data-testid="pipeline-card"][data-pipeline-id="v1-script-pipeline"] [data-testid="pipeline-card-open"]');
    await open.waitForDisplayed({ timeout: 20000 }); await open.click();
    const runPipeline = await browser.$('[data-testid="pipeline-run-button"]'); await runPipeline.waitForDisplayed({ timeout: 20000 }); await runPipeline.click();
    await browser.waitUntil(async () => (await read()).some(item => item.tool === 'pipeline' && item.params.pipelineId === 'v1-script-pipeline'), { timeout: 180000, interval: 200 });
    const pipeline = (await read()).find(item => item.tool === 'pipeline' && item.params.pipelineId === 'v1-script-pipeline');
    expect(pipeline.status).toBe('done');
    const output = await browser.execute(async id => JSON.parse(await window.Liatir.invoke('lia_fs_read_text', { rel: `workspaces/__test__/runs/${id}/result.json`, permanent: true })), pipeline.id);
    expect(JSON.stringify(output)).toContain('12');
    await expectNoVisibleRuntimeError(browser, expect);
  } },
  { name: 'generates a presentation from a selected Result, repairs once and saves standalone HTML with its evidence', async run({ browser, expect }) {
    let calls = 0;
    const requests = [];
    const server = createServer(async (request, response) => {
      if (request.url === '/api/chat') {
        let body = ''; for await (const chunk of request) body += chunk;
        requests.push(JSON.parse(body)); calls++;
        const freeTopic = JSON.stringify(requests.at(-1).messages).includes('not about any Result');
        const javascript = freeTopic
          ? "const {h,render}=Preact;render(h('h1',null,'Docking, explained (illustrative)'),document.getElementById('root'));"
          : calls === 1 ? 'throw new Error("repair this fixture");' : "const {h,render}=Preact;render(h('h1',null,'Measured value: '+LIATIR_RESULTS[0].output.sections[0].value),document.getElementById('root'));";
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.end(JSON.stringify({ model: 'fixture-local', message: { role: 'assistant', content: JSON.stringify({ title: 'Generated offline report', javascript, css: '' }) }, done: true }) + '\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url === '/api/tags' ? { models: [{ name: 'fixture-local' }] } : { version: 'fixture' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      await openSandboxWorkspace(browser);
      await browser.execute(async port => {
        await window.Liatir.invoke('lia_app_write_text', { rel: 'quenta/settings.json', content: JSON.stringify({ config: { provider: 'ollama', baseUrl: `http://127.0.0.1:${port}`, model: 'fixture-local', temperature: 0.1 } }), createDirs: true });
        const id = 'v1-presentation-source';
        await window.Liatir.invoke('lia_fs_write_text', { rel: `workspaces/__test__/runs/${id}/result.json`, permanent: true, createDirs: true,
          contents: JSON.stringify({ sections: [{ type: 'number', label: 'Measured value', value: 7, unit: 'units' }] }) });
        let runs = [];
        try { runs = JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })); } catch {}
        runs = runs.filter(run => run.id !== id);
        runs.unshift({ id, tool: 'fixture', label: 'Measured source', inputs: [], params: {}, status: 'done', startedAt: 1, endedAt: 2, durationMs: 1, error: null });
        await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/analysis-runs/index.json', content: JSON.stringify(runs), createDirs: true });
      }, port);
      await reloadLiatirApp(browser); await openSandboxWorkspace(browser);
      // Presentations are a Quenta mode: reachable from the switch at the top of Quenta.
      await navigateInApp(browser, '/quenta');
      const presentationsMode = await browser.$('[data-testid="quenta-mode-presentations"]');
      await presentationsMode.waitForDisplayed({ timeout: 20000 }); await presentationsMode.click();
      await browser.waitUntil(() => browser.execute(() => window.location.pathname === '/quenta/presentations'), { timeout: 20000, timeoutMsg: 'The Presentations mode did not open' });
      expect(await browser.execute(() => document.querySelector('[data-testid="quenta-mode-presentations"]')?.getAttribute('aria-current'))).toBe('page');
      await navigateInApp(browser, '/quenta/presentations?result=v1-presentation-source');
      const selection = await browser.$('input[value="v1-presentation-source"]'); await selection.waitForDisplayed({ timeout: 20000 });
      await browser.waitUntil(() => browser.execute(() => document.querySelector('input[value="v1-presentation-source"]')?.checked), { timeout: 10000 });
      await browser.execute(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Create presentation').click());
      const history = () => browser.execute(async () => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })));
      await browser.waitUntil(async () => (await history()).some(run => run.tool === 'quenta-presentation' && run.label === 'Generated offline report'), { timeout: 60000, interval: 200 });
      const run = (await history()).find(run => run.tool === 'quenta-presentation' && run.label === 'Generated offline report');
      expect(run.status).toBe('done'); expect(calls).toBe(2);
      // A model outside the profiles keeps Quenta's long-standing context.
      expect(requests[0].options.num_ctx).toBe(16384);
      expect(requests[0].messages[1].content).toContain('v1-presentation-source');
      const html = await browser.execute(async file => window.Liatir.invoke('lia_read_file_text', { path: file }), run.outputFiles.find(file => file.ext === 'html').path);
      expect(html).toContain('sandbox="allow-scripts"'); expect(html).toContain("frame-src blob:");
      expect(run.params.sourceResultIds).toEqual(['v1-presentation-source']);

      // A free page about a topic: no Result selected, only a description.
      await navigateInApp(browser, '/quenta/presentations');
      await browser.waitUntil(() => browser.execute(() => document.querySelector('input[value="v1-presentation-source"]')?.checked === false), { timeout: 10000 });
      await browser.execute(() => {
        const field = document.querySelector('textarea');
        field.value = 'Explain how molecular docking works, simply';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await browser.execute(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Create presentation').click());
      await browser.waitUntil(async () => (await history()).filter(item => item.tool === 'quenta-presentation' && item.status === 'done').length === 2, { timeout: 60000, interval: 200 });
      const free = (await history()).find(item => item.tool === 'quenta-presentation' && item.id !== run.id);
      expect(free.params.sourceResultIds).toEqual([]);
      expect(requests.at(-1).messages[1].content).toContain('This page is not about any Result');
      expect(requests.at(-1).messages[0].content).toContain('illustrative example');
      await expectNoVisibleRuntimeError(browser, expect);
    } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  } },
  { name: 'renders a saved Preact presentation and blocks network and native access from its opaque frame', async run({ browser, expect, rootDir }) {
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('unexpected network'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      await openSandboxWorkspace(browser);
      const runtime = buildSync({ stdin: { contents: 'import * as Preact from "preact"; window.Preact = Preact;', resolveDir: path.join(rootDir, 'frontend') }, bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
      await browser.execute(async (runtimeSource, port) => {
        const id = 'v1-saved-presentation';
        const javascript = `const {h,render}=Preact; render(h('p',null,'Frozen result: '+LIATIR_RESULTS[0].output.value),document.getElementById('root'));
          let settled=0; const report=()=>{if(++settled===2)parent.postMessage({type:'v1-isolation-proof',native:typeof window.Liatir,frozen:Object.isFrozen(LIATIR_RESULTS[0].output),rendered:document.body.textContent.includes('Frozen result: 7')},'*')};
          fetch('http://127.0.0.1:${port}/fetch').then(()=>parent.postMessage({type:'v1-network-leak'},'*'),report);
          const img=new Image();img.onerror=report;img.src='http://127.0.0.1:${port}/image';document.body.append(img);`;
        const presentation = { schemaVersion: 1, id, workspaceId: '__test__', title: 'Offline Preact presentation', model: 'fixture', createdAt: 1, javascript, css: '', runtimeSource,
          sources: [{ resultId: 'source', label: 'Measured fixture', tool: 'fixture', endedAt: 1, output: { value: 7 } }] };
        const root = `workspaces/__test__/runs/${id}`;
        await window.Liatir.invoke('lia_fs_write_text', { rel: `${root}/result.json`, contents: JSON.stringify({ sections: [{ type: 'html-presentation', label: presentation.title, presentation }] }), permanent: true, createDirs: true });
        let history = [];
        try { history = JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })); } catch {}
        history = history.filter(run => run.id !== id);
        history.unshift({ id, tool: 'quenta-presentation', label: presentation.title, inputs: [], params: {}, status: 'done', startedAt: 1, endedAt: 2, durationMs: 1, error: null });
        await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/analysis-runs/index.json', content: JSON.stringify(history), createDirs: true });
      }, runtime, address.port);
      await reloadLiatirApp(browser); await openSandboxWorkspace(browser);
      await browser.execute(() => { window.__v1Isolation = null; window.addEventListener('message', event => { if (event.data?.type === 'v1-isolation-proof') window.__v1Isolation = event.data; }); });
      await navigateInApp(browser, '/results?run=v1-saved-presentation');
      await browser.waitUntil(() => browser.execute(() => window.__v1Isolation !== null), { timeout: 30000, interval: 100 });
      expect(await browser.execute(() => window.__v1Isolation)).toMatchObject({ native: 'undefined', frozen: true, rendered: true });
      expect(requests).toBe(0);
      await expectNoVisibleRuntimeError(browser, expect);
    } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  } },
];
