# Testing Liatir

Liatir is a local Tauri desktop app. Production-grade tests must exercise the
native bridge whenever a feature depends on filesystem access, dependencies,
jobs, AI runtimes, viewer capture, sidecars, or `.lia` execution.

## Test Layers

- `npm run test:unit`
  Fast TypeScript contract/helper tests. Use this for pure registry contracts,
  parsers, path display helpers, and other deterministic logic.

- `npm run test:tauri`
  Full native E2E tests. This builds the frontend, compiles the Tauri bridge,
  builds the debug Tauri binary with the `wdio` feature, then runs the custom
  Tauri E2E harness against the real native webview.

- `npm run test:tauri:run`
  Runs the native E2E suite against an already-built
  `src-tauri/target/debug/bundle/macos/Liatir.app` debug bundle on macOS. Use this after
  `npm run test:tauri:prepare` while iterating on tests.

- `npm run test:visual`
  Runs the visual smoke suite. The harness captures PNG screenshots from the
  native webview and compares them against baselines in
  `tests/e2e/__snapshots__`. First run creates the missing baseline.

- `npm run test:quality`
  Runs unit tests, prepares and runs native Tauri E2E tests, then runs the
  visual smoke suite. Use this before handing off larger UI/runtime changes.

## Native Harness

The E2E runner lives in `tests/e2e/run-tauri-e2e.mjs`.

It intentionally owns the native lifecycle:

- launches the compiled Tauri binary directly;
- prefers the binary inside the debug `.app` bundle so frontend assets and
  bundled resources resolve like the real app;
- sets a test-only app storage root;
- starts the embedded WebDriver server through the `wdio` Cargo feature;
- creates the WebDriver session with standard `fetch`;
- drives the native webview through a small fetch-based WebDriver client;
- captures failure screenshots and Tauri logs under `tests/.artifacts`.

The custom session creation is deliberate. The upstream WebdriverIO runner
currently fails to create a session against the embedded Tauri WebDriver server
in this local Node/toolchain combination, while the same server works through
standard `fetch`.

## Isolation

E2E tests launch Liatir with a test-only `HOME`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, and `XDG_CONFIG_HOME` under `tests/.artifacts/home`.
This prevents tests from reading or mutating the developer's real Liatir app
data in Application Support.

## Tooling Choice

Tauri on macOS uses WKWebView, which Playwright cannot reliably drive as a
native desktop webview. Native E2E tests therefore use the embedded Tauri
WebDriver server and a small WebDriver client implemented in the harness.

Playwright can still be added later for browser-only checks, but it must not be
used as the primary quality gate for features that depend on the native Tauri
bridge.

## Writing New Tests

Add native E2E specs under `tests/e2e/specs`. A spec exports a `tests` array:

```js
export const tests = [
  {
    name: 'opens the sandbox workspace',
    async run({ browser, expect }) {
      // Use browser commands against the real Tauri webview.
    },
  },
];
```

Use native E2E tests for:

- dependency install/check/update flows;
- AI Model install/remove/run flows;
- pipeline execution and Jobs page behavior;
- viewer rendering, fullscreen, screenshot capture;
- real filesystem persistence and analysis-run finalization.

Use unit tests for:

- source-of-truth registry invariants;
- parsers and output adapters;
- path sanitization and display helpers;
- deterministic data transformations.

Do not install heavy models or large dependencies in the default smoke suite.
Put those in explicit, opt-in tests with clear names and timeouts.
