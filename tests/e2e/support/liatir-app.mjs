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

/**
 * Reloads the app the way a user's restart does, without deadlocking the WebDriver session.
 *
 * `window.location.reload()` executed directly tears the document down before WebView2 sends the
 * script's response, so the command never completes and the run sits on the harness's 600s script
 * timeout instead of failing. Windows found this first — the single-cell lighthouse hung there on
 * its first native run — but the deferred reload is correct on every platform, so it is shared
 * rather than branched. The reload is then confirmed against a new `performance.timeOrigin`, which
 * is what distinguishes a completed reload from a document that never went away.
 */
export async function reloadLiatirApp(browser) {
  await replaceDocument(
    browser,
    () => { window.setTimeout(() => window.location.reload(), 50); },
    null,
    'reload',
  );
}

/**
 * Loads a route with a real document load, the way a deep link or a cold start does.
 *
 * Prefer `navigateInApp` for ordinary in-app routing; this is for the cases that deliberately
 * exercise a fresh document on a URL.
 */
export async function hardNavigateInApp(browser, destination) {
  await replaceDocument(
    browser,
    (target) => { window.setTimeout(() => { window.location.href = target; }, 50); },
    destination,
    `navigation to ${destination}`,
  );
}

/**
 * Replaces the current document without deadlocking the WebDriver session.
 *
 * A navigation performed directly inside `browser.execute` tears the document down before WebView2
 * sends the script's response, so the command never completes and the run sits on the harness's
 * 600-second script timeout instead of failing. Windows found this first: the single-cell
 * lighthouse hung there on its first native run, and every Quenta deep-link case cost ten minutes
 * apiece. Deferring the navigation by one turn lets the response go out first, and is correct on
 * every platform, so it is shared rather than branched. Completion is then confirmed against a new
 * `performance.timeOrigin`, which is what distinguishes a finished load from a document that never
 * went away.
 */
async function replaceDocument(browser, startNavigation, argument, description) {
  const previousTimeOrigin = await browser.execute(() => performance.timeOrigin);
  await browser.execute(startNavigation, argument);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await browser.waitUntil(
    async () => browser.execute((previous) => performance.timeOrigin !== previous, previousTimeOrigin),
    { timeout: 30_000, timeoutMsg: `Liatir did not complete the requested ${description}` },
  );
  await waitForLiatirBridge(browser);
}

/**
 * Sets a bound input to an exact value, including the empty string.
 *
 * `setValue('')` cannot clear a Svelte-bound field: WebDriver's `clear` fires no `input` event and
 * an empty string types no keystrokes, so the component's state keeps the previous value while the
 * DOM looks empty. Assigning through the native setter and dispatching `input` is what the binding
 * actually listens to.
 */
export async function setAppInputValue(browser, selector, value) {
  await browser.execute((target, next) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`Input not found: ${target}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, selector, value);
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
