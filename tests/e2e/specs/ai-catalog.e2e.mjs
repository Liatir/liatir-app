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
  {
    name: 'shows the published oncology model, tool, and pipeline preset',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/ai');

      await searchAIModels(browser, 'openvax-mhcflurry-class1-presentation');
      const modelSelector = '[data-testid="ai-model-card"][data-model-id="openvax-mhcflurry-class1-presentation"]';
      await (await browser.$(modelSelector)).waitForDisplayed({
        timeout: 10_000,
        timeoutMsg: 'Published MHCflurry model card was not visible',
      });

      await navigateInApp(browser, '/tools');
      const tool = await browser.$('[data-testid="tool-card-neoantigen-prioritization"]');
      await tool.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'Published Neoantigen tool card was not visible' });
      const toolText = await tool.getText();
      expect(toolText).toContain('Neoantigen Prioritization');
      expect(toolText).toContain('Ready');
      expect(toolText).not.toContain('Coming soon');

      await navigateInApp(browser, '/pipelines');
      const preset = await browser.$('[data-testid="pipeline-preset-card"][data-preset-id="tumor-variants-neoantigen-candidates-v1"]');
      await preset.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'Published neoantigen preset was not visible' });
      expect(await preset.getText()).toContain('Tumor variants to neoantigen candidates');
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
