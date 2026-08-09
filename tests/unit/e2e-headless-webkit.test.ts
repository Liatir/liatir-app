import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { headlessWebKitEnvironment } from "../e2e/support/tauri-process.mjs";

/**
 * The E2E suite drives the real app under `xvfb`, which exposes no DRI device. WebKitGTK then fails
 * to bring up its accelerated compositor and DMA-BUF renderer and degrades quietly — until the
 * machine is under real load and the web process dies. That destroys the `main` window, and
 * `src-tauri/src/main.rs` deliberately lets the app exit once that window is gone, so the process
 * disappears with status 0 and every later WebDriver call fails with a bare `fetch failed` that
 * names neither the window nor the renderer.
 *
 * Release run 31290534596 lost the Geneformer CUDA lifecycle that way, after the box had already
 * been built, signed, scientifically validated and published.
 */
describe("headless WebKit environment", () => {
  it("forces the software renderer on Linux", () => {
    vi.stubGlobal("process", { ...process, platform: "linux", env: {} });
    try {
      expect(headlessWebKitEnvironment()).toEqual({
        WEBKIT_DISABLE_COMPOSITING_MODE: "1",
        WEBKIT_DISABLE_DMABUF_RENDERER: "1",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves other platforms untouched", () => {
    for (const platform of ["darwin", "win32"]) {
      vi.stubGlobal("process", { ...process, platform, env: {} });
      try {
        expect(headlessWebKitEnvironment(), platform).toEqual({});
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it("never overrides what the operator set", () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "linux",
      env: { WEBKIT_DISABLE_COMPOSITING_MODE: "0" },
    });
    try {
      expect(headlessWebKitEnvironment().WEBKIT_DISABLE_COMPOSITING_MODE).toBe("0");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The helper is worthless if the runner does not actually spread it into the app's environment.
  it("is applied to the spawned app", () => {
    const runner = readFileSync(new URL("../e2e/run-tauri-e2e.mjs", import.meta.url), "utf8");
    const spawnEnv = runner.slice(runner.indexOf("const child = spawn(appBinary"));

    expect(spawnEnv.slice(0, spawnEnv.indexOf("stdio:"))).toContain("...headlessWebKitEnvironment(),");
  });
});
