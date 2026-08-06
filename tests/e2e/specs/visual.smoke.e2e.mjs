/**
 * Visual smoke test: screenshot each main page and compare it against a stored baseline.
 *
 * It catches the regressions no assertion is watching for — a broken layout, an element that renders off-screen, a
 * page that comes up blank. A functional test would pass through all of those quite happily.
 *
 * `readyText` per page is what makes the comparison honest: the screenshot is taken only once the page has
 * actually rendered its content, so a slow load produces a *failure*, not a diff against a half-drawn page.
 * The Dependencies page has its own functional E2E test instead: its machine-specific versions and availability
 * make a shared pixel baseline inherently non-deterministic.
 */
import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
} from '../support/liatir-app.mjs';

const VISUAL_PAGES = [
  {
    name: 'ai-models',
    route: '/ai',
    readyText: 'AI Models',
  },
  {
    name: 'jobs',
    route: '/jobs',
    readyText: 'Jobs',
  },
  {
    name: 'results',
    route: '/results',
    readyText: 'Results',
  },
  {
    name: 'data',
    route: '/data',
    readyText: 'Data',
  },
];

async function setSidebarCollapsed(browser, collapsed) {
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(document.querySelector('[data-testid="sidebar-collapse-toggle"]'))),
    { timeout: 20_000, timeoutMsg: 'Sidebar collapse toggle was not available' },
  );

  const current = await browser.execute(() => localStorage.getItem('sidebar-collapsed') === 'true');
  if (current !== collapsed) {
    await browser.execute(() => {
      document.querySelector('[data-testid="sidebar-collapse-toggle"]')?.click();
    });
  }

  await browser.waitUntil(
    async () => browser.execute((expected) => localStorage.getItem('sidebar-collapsed') === String(expected), collapsed),
    { timeout: 5_000, timeoutMsg: `Sidebar did not reach collapsed=${collapsed}` },
  );
}

async function waitForPage(browser, page) {
  await navigateSidebar(browser, page.route);
  await browser.waitUntil(
    async () => browser.execute((text) => document.body.innerText.includes(text), page.readyText),
    { timeout: 30_000, timeoutMsg: `${page.readyText} page did not load for visual capture` },
  );
  await browser.waitUntil(
    async () => browser.execute(() => !document.body.innerText.includes('Loading AI Models...')),
    { timeout: 30_000, timeoutMsg: 'AI Models loading state did not settle before visual capture' },
  );
  await expectNoVisibleRuntimeError(browser);
  await browser.waitUntil(
    async () => browser.execute(() => !document.querySelector('[data-testid="toast-item"]')),
    { timeout: 10_000, timeoutMsg: 'Transient toast did not settle before visual capture' },
  );
}

async function compareStableScreenshot(browser, expect, name, compareScreenshot) {
  const result = await compareScreenshot(browser, name);
  expect(result.diffRatio).toBeLessThanOrEqual(Number(process.env.LIATIR_VISUAL_THRESHOLD ?? 0.01));
}

export const tests = [
  {
    name: 'captures core workspace pages with expanded sidebar',
    async run({ browser, compareScreenshot, expect }) {
      await openSandboxWorkspace(browser);
      await setSidebarCollapsed(browser, false);

      for (const page of VISUAL_PAGES) {
        await waitForPage(browser, page);
        await compareStableScreenshot(browser, expect, `${page.name}-sidebar-expanded`, compareScreenshot);
      }
    },
  },
  {
    name: 'captures core workspace pages with collapsed sidebar',
    async run({ browser, compareScreenshot, expect }) {
      await openSandboxWorkspace(browser);
      await setSidebarCollapsed(browser, true);

      for (const page of VISUAL_PAGES) {
        await waitForPage(browser, page);
        await compareStableScreenshot(browser, expect, `${page.name}-sidebar-collapsed`, compareScreenshot);
      }
    },
  },
];
