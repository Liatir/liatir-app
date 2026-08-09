export async function waitForLiatirBridge(browser) {
  await browser.waitUntil(
    async () => {
      const state = await browser.execute(() => ({
        bridgeAvailable: Boolean(window.Liatir?.isAvailable),
        documentReady: document.readyState === 'complete',
        href: window.location.href,
      }));
      return state.bridgeAvailable && state.documentReady && state.href !== 'about:blank';
    },
    {
      // The bridge is injected into the transient about:blank document too. Wait for the real
      // app navigation so a following asynchronous command cannot be discarded with that page.
      timeout: 65_000,
      interval: 250,
      timeoutMsg: 'window.Liatir bridge was not available',
    },
  );
}

export async function openSandboxWorkspace(browser) {
  await waitForLiatirBridge(browser);

  const sandboxSelector = '[data-testid="workspace-sandbox-button"]';
  const sandboxButton = await browser.$(sandboxSelector);
  if (await sandboxButton.isExisting()) {
    await sandboxButton.waitForDisplayed({ timeout: 20_000 });
    // The bridge is injected before Svelte finishes attaching its delegated
    // event handlers. Give hydration one render turn before the real click.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sandboxButton.click();
  }

  await browser.waitUntil(
    async () => browser.execute(() => (
      window.location.pathname !== '/workspaces'
      && Boolean(document.querySelector('[data-testid="sidebar-nav-item"]'))
    )),
    {
      timeout: 20_000,
      timeoutMsg: 'Sandbox workspace shell did not open',
    },
  );
}

export async function navigateSidebar(browser, route) {
  const selector = `[data-testid="sidebar-nav-item"][data-route="${route}"]`;
  const nav = await browser.$(selector);
  await nav.waitForDisplayed({ timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await nav.click();
  await browser.waitUntil(
    async () => browser.execute((expectedRoute) => window.location.pathname.startsWith(expectedRoute), route),
    {
      timeout: 20_000,
      timeoutMsg: `Navigation to ${route} did not complete`,
    },
  );
}

/**
 * Routes to a path the way the app itself does.
 *
 * Client-side, never by assigning `window.location.href`. A hard location change unloads the
 * document, and on a slower Windows runner the embedded WebDriver connection drops for long enough
 * that even bounded retries fail with `fetch failed` while the app is perfectly alive. Liatir is a
 * SvelteKit SPA and intercepts in-app anchor clicks, so the session is never torn down.
 */
export async function navigateInApp(browser, pathname) {
  await browser.execute((destination) => {
    const link = document.createElement('a');
    link.href = destination;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }, pathname);
  // The sidebar is on every page, so wait on the committed route instead, ignoring any query string.
  const expectedPath = pathname.split('?')[0];
  await browser.waitUntil(
    async () => browser.execute((expected) => window.location.pathname === expected, expectedPath),
    { timeout: 20_000, timeoutMsg: `Liatir did not finish navigating to ${pathname}` },
  );
}

/** Finds one section of a persisted Result output document. */
export function outputSection(output, type, label = null) {
  return output.sections.find((item) => item.type === type && (label === null || item.label === label));
}

export async function expectNoVisibleRuntimeError(browser) {
  const body = await browser.$('body');
  const text = await body.getText();
  if (text.includes("Proxy handler's 'get' result")) {
    throw new Error("Visible runtime error found: Proxy handler's 'get' result");
  }
  if (text.includes('Unhandled Promise Rejection')) {
    throw new Error('Visible runtime error found: Unhandled Promise Rejection');
  }
}
