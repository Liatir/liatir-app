/** Second process of the Gate 7 macOS install, migration and recovery proof. */
import { navigateInApp, waitForLiatirBridge } from '../support/liatir-app.mjs';

// Continues the first process against the same seeded home; the orchestrator owns that state.
const REQUIRED_ENV = ['LIATIR_DESKTOP_BETA_LIFECYCLE'];

export const tests = [{
  name: 'recovers migrated workspace state and Results in a second app process',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await waitForLiatirBridge(browser);
    await navigateInApp(browser, '/settings');
    const body = await browser.$('body');
    await browser.waitUntil(
      async () => (await body.getText()).includes('Gate 7 Migrated Workspace'),
      { timeout: 20_000, timeoutMsg: 'The active workspace did not survive app restart' },
    );

    const evidence = await browser.execute(async () => {
      const api = window.Liatir;
      if (!api) throw new Error('Liatir bridge is unavailable');
      const recovery = JSON.parse(await api.invoke('lia_app_read_text', { rel: 'gate7-recovery.json' }));
      const migratedAgain = await api.invoke('lia_app_migrate');
      return {
        recovery,
        migratedAgain,
        legacyResult: await api.desktop.fs.data.readText('Results/gate7-preserved.txt'),
        createdResult: await api.desktop.fs.data.readText('Results/gate7-created.txt'),
      };
    });

    expect(evidence.recovery).toEqual({ phase: 'installed', workspaceId: 'gate7-migrated' });
    expect(evidence.migratedAgain).toBe(false);
    expect(evidence.legacyResult).toBe('preserve this scientific result\n');
    expect(evidence.createdResult).toBe('created after migration\n');
  },
}];
