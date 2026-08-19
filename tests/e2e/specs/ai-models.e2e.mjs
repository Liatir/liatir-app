/** The AI Models screen: how the published Runtime Box catalog is searched and restored. */
import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
  setAppInputValue,
} from '../support/liatir-app.mjs';

/**
 * This spec used to assert collapsed model categories and the Boltz structure model. Both were
 * removed on purpose — the legacy AI batches were deleted on 2026-07-22 and the screen now lists
 * the published Runtime Boxes directly — so it was asserting a UI that no longer exists and failed
 * on every host. It now covers what the screen actually does, against stable selectors rather than
 * copy, which is the part worth protecting.
 */
const SEARCH = '[data-testid="ai-models-search"]';

export const tests = [
  {
    name: 'filters the Runtime Box catalog by search and restores it when cleared',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateInApp(browser, '/ai');

      const search = await browser.$(SEARCH);
      await search.waitForDisplayed({ timeout: 20_000 });
      // Establish the starting state instead of assuming it: the whole suite shares one app, and a
      // previous spec can leave this field filtered.
      await setAppInputValue(browser, SEARCH, '');

      await browser.waitUntil(
        async () => browser.execute(
          () => document.querySelectorAll('[data-testid="ai-model-card"]').length > 1,
        ),
        { timeout: 20_000, timeoutMsg: 'The published Runtime Box catalog did not render' },
      );
      // `waitUntil` reports only that the condition held, so read the count separately.
      const total = await browser.execute(
        () => document.querySelectorAll('[data-testid="ai-model-card"]').length,
      );

      await setAppInputValue(browser, SEARCH, 'Geneformer');
      await browser.waitUntil(
        async () => browser.execute(() => {
          const cards = document.querySelectorAll('[data-testid="ai-model-card"]');
          return cards.length === 1 && cards[0].getAttribute('data-model-id') === 'ctheodoris-geneformer-v1-10m';
        }),
        { timeout: 10_000, timeoutMsg: 'Search did not narrow the catalog to Geneformer' },
      );

      // A search that matches nothing must say so rather than render an empty list.
      await setAppInputValue(browser, SEARCH, 'no-such-runtime-box');
      await (await browser.$('[data-testid="ai-models-empty"]')).waitForDisplayed({ timeout: 10_000 });

      await setAppInputValue(browser, SEARCH, '');
      await browser.waitUntil(
        async () => browser.execute(
          (expected) => document.querySelectorAll('[data-testid="ai-model-card"]').length === expected,
          total,
        ),
        { timeout: 10_000, timeoutMsg: 'Clearing the search did not restore the full catalog' },
      );

      await expectNoVisibleRuntimeError(browser);
    },
  },
];
