/** First process of the Gate 7 Linux install, migration and recovery proof. */
import { comparablePath, isolatedTestHome } from '../support/tauri-process.mjs';
import { navigateInApp, waitForLiatirBridge } from '../support/liatir-app.mjs';

// This spec only means anything against the legacy state its orchestrator seeds into an installed
// app copy, so it must not be picked up by the default spec glob.
const REQUIRED_ENV = ['LIATIR_DESKTOP_BETA_LIFECYCLE'];

export const tests = [{
  name: 'migrates legacy state without losing Results in the first native app process',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await waitForLiatirBridge(browser);
    await navigateInApp(browser, '/settings');
    const about = await browser.$('body');
    await browser.waitUntil(
      async () => (await about.getText()).includes('Gate 7 Migrated Workspace'),
      { timeout: 20_000, timeoutMsg: 'The migrated workspace did not become active' },
    );

    const evidence = await browser.execute(async () => {
      const api = window.Liatir;
      if (!api) throw new Error('Liatir bridge is unavailable');
      const appPath = await api.invoke('lia_app_path');
      const migrated = await api.invoke('lia_app_exists', { rel: '.migrated' });
      const workspaces = JSON.parse(await api.invoke('lia_app_read_text', { rel: 'workspaces.json' }));
      const legacyResult = await api.desktop.fs.data.readText('Results/gate7-preserved.txt');
      await api.invoke('lia_app_write_text', {
        rel: 'gate7-recovery.json',
        content: JSON.stringify({ phase: 'installed', workspaceId: 'gate7-migrated' }),
        createDirs: true,
      });
      await api.desktop.fs.data.writeText('Results/gate7-created.txt', 'created after migration\n', {
        createDirs: true,
      });
      return { appPath, migrated, workspaces, legacyResult };
    });

    expect(evidence.migrated).toBe(true);
    expect(evidence.workspaces.workspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gate7-migrated', name: 'Gate 7 Migrated Workspace' }),
    ]));
    expect(evidence.legacyResult).toBe('preserve this scientific result\n');
    // The installed app must own its state under the XDG data directory of the isolated test
    // profile, never the developer's real one.
    expect(comparablePath(evidence.appPath))
      .toContain('/.local/share/app.liatir.app/.liatir/.main/_app');
    expect(comparablePath(evidence.appPath).startsWith(isolatedTestHome())).toBe(true);
  },
}];
