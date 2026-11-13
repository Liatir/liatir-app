import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stageRuntimeBuild } from '../../../frontend/stage-kit/build.mjs';
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
        const text = JSON.stringify(requests.at(-1).messages);
        const kind = text.includes('not about any Result') ? 'topic' : text.includes('CURRENT PAGE') ? 'revision' : 'results';
        // The answer is a Stage page, as the real model gives: the app checks it and the bundled runtime draws it.
        const stagePage = (title, blocks) => ({ title, subtitle: 'Fixture', accent: 'teal', closing: { title: 'Summary', text: 'Done.' },
          sections: [{ title: 'Section one', columns: 1, blocks }, { title: 'Section two', columns: 1, blocks: [{ type: 'text', text: 'Summary' }] }] });
        const measured = (y) => [{ type: 'bar-chart', data: { table: 'T1', x: 'Name', y: [y] } }, { type: 'key-number', label: 'Measured value', value: { table: 'T1', column: 'Value', stat: 'max' } }];
        const answer = kind === 'topic' ? stagePage('Docking explained', [{ type: 'flow', items: [{ title: 'Pose' }, { title: 'Score' }] }])
          : kind === 'revision' ? stagePage('Revised offline report', measured('Value'))
          // The first answer charts a text column, which the page check rejects: one repair follows.
          : stagePage('Generated offline report', measured(calls === 1 ? 'Name' : 'Value'));
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.end(JSON.stringify({ model: 'fixture-local', message: { role: 'assistant', content: JSON.stringify(answer) }, done: true }) + '\n');
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
      // Stage is a Quenta mode: reachable from the switch at the top of Quenta.
      await navigateInApp(browser, '/quenta');
      const presentationsMode = await browser.$('[data-testid="quenta-mode-presentations"]');
      await presentationsMode.waitForDisplayed({ timeout: 20000 }); await presentationsMode.click();
      await browser.waitUntil(() => browser.execute(() => window.location.pathname === '/quenta/presentations'), { timeout: 20000, timeoutMsg: 'The Presentations mode did not open' });
      expect(await browser.execute(() => document.querySelector('[data-testid="quenta-mode-presentations"]')?.getAttribute('aria-current'))).toBe('page');
      // "Create presentation" on a Result opens a new chat with that Result attached.
      await navigateInApp(browser, '/quenta/presentations?result=v1-presentation-source');
      const selection = await browser.$('[data-testid="presentation-selected"][data-result-id="v1-presentation-source"]'); await selection.waitForDisplayed({ timeout: 20000 });
      const ask = async (text) => {
        await browser.execute((value) => {
          const field = document.querySelector('[data-testid="presentation-input"]');
          field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
        }, text);
        await browser.execute(() => document.querySelector('[data-testid="presentation-send"]').click());
      };
      const history = () => browser.execute(async () => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })));
      const doneVersions = () => browser.execute(() => document.querySelectorAll('[data-testid="presentation-quenta-turn"][data-status="done"]').length);

      await ask('Show this result simply');
      // The chat shows the stages while Quenta works.
      await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('[data-testid="presentation-stages"]')) || document.querySelectorAll('[data-testid="presentation-quenta-turn"][data-status="done"]').length > 0), { timeout: 20000, timeoutMsg: 'The chat did not show the presentation stages' });
      await browser.waitUntil(async () => (await doneVersions()) === 1, { timeout: 60000, interval: 200, timeoutMsg: 'The first version did not finish in the chat' });
      const run = (await history()).find(item => item.tool === 'quenta-presentation' && item.label === 'Generated offline report');
      expect(run.status).toBe('done'); expect(calls).toBe(2);
      // A model outside the profiles keeps Quenta's long-standing context.
      expect(requests[0].options.num_ctx).toBe(16384);
      // The model is told about the Result's table and held to a schema naming exactly that table.
      expect(requests[0].messages[1].content).toContain('Result "Measured source" (fixture)\nT1 "Key numbers": 1 row.');
      expect(requests[0].messages[0].content).toContain('- bar-chart: ');
      expect(JSON.stringify(requests[0].format)).toContain('"enum":["T1"]');
      expect(requests[1].messages.at(-1).content).toContain('Section 1, element 1 (bar-chart): column "Name" of T1 holds text, not numbers.');
      const html = await browser.execute(async file => window.Liatir.invoke('lia_read_file_text', { path: file }), run.outputFiles.find(file => file.ext === 'html').path);
      expect(html).toContain('sandbox="allow-scripts"'); expect(html).toContain("frame-src blob:");
      expect(html).toContain('Generated offline report'); expect(html).toContain('LiatirStage.showPage');
      expect(run.params.sourceResultIds).toEqual(['v1-presentation-source']);
      // The new version is on the stage beside the chat.
      await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector('[data-testid="presentation-stage"] iframe'))), { timeout: 20000, timeoutMsg: 'The stage did not show the presentation' });

      // A follow-up message revises the current version into a new one.
      await ask('Make the value bigger');
      await browser.waitUntil(async () => (await doneVersions()) === 2, { timeout: 60000, interval: 200, timeoutMsg: 'The revision did not finish' });
      expect(requests.at(-1).messages[1].content).toContain('CURRENT PAGE:\n{"title":"Generated offline report"');
      expect((await history()).some(item => item.label === 'Revised offline report' && item.params.revision === true)).toBe(true);

      // A free page about a topic, in a new conversation with no Result.
      await browser.execute(() => document.querySelector('[data-testid="presentation-new"]').click());
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-testid="presentation-selected"]') && !document.querySelector('[data-testid="presentation-user-turn"]')), { timeout: 10000 });
      // The picker lists the Result and keeps the chat's choice until confirmed.
      await (await browser.$('[data-testid="presentation-results-open"]')).click();
      await (await browser.$('[data-testid="presentation-result-option"][data-result-id="v1-presentation-source"]')).waitForDisplayed({ timeout: 10000 });
      await browser.execute(() => document.querySelector('[data-testid="presentation-result-option"][data-result-id="v1-presentation-source"]').click());
      await browser.execute(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click());
      expect(await browser.execute(() => Boolean(document.querySelector('[data-testid="presentation-selected"]')))).toBe(false);
      await ask('Explain how molecular docking works, simply');
      await browser.waitUntil(async () => (await history()).some(item => item.label === 'Docking explained' && item.status === 'done'), { timeout: 60000, interval: 200, timeoutMsg: 'The free-topic page was not created' });
      const free = (await history()).find(item => item.label === 'Docking explained');
      expect(free.params.sourceResultIds).toEqual([]);
      expect(requests.at(-1).messages[1].content).toContain('This page is not about any Result');
      expect(requests.at(-1).messages[0].content).toContain('"Illustrative" label');
      // With no Result there is no table to read, so the schema offers no way to name one.
      expect(JSON.stringify(requests.at(-1).format)).not.toContain('"stat"');
      await expectNoVisibleRuntimeError(browser, expect);
    } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  } },
  { name: 'draws every element of the Stage kit in the real presentation frame', async run({ browser, expect, rootDir }) {
    await openSandboxWorkspace(browser);
    const gallery = JSON.parse(readFileSync(path.join(rootDir, 'tests/fixtures/stage-gallery.json'), 'utf8'));
    const runtimeSource = buildSync(stageRuntimeBuild(path.join(rootDir, 'frontend'))).outputFiles[0].text;
    await browser.execute(async (runtimeSource, gallery) => {
      const id = 'v1-stage-gallery';
      const presentation = { schemaVersion: 1, id, workspaceId: '__test__', title: gallery.page.title, model: 'fixture', createdAt: 1, runtimeSource, ...gallery };
      await window.Liatir.invoke('lia_fs_write_text', { rel: `workspaces/__test__/runs/${id}/result.json`, contents: JSON.stringify({ sections: [{ type: 'html-presentation', label: presentation.title, presentation }] }), permanent: true, createDirs: true });
      let history = [];
      try { history = JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })); } catch {}
      history = history.filter(run => run.id !== id);
      history.unshift({ id, tool: 'quenta-presentation', label: presentation.title, inputs: [], params: {}, status: 'done', startedAt: 1, endedAt: 2, durationMs: 1, error: null });
      await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/analysis-runs/index.json', content: JSON.stringify(history), createDirs: true });
    }, runtimeSource, gallery);
    await reloadLiatirApp(browser); await openSandboxWorkspace(browser);
    await navigateInApp(browser, '/results?run=v1-stage-gallery');
    // The whole page is drawn at once, so "ready" means all 45 elements drew without an error.
    const state = () => browser.execute(() => document.querySelector('[data-testid="quenta-presentation"]')?.getAttribute('data-state'));
    await browser.waitUntil(async () => ['ready', 'error'].includes(await state()), { timeout: 30000, interval: 100, timeoutMsg: 'The gallery presentation did not open' });
    expect(await browser.execute(() => document.querySelector('[data-testid="quenta-presentation"]').textContent.trim())).toMatch(/^AI-generated Stage page · 2 selected Results · Local and offline$/);
    expect(await state()).toBe('ready');
    await expectNoVisibleRuntimeError(browser, expect);
  } },
  { name: 'renders a saved Preact presentation and blocks network and native access from its opaque frame', async run({ browser, expect, rootDir }) {
    let requests = 0;
    const server = createServer((_request, response) => { requests++; response.end('unexpected network'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      await openSandboxWorkspace(browser);
      // A minimal embedded runtime, as older presentations carry: React exposed under the Preact name they use.
      const runtime = buildSync({ stdin: { contents: 'import * as React from "react"; import { flushSync } from "react-dom"; import { createRoot } from "react-dom/client"; window.Preact = { h: React.createElement, render: (node, element) => flushSync(() => createRoot(element).render(node)) };', resolveDir: path.join(rootDir, 'frontend') }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0].text;
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
  { name: 'chats with nothing attached by default, then attaches a failure and sends without typing', async run({ browser, expect }) {
    const chats = [];
    const server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) body += chunk;
      if (request.url === '/api/chat') {
        chats.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.end(JSON.stringify({ model: 'fixture-local', message: { role: 'assistant', content: 'The run stopped because an input file was missing.' }, done: true }) + '\n');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url === '/api/tags' ? { models: [{ name: 'fixture-local' }] } : { version: 'fixture' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await openSandboxWorkspace(browser);
      await browser.execute(async port => {
        await window.Liatir.invoke('lia_app_write_text', { rel: 'quenta/settings.json', createDirs: true, content: JSON.stringify({ config: { provider: 'ollama', baseUrl: `http://127.0.0.1:${port}`, model: 'fixture-local', temperature: 0.1 } }) });
        await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/quenta/conversations.json', createDirs: true, content: JSON.stringify({ revision: 0, conversations: [] }) });
        let runs = [];
        try { runs = JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' })); } catch {}
        runs = runs.filter(run => run.id !== 'v1-failed-run');
        runs.unshift({ id: 'v1-failed-run', tool: 'fixture', label: 'Failed alignment', inputs: [], params: {}, status: 'error', startedAt: 1, endedAt: 2, durationMs: 1, error: 'input file missing' });
        await window.Liatir.invoke('lia_app_write_text', { rel: 'workspaces/__test__/analysis-runs/index.json', createDirs: true, content: JSON.stringify(runs) });
      }, server.address().port);
      await reloadLiatirApp(browser); await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/quenta');
      const newChat = await browser.$('[data-testid="quenta-empty-new-chat"]'); await newChat.waitForDisplayed({ timeout: 30000 }); await newChat.click();
      await (await browser.$('[data-testid="quenta-attach"]')).waitForDisplayed({ timeout: 10000 });
      // No task dropdown: the chat starts with nothing attached.
      expect(await browser.execute(() => Boolean(document.querySelector('[data-testid="quenta-attachment"]')))).toBe(false);
      await (await browser.$('[data-testid="quenta-attach"]')).click();
      await (await browser.$('[data-testid="presentation-result-option"][data-result-id="v1-failed-run"]')).waitForDisplayed({ timeout: 10000 });
      await browser.execute(() => document.querySelector('[data-testid="presentation-result-option"][data-result-id="v1-failed-run"]').click());
      const chip = await browser.$('[data-testid="quenta-attachment"][data-entity-id="v1-failed-run"]'); await chip.waitForDisplayed({ timeout: 10000 });
      expect(await chip.getText()).toContain('Failure');
      // Attached and sent without typing: Quenta is asked to explain the failure.
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-testid="quenta-send"]')?.disabled), { timeout: 10000, timeoutMsg: 'Send stayed disabled with an attachment' });
      await browser.execute(() => document.querySelector('[data-testid="quenta-send"]').click());
      await browser.waitUntil(() => chats.length > 0, { timeout: 30000, timeoutMsg: 'Quenta did not send the explanation request' });
      expect(chats[0].messages.at(-1).content).toContain('Explain the failure thoroughly');
      expect(chats[0].messages.at(-1).content).toContain('result:v1-failed-run');
      await browser.waitUntil(() => browser.execute(() => document.body.innerText.includes('an input file was missing')), { timeout: 30000, timeoutMsg: 'The answer did not appear' });
      // Removing the attachment returns to a plain chat.
      await browser.execute(() => document.querySelector('[aria-label="Remove attachment"]').click());
      await browser.waitUntil(() => browser.execute(() => !document.querySelector('[data-testid="quenta-attachment"]')), { timeout: 10000 });
      const saved = await browser.execute(async () => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/quenta/conversations.json' })).conversations[0]);
      expect(saved.focus).toBeUndefined();
      await expectNoVisibleRuntimeError(browser, expect);
    } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
  } },
];
