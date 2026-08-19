/** Native Gate 7 proof that corrupt startup state is retained and retryable. */
import { openSandboxWorkspace, reloadLiatirApp } from '../support/liatir-app.mjs';

export const tests = [{
  name: 'keeps an unreadable workspace index intact and recovers after a real retry',
  async run({ browser, expect }) {
    await openSandboxWorkspace(browser);

    const original = await browser.execute(async () => window.Liatir.invoke('lia_app_read_text', {
      rel: 'workspaces.json',
    }));
    await browser.execute(async () => window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces.json',
      content: '{not valid json',
      createDirs: true,
    }));

    await reloadLiatirApp(browser);

    const recovery = await browser.$('[data-testid="startup-recovery"]');
    await recovery.waitForDisplayed({ timeout: 20_000 });
    expect(await recovery.getText()).toContain('Your data was not deleted');
    expect(await browser.execute(async () => window.Liatir.invoke('lia_app_read_text', {
      rel: 'workspaces.json',
    }))).toBe('{not valid json');

    await browser.execute(async (contents) => window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces.json',
      content: contents,
      createDirs: true,
    }), original);
    await (await browser.$('[data-testid="startup-retry"]')).click();
    // Re-query each poll instead of reusing the handle above: a resolved element caches its id, and
    // asking a removed node whether it is displayed raises a stale reference rather than reporting
    // that it is gone — which is exactly what recovery is supposed to do to it.
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="startup-recovery"]')).isExisting()),
      { timeout: 20_000, timeoutMsg: 'Liatir did not recover after the workspace index was restored' },
    );
  },
}];
