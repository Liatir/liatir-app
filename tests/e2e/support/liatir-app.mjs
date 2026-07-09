export async function waitForLiatirBridge(browser) {
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(window.Liatir?.isAvailable)),
    {
      timeout: 30_000,
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
    await sandboxButton.click();
  }

  await browser.waitUntil(
    async () => browser.execute(() => Boolean(document.querySelector('[data-testid="sidebar-nav-item"]'))),
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
  await browser.execute((navSelector) => {
    document.querySelector(navSelector)?.click();
  }, selector);
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
