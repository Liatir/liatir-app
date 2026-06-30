import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

export const tests = [
  {
    name: 'loads dependency checks through the real Tauri bridge',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/deps');

      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Dependencies')),
        { timeout: 20_000, timeoutMsg: 'Dependencies page did not load' },
      );
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.toLowerCase().includes('python')),
        { timeout: 60_000, timeoutMsg: 'Python dependency result did not appear' },
      );

      const state = await browser.execute(() => ({
        text: document.body.innerText,
        hasLiatir: Boolean(window.Liatir?.isAvailable),
      }));

      expect(state.hasLiatir).toBe(true);
      expect(state.text).toContain('python');
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
