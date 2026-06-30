import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

export const tests = [
  {
    name: 'groups models into collapsed categories by default and expands search matches',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await navigateSidebar(browser, '/ai');

      const search = await browser.$('[data-testid="ai-models-search"]');
      await search.waitForDisplayed({ timeout: 20_000 });

      const categories = await browser.$$('[data-testid="ai-model-category"]');
      expect(categories.length).toBeGreaterThan(1);

      const expandedBeforeSearch = await browser.execute(() =>
        Array.from(document.querySelectorAll('[data-testid="ai-model-category-toggle"]'))
          .map((element) => element.getAttribute('aria-expanded')),
      );
      expect(expandedBeforeSearch.every((value) => value === 'false')).toBe(true);

      await search.setValue('Boltz');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Boltz-2 Local Structure & Binding')),
        { timeout: 10_000, timeoutMsg: 'Boltz model did not appear in filtered AI Models list' },
      );

      const searchState = await browser.execute(() => {
        const visibleCategories = Array.from(document.querySelectorAll('[data-testid="ai-model-category"]'))
          .map((element) => element.getAttribute('data-category'));
        const expanded = Array.from(document.querySelectorAll('[data-testid="ai-model-category-toggle"]'))
          .map((element) => element.getAttribute('aria-expanded'));

        return { visibleCategories, expanded, text: document.body.innerText };
      });

      expect(searchState.visibleCategories).toContain('Protein Structure');
      expect(searchState.expanded.every((value) => value === 'true')).toBe(true);
      expect(searchState.text).toContain('Boltz-2 Local Structure & Binding');
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
