import fs from 'node:fs';
import path from 'node:path';
import { openSandboxWorkspace, navigateInApp, hardNavigateInApp, waitForLiatirBridge, expectNoVisibleRuntimeError } from '../support/liatir-app.mjs';

export const tests = [{
  name: 'runs the single-cell study through the no-code native UI and exports actual Results',
  heavy: true,
  requiredEnv: ['LIATIR_STUDY_RUN'],
  async run({ browser, expect, rootDir, captureScreenshot }) {
    const dataset = process.env.LIATIR_STUDY_DATASET ?? 'pbmc';
    const methods = (process.env.LIATIR_STUDY_METHODS ?? 'pca,geneformer').split(',');
    if (process.env.LIATIR_STUDY_DEV_FRONTEND === '1') {
      // The existing local-dev capability explicitly authorizes this exact origin.
      await waitForLiatirBridge(browser);
      // Confirm the new document before routing; a cold local server can otherwise
      // replace the requested study page with its initial dashboard afterward.
      await hardNavigateInApp(browser, 'http://localhost:5173/');
    }
    await openSandboxWorkspace(browser);
    await navigateInApp(browser, '/tools/single-cell/benchmark');
    await (await browser.$('[data-testid="single-cell-study"]')).waitForDisplayed();
    const stability = await browser.$('[data-testid="study-stability"]');
    if (await stability.isSelected() !== (process.env.LIATIR_STUDY_STABILITY === '1')) await stability.click();
    await browser.execute((value) => {
      const select = document.querySelector('[data-testid="study-dataset"]');
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataset);
    for (const method of ['pca', 'geneformer', 'harmony', 'scvi', 'scgpt', 'uce']) {
      const checkbox = await browser.$(`[data-testid="study-method-${method}"]`);
      if (await checkbox.isSelected() !== methods.includes(method)) await checkbox.click();
    }
    const existing = await browser.execute(() => Array.from(document.querySelectorAll('[data-testid="study-run"]'), (el) => el.dataset.runId));
    await (await browser.$('[data-testid="study-launch"]')).click();
    await browser.waitUntil(async () => browser.execute((ids) => Array.from(document.querySelectorAll('[data-testid="study-run"]')).some((el) => !ids.includes(el.dataset.runId)), existing));
    const id = await browser.execute((ids) => Array.from(document.querySelectorAll('[data-testid="study-run"]')).find((el) => !ids.includes(el.dataset.runId)).dataset.runId, existing);
    console.log(`\nStudy ${id}: ${dataset} / ${methods.join(', ')}`);
    await navigateInApp(browser, '/jobs');
    await navigateInApp(browser, '/tools/single-cell/benchmark');
    // Filesystem events avoid both polling and an HTTP request held open for hours.
    const { data } = await browser.execute(() => window.Liatir.invoke('lia_fs_paths'));
    const workspace = path.join(path.dirname(data), '_app/workspaces/__test__');
    const status = await new Promise((resolve, reject) => {
      const onExit = () => { watcher.close(); reject(new Error('The native app exited before study finalization.')); };
      const check = () => {
        try {
          const rows = JSON.parse(fs.readFileSync(path.join(workspace, 'analysis-runs/index.json'), 'utf8'));
          const result = rows.find((row) => row.id === id);
          if (result && ['done', 'error', 'cancelled'].includes(result.status)) {
            watcher.close();
            browser.app.child.off('exit', onExit);
            resolve(result.status);
          }
        } catch { /* A later filesystem event retries an incomplete index write. */ }
      };
      const watcher = fs.watch(workspace, { recursive: true }, (_event, file) => {
        if (file?.replaceAll('\\', '/').endsWith('analysis-runs/index.json')) check();
      });
      browser.app.child.once('exit', onExit);
      check();
    });
    const evidence = await browser.execute(async (runId) => {
      const { data } = await window.Liatir.invoke('lia_fs_paths');
      const raw = await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/analysis-runs/index.json' });
      return { run: JSON.parse(raw).find((run) => run.id === runId), outputDir: `${data}/workspaces/__test__/runs/${runId}/output` };
    }, id);
    const destination = path.join(rootDir, 'showcases/single-cell-foundation-benchmark/validation');
    fs.mkdirSync(destination, { recursive: true });
    evidence.frontendMode = process.env.LIATIR_STUDY_DEV_FRONTEND === '1' ? 'local development UI in the compiled native app' : 'bundled';
    // Chart coordinates already live in the exported run; retain the native
    // identity and outputs without duplicating megabytes of plotted points.
    const { output, ...runIdentity } = evidence.run;
    fs.writeFileSync(path.join(destination, `${dataset}-${id}.json`), JSON.stringify({ ...evidence, run: runIdentity }, null, 2));
    console.log(`Study ended: ${status}; ${evidence.outputDir}`);
    if (evidence.run?.error) console.error(evidence.run.error);
    await navigateInApp(browser, `/results?run=${id}`);
    await (await browser.$('.js-plotly-plot .main-svg')).waitForDisplayed();
    await captureScreenshot(browser, `single-cell-study-${dataset}`);
    expect(evidence.run?.outputFiles?.some((file) => file.path.endsWith('summary.json'))).toBe(true);
    const summary = JSON.parse(fs.readFileSync(path.join(evidence.outputDir, 'results/summary.json'), 'utf8'));
    expect(summary.map((row) => row.method).sort()).toEqual([...methods].sort());
    for (const row of summary) {
      if (row.status === 'completed') expect(Number.isFinite(row.logistic_macro_f1)).toBe(true);
      else expect(typeof row.error === 'string' && row.error.length > 0).toBe(true);
    }
    await expectNoVisibleRuntimeError(browser);
    expect(status).toBe(summary.some((row) => row.status !== 'completed') ? 'error' : 'done');
  },
}];
