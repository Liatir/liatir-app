/**
 * The AI catalogue screen: models are listed, grouped, searchable, and — importantly — that a preview or an
 * incompatible model is presented as such and cannot be installed.
 */
import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

async function searchAIModels(browser, query) {
  const search = await browser.$('[data-testid="ai-models-search"]');
  await search.waitForDisplayed({ timeout: 20_000 });
  await search.setValue(query);
}

export const tests = [
  {
    name: 'keeps deferred AI Models out of the visible catalog',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/ai');

      await searchAIModels(browser, 'Chai');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('No AI Models match your search.')),
        { timeout: 10_000, timeoutMsg: 'Deferred Chai model still appears in the AI Models catalog' },
      );

      const visibleChai = await browser.execute(() => document.body.innerText.includes('Chai-1 Local Structure'));
      expect(visibleChai).toBe(false);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'exposes stable AI Model card selectors for automation',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/ai');

      await searchAIModels(browser, 'boltz2-local-structure-binding');
      await browser.waitUntil(
        async () => browser.execute(() => Boolean(document.querySelector('[data-testid="ai-model-card"][data-model-id="boltz2-local-structure-binding"]'))),
        { timeout: 10_000, timeoutMsg: 'Boltz-2 AI Model card was not found by stable selector' },
      );

      const state = await browser.execute(() => {
        const card = document.querySelector('[data-testid="ai-model-card"][data-model-id="boltz2-local-structure-binding"]');
        return {
          hasAction: Boolean(card?.querySelector('[data-testid="ai-model-install-button"], [data-testid="ai-model-run-button"], [data-testid="ai-model-fix-dependency-button"]')),
          text: card?.textContent ?? '',
        };
      });

      expect(state.text).toContain('Boltz-2');
      expect(state.hasAction).toBe(true);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
