/** Verifies that the AI catalog exposes only supported Runtime Box models through stable selectors. */
import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

async function searchAIModels(browser, query) {
  const search = await browser.$('[data-testid="ai-models-search"]');
  await search.waitForDisplayed({ timeout: 20_000 });
  await search.setValue(query);
}

export const tests = [
  {
    name: 'keeps removed legacy AI Models out of the visible catalog',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/ai');

      await searchAIModels(browser, 'Mock Local Model');
      // Assert the empty state by its stable selector: the wording is product copy and has already
      // changed once under this test.
      await (await browser.$('[data-testid="ai-models-empty"]')).waitForDisplayed({
        timeout: 10_000,
        timeoutMsg: 'Removed legacy model still appears in the AI Models catalog',
      });

      const visibleLegacyModel = await browser.execute(() => document.body.innerText.includes('Mock Local Model'));
      expect(visibleLegacyModel).toBe(false);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'exposes stable AI Model card selectors for automation',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/ai');

      await searchAIModels(browser, 'ctheodoris-geneformer-v1-10m');
      await browser.waitUntil(
        async () => browser.execute(() => Boolean(document.querySelector('[data-testid="ai-model-card"][data-model-id="ctheodoris-geneformer-v1-10m"]'))),
        { timeout: 10_000, timeoutMsg: 'Geneformer Runtime Box card was not found by stable selector' },
      );

      const state = await browser.execute(() => {
        const card = document.querySelector('[data-testid="ai-model-card"][data-model-id="ctheodoris-geneformer-v1-10m"]');
        return {
          hasAction: Boolean(card?.querySelector('[data-testid="ai-model-install-button"], [data-testid="ai-model-run-button"]')),
          text: card?.textContent ?? '',
        };
      });

      expect(state.text).toContain('Geneformer');
      expect(state.hasAction).toBe(true);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
