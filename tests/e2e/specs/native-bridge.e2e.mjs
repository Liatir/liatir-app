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
import { comparablePath, isolatedTestHome } from '../support/tauri-process.mjs';

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
      expect(comparablePath(bridgeState.appPath)).toContain(isolatedTestHome());
      expect(comparablePath(bridgeState.dataPath)).toContain(isolatedTestHome());
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
  {
    /**
     * Revealing a run folder used to go through the shell plugin's `open`, which validates its
     * argument against a URL regex — so the call was rejected before reaching the platform and the
     * button did nothing at all. What that needs is a command that is actually registered and
     * actually reachable from the webview, which is what this checks.
     *
     * Deliberately never asks for a directory that exists: succeeding would launch the host's file
     * manager in the middle of the suite. Reaching Rust and being refused for the right reason
     * proves the wiring; the refusals themselves are the security boundary.
     */
    name: 'reveals only directories inside the data root, through a command of its own',
    async run({ browser, expect }) {
      await waitForLiatirBridge(browser);

      const outcome = await browser.execute(async () => {
        const attempt = async (rel) => {
          try {
            await window.Liatir.invoke('lia_fs_reveal', { rel });
            return 'resolved';
          } catch (error) {
            return String(error);
          }
        };
        return {
          missing: await attempt('runs/does-not-exist'),
          escaping: await attempt('../../../../../../etc'),
          hasOpenPath: typeof window.Liatir.openPath,
        };
      });

      // Registered: an unregistered command fails with "not allowed"/"not found" instead.
      expect(outcome.missing).toContain('not a directory');
      expect(outcome.escaping).toContain('Path traversal not allowed');
      // The bridge must not keep the second, broken way to do this.
      expect(outcome.hasOpenPath).toBe('undefined');
    },
  },
];
