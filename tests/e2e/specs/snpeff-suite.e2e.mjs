import { activateCleanSandbox } from '../support/runtime-box.mjs';
import { navigateInApp } from '../support/liatir-app.mjs';

const REQUIRED_ENV = ['LIATIR_SNPEFF_SUITE_CATALOG_PATH', 'LIATIR_SNPEFF_SUITE_FIXTURE_BASE_URL'];
const VERSION = '5.4c-e2e';
const DATABASE_ID = 'tiny.1';

async function requestCounts() {
  const response = await fetch(`${process.env.LIATIR_SNPEFF_SUITE_FIXTURE_BASE_URL}/requests`);
  if (!response.ok) throw new Error(`Cannot read SnpEff fixture request counts: ${response.status}`);
  return response.json();
}

export const tests = [{
  name: 'installs, verifies, reuses and removes the SnpEff plus SnpSift suite and database',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await activateCleanSandbox(browser);
    await navigateInApp(browser, '/tools/variants/snpeff');

    const manager = await browser.$('[data-testid="snpeff-suite-manager"]');
    await manager.waitForDisplayed({ timeout: 20_000 });
    const installSuite = await browser.$('[data-testid="snpeff-suite-install"]');
    await installSuite.waitForDisplayed({ timeout: 20_000 });
    await installSuite.click();
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[data-testid="snpeff-suite-installed"]'))),
      { timeout: 30_000, interval: 250, timeoutMsg: 'Managed SnpEff suite did not install' },
    );

    const installDatabase = await browser.$('[data-testid="snpeff-database-install"]');
    await installDatabase.waitForDisplayed({ timeout: 10_000 });
    await installDatabase.click();
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(document.querySelector('[data-testid="snpeff-database-installed"]'))),
      { timeout: 30_000, interval: 250, timeoutMsg: 'Managed SnpEff database did not install' },
    );

    const first = await browser.execute(() => window.Liatir.snpEffSuite.status());
    expect(first.active).toMatchObject({ version: VERSION, kind: 'liatir.snpeff-suite.installation' });
    expect(first.active.components.snpEff.path).toContain('snpEff.jar');
    expect(first.active.components.snpSift.path).toContain('SnpSift.jar');
    expect(first.databases).toHaveLength(1);
    expect(first.databases[0]).toMatchObject({ id: DATABASE_ID, suiteVersion: VERSION });
    expect(await requestCounts()).toEqual({ suite: 1, database: 1 });

    const reused = await browser.execute(async ({ version, databaseId }) => {
      const suiteJob = await window.Liatir.invoke('lia_jobs_begin_logical', {
        name: 'snpeff-suite-reuse', workspaceId: '__test__', label: 'Reuse suite', kind: 'dependency', metadata: {},
      });
      const suite = await window.Liatir.snpEffSuite.install(
        version, `snpeff-suite-reuse-${Date.now()}`, suiteJob.jobId,
      );
      const databaseJob = await window.Liatir.invoke('lia_jobs_begin_logical', {
        name: 'snpeff-database-reuse', workspaceId: '__test__', label: 'Reuse database', kind: 'dependency', metadata: {},
      });
      const database = await window.Liatir.snpEffSuite.installDatabase(
        databaseId, version, `snpeff-database-reuse-${Date.now()}`, databaseJob.jobId,
      );
      return { suite, database };
    }, { version: VERSION, databaseId: DATABASE_ID });
    expect(reused.suite.reused).toBe(true);
    expect(reused.database.reused).toBe(true);
    expect(await requestCounts()).toEqual({ suite: 1, database: 1 });

    const removed = await browser.execute(async () => {
      const before = await window.Liatir.snpEffSuite.status();
      const databasePath = before.databases[0].installDir;
      const suitePath = before.active.installDir;
      await window.Liatir.snpEffSuite.removeDatabase(before.databases[0]);
      await window.Liatir.snpEffSuite.remove();
      const after = await window.Liatir.snpEffSuite.status();
      const missing = async (path) => {
        try { await window.Liatir.invoke('lia_file_size', { path }); return false; } catch { return true; }
      };
      return {
        after,
        databaseMissing: await missing(`${databasePath}/snpEffectPredictor.bin`),
        suiteMissing: await missing(`${suitePath}/snpEff.jar`),
      };
    });
    expect(removed.after.active).toBeNull();
    expect(removed.after.databases).toEqual([]);
    expect(removed.databaseMissing).toBe(true);
    expect(removed.suiteMissing).toBe(true);
  },
}];
