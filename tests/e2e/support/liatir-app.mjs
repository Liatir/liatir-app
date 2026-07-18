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
