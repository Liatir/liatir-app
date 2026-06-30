import {
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

export const tests = [
  {
    name: 'captures the AI Models page in the native Tauri webview',
    async run({ browser, compareScreenshot, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/ai');

      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('AI Models')),
        { timeout: 20_000, timeoutMsg: 'AI Models page did not load for visual capture' },
      );

      const result = await compareScreenshot(browser, 'ai-models-page');
      expect(result.diffRatio).toBeLessThanOrEqual(Number(process.env.LIATIR_VISUAL_THRESHOLD ?? 0.01));
    },
  },
];
