/**
 * Smoke test for the bridge itself: `window.Liatir` exists in the webview, is ready, and its commands reach Rust.
 *
 * If this fails, nothing else in the end-to-end suite means anything — so it is worth having as its own spec.
 */
import {
  expectNoVisibleRuntimeError,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

/** Normalizes native paths only for platform-independent containment assertions. */
function comparablePath(value) {
  return String(value).replaceAll('\\', '/');
}

export const tests = [
  {
    name: 'starts the real Tauri app with an isolated app storage root',
    async run({ browser, expect }) {
      await waitForLiatirBridge(browser);

      const bridgeState = await browser.execute(async () => {
        const appPath = await window.Liatir.invoke('lia_app_path');
        const dataPath = await window.Liatir.desktop.fs.data.path();

        return {
          hasLiatir: Boolean(window.Liatir?.isAvailable),
          appPath,
          dataPath,
        };
      });

      expect(bridgeState.hasLiatir).toBe(true);
      expect(comparablePath(bridgeState.appPath)).toContain('tests/.artifacts/home');
      expect(comparablePath(bridgeState.dataPath)).toContain('tests/.artifacts/home');
    },
  },
  {
    name: 'opens the sandbox workspace through the real workspace store',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);

      const workspaceState = await browser.execute(() => ({
        path: window.location.pathname,
        hasSidebar: Boolean(document.querySelector('[data-testid="sidebar-nav-item"]')),
      }));

      expect(workspaceState.path).not.toBe('/workspaces');
      expect(workspaceState.hasSidebar).toBe(true);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
