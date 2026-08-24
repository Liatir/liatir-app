import { activateCleanSandbox } from '../support/runtime-box.mjs';
import { navigateInApp } from '../support/liatir-app.mjs';

const REQUIRED_ENV = [
  'LIATIR_SINGLE_CELL_INDEX_CATALOG_URL',
  'LIATIR_SINGLE_CELL_INDEX_FIXTURE_BASE_URL',
  'LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE',
];

async function archiveRequests() {
  const response = await fetch(`${process.env.LIATIR_SINGLE_CELL_INDEX_FIXTURE_BASE_URL}/requests`);
  if (!response.ok) throw new Error(`Cannot read fixture request count: ${response.status}`);
  return (await response.json()).archiveRequests;
}

export const tests = [{
  name: 'downloads once, reuses the verified index, and removes it cleanly',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await activateCleanSandbox(browser);
    await navigateInApp(browser, '/tools/single-cell/index');

    const manager = await browser.$('[data-testid="single-cell-index-manager"]');
    await manager.waitForDisplayed({ timeout: 20_000 });
    const install = await browser.$('[data-testid="single-cell-index-install"]');
    await install.waitForDisplayed({ timeout: 20_000 });
    await install.click();
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[data-testid="single-cell-index-installed"]'))),
      { timeout: 30_000, interval: 250, timeoutMsg: 'Reference index did not finish installing' },
    );

    const first = await browser.execute(() => window.Liatir.singleCellIndexes.installed());
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: 'human-grch38-gencode-v47-si-r91',
      version: '1.0.0',
    });
    const manifest = await browser.execute(
      (path) => window.Liatir.invoke('lia_read_file_text', { path }),
      first[0].manifestPath,
    );
    expect(JSON.parse(manifest)).toMatchObject({
      kind: 'liatir.single-cell-index',
      referenceType: 'spliced+intronic',
      readLength: 91,
    });
    expect(await archiveRequests()).toBe(1);

    const reused = await browser.execute(() => window.Liatir.singleCellIndexes.install(
      'human-grch38-gencode-v47-si-r91',
      '1.0.0',
      `single-cell-reuse-${Date.now()}`,
    ));
    expect(reused.reused).toBe(true);
    expect(await archiveRequests()).toBe(1);

    const remove = await browser.$('[data-testid="single-cell-index-remove"]');
    await remove.click();
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[role="dialog"]'))),
      { timeout: 5_000, timeoutMsg: 'Removal confirmation did not open' },
    );
    await browser.execute(() => {
      const buttons = document.querySelectorAll('[role="dialog"] button');
      buttons.item(buttons.length - 1).click();
    });
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('[data-testid="single-cell-index-installed"]')),
      { timeout: 10_000, timeoutMsg: 'Reference index remained installed after removal' },
    );
    expect(await browser.execute(() => window.Liatir.singleCellIndexes.installed())).toEqual([]);
    const missing = await browser.execute(async (path) => {
      try {
        await window.Liatir.invoke('lia_file_size', { path });
        return false;
      } catch { return true; }
    }, first[0].manifestPath);
    expect(missing).toBe(true);
  },
}];
