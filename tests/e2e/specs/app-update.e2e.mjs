/** Native Gate 7 proof for the user-controlled updater surface and Job safety boundary. */
import { navigateInApp, openSandboxWorkspace } from '../support/liatir-app.mjs';

export const tests = [{
  name: 'keeps update checks explicit and refuses a restart while scientific work is active',
  async run({ browser, expect }) {
    await openSandboxWorkspace(browser);
    await navigateInApp(browser, '/settings');

    const check = await browser.$('[data-testid="app-update-check"]');
    await check.waitForDisplayed({ timeout: 20_000 });
    await check.click();

    const status = await browser.$('[data-testid="app-update-status"]');
    await browser.waitUntil(
      async () => (await status.getText()).includes('not configured for this build'),
      { timeout: 20_000, timeoutMsg: 'The development build did not explain its missing update feed' },
    );

    const restartError = await browser.execute(async () => {
      const api = window.Liatir;
      if (!api) throw new Error('Liatir bridge is unavailable');
      const { jobId } = await api.jobs.beginLogical('Gate 7 restart blocker', {
        label: 'Gate 7 restart blocker',
        kind: 'gate-7-restart-blocker',
      });
      try {
        await api.desktop.app.updates.restart();
        return 'restart unexpectedly succeeded';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        await api.jobs.finishLogical(jobId, true);
      }
    });

    expect(restartError).toContain('Wait for 1 running Job to finish or cancel it');
  },
}];
