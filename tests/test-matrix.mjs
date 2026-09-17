/**
 * The test matrix: every suite in the repo, declared as data.
 *
 * Suites are grouped into *profiles* because they differ enormously in cost. `fast` runs in seconds and is what
 * you use while working; `verify` adds the type checks and builds, and is the gate before committing; `ui`
 * drives the real app through WebDriver, which needs a compiled binary; `heavy-ai` actually downloads and runs
 * models, and takes as long as that sounds.
 *
 * Keeping this as a declaration rather than a shell script is what lets the runner report which suite failed,
 * enforce a per-suite timeout, and let a caller pick a profile by name.
 */
import { npmInvocation } from '../scripts/node-cli.mjs';

const npm = npmInvocation([]);
const npmArgs = (args) => [...npm.args, ...args];

export const testProfiles = {
  fast: ['unit'],
  verify: ['unit', 'signer-policy', 'sdk-types', 'core-build', 'frontend-check', 'frontend-build', 'src-ts-compile'],
  build: ['sdk-types', 'core-build', 'frontend-check', 'frontend-build', 'src-ts-compile'],
  // Every UI profile begins with `tauri-prepare`: the end-to-end suites drive a real compiled binary, and it
  // has to exist before anything can be driven.
  ui: [
    'tauri-prepare',
    'tauri-e2e',
    'single-cell-index-e2e',
    'snpeff-suite-e2e',
    'pipeline-settlement-restart-e2e',
    'runtime-box-security-e2e',
    'desktop-beta-lifecycle-e2e',
    'desktop-beta-windows-lifecycle-e2e',
    'desktop-beta-linux-lifecycle-e2e',
  ],
  visual: ['tauri-prepare', 'visual-e2e'],
  'heavy-ai': ['tauri-prepare', 'heavy-ai-e2e'],
  all: [
    'unit',
    'signer-policy',
    'sdk-types',
    'core-build',
    'frontend-check',
    'frontend-build',
    'src-ts-compile',
    'tauri-prepare',
    'tauri-e2e',
    'single-cell-index-e2e',
    'snpeff-suite-e2e',
    'pipeline-settlement-restart-e2e',
    'runtime-box-security-e2e',
    'desktop-beta-lifecycle-e2e',
    'desktop-beta-windows-lifecycle-e2e',
    'desktop-beta-linux-lifecycle-e2e',
    'visual-e2e',
    'heavy-ai-e2e',
  ],
};

export const testSuites = [
  {
    id: 'unit',
    label: 'Unit and contract tests',
    layer: 'unit',
    command: npm.command,
    args: npmArgs(['run', 'test:unit']),
    timeoutMs: 120_000,
    description: 'Fast deterministic tests for shared contracts, registries, parsers, and helpers.',
  },
  {
    // The signer is its own Node service with its own `node --test` suite, which vitest never reaches.
    // Outside every gate, it went stale for five days and hid a policy that refused the index catalog.
    id: 'signer-policy',
    label: 'Runtime Box signer policy tests',
    layer: 'unit',
    command: npm.command,
    args: npmArgs(['run', 'runtime-box:signer:check']),
    timeoutMs: 60_000,
    description: 'Tests the policy that decides what the production signing key will sign.',
  },
  {
    id: 'sdk-types',
    label: 'SDK type generation',
    layer: 'build',
    command: npm.command,
    args: npmArgs(['run', 'gen:sdk-types']),
    timeoutMs: 120_000,
    description: 'Regenerates frontend SDK bridge types from the shared source of truth.',
  },
  {
    id: 'core-build',
    label: 'Core package build',
    layer: 'build',
    command: npm.command,
    args: npmArgs(['run', 'build', '--prefix', 'packages/liatir-core']),
    timeoutMs: 120_000,
    description: 'Builds packages/liatir-core, the shared contract package.',
  },
  {
    id: 'frontend-check',
    label: 'Frontend Svelte check',
    layer: 'build',
    command: npm.command,
    args: npmArgs(['run', 'check', '--prefix', 'frontend']),
    timeoutMs: 180_000,
    description: 'Runs the frontend type and Svelte compiler checks.',
  },
  {
    id: 'frontend-build',
    label: 'Frontend production build',
    layer: 'build',
    command: npm.command,
    args: npmArgs(['run', 'build', '--prefix', 'frontend']),
    timeoutMs: 240_000,
    description: 'Builds the web assets that Tauri ships.',
  },
  {
    id: 'src-ts-compile',
    label: 'Root TypeScript compile',
    layer: 'build',
    command: npm.command,
    args: npmArgs(['run', 'ts:compile:src-ts']),
    timeoutMs: 180_000,
    description: 'Compiles shared TypeScript outside the frontend package.',
  },
  {
    id: 'tauri-prepare',
    label: 'Tauri test binary prepare',
    layer: 'tauri',
    command: npm.command,
    args: npmArgs(['run', 'test:tauri:prepare']),
    // A cold build takes about twenty minutes on Windows since the test binary compiles at
    // opt-level 2 — unoptimized, it hashes a 12.7 GB Runtime Box too slowly to install one inside a
    // lifecycle test. The old ten-minute budget failed the suite while the build ran on to finish.
    timeoutMs: 2_400_000,
    description: 'Builds the debug Tauri binary with embedded WebDriver enabled.',
  },
  {
    id: 'tauri-e2e',
    label: 'Native Tauri E2E',
    layer: 'tauri',
    command: npm.command,
    args: npmArgs(['run', 'test:tauri:run']),
    // The whole spec directory, driven through a real webview. It takes about seven minutes on
    // Windows, so the old five-minute budget reported a timeout on a suite that had actually run to
    // completion and printed its result.
    timeoutMs: 900_000,
    e2eReport: true,
    description: 'Runs native webview tests against the compiled Tauri app.',
  },
  {
    id: 'visual-e2e',
    label: 'Native visual smoke',
    layer: 'visual',
    command: 'node',
    args: ['tests/e2e/run-tauri-e2e.mjs', '--visual', 'tests/e2e/specs/visual.smoke.e2e.mjs'],
    timeoutMs: 300_000,
    e2eReport: true,
    description: 'Captures and compares native webview screenshots against baselines.',
  },
  {
    id: 'single-cell-index-e2e',
    label: 'Single-cell reference index lifecycle',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-single-cell-index-e2e.mjs'],
    timeoutMs: 180_000,
    e2eReport: true,
    description: 'Installs a tiny signed index, proves verified reuse without a second download, and removes it.',
  },
  {
    id: 'snpeff-suite-e2e',
    label: 'SnpEff and SnpSift managed lifecycle',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-snpeff-suite-e2e.mjs'],
    timeoutMs: 180_000,
    e2eReport: true,
    description: 'Installs tiny suite and database fixtures, proves verified reuse, and removes both cleanly.',
  },
  {
    id: 'pipeline-settlement-restart-e2e',
    label: 'Pipeline settlement restart lifecycle',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-pipeline-settlement-restart-e2e.mjs'],
    timeoutMs: 180_000,
    e2eReport: true,
    description: 'Runs an active API pipeline across two native app processes and verifies exactly-once interrupted recovery.',
  },
  {
    id: 'runtime-box-security-e2e',
    label: 'Runtime Box security lifecycle',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-runtime-box-security-e2e.mjs'],
    timeoutMs: 300_000,
    e2eReport: true,
    description: 'Runs signed A to B update, app restart, rollback, anti-replay, equivocation, and corrupt-state checks.',
  },
  {
    id: 'desktop-beta-lifecycle-e2e',
    label: 'Desktop Beta install lifecycle',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-desktop-beta-macos-e2e.mjs'],
    timeoutMs: 300_000,
    platforms: ['darwin'],
    e2eReport: true,
    description: 'Copies the app into a temporary Applications directory and proves migration, restart recovery and Results retention after uninstall.',
  },
  {
    id: 'desktop-beta-windows-lifecycle-e2e',
    label: 'Desktop Beta install lifecycle (Windows)',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-desktop-beta-windows-e2e.mjs'],
    timeoutMs: 300_000,
    platforms: ['win32'],
    e2eReport: true,
    description: 'Copies the app into a temporary per-user program directory and proves migration, restart recovery and Results retention after uninstall.',
  },
  {
    id: 'desktop-beta-linux-lifecycle-e2e',
    label: 'Desktop Beta install lifecycle (Linux)',
    layer: 'tauri',
    command: 'node',
    args: ['scripts/run-desktop-beta-linux-e2e.mjs'],
    timeoutMs: 300_000,
    platforms: ['linux'],
    e2eReport: true,
    description: 'Copies the app into a temporary /usr/bin-shaped directory and proves migration, restart recovery and Results retention after uninstall.',
  },
  {
    id: 'heavy-ai-e2e',
    label: 'Gated heavy AI Model checks',
    layer: 'heavy-ai',
    command: 'node',
    args: ['tests/e2e/run-tauri-e2e.mjs', '--heavy', 'tests/e2e/specs/heavy.ai-models.e2e.mjs'],
    timeoutMs: 3_600_000,
    heavy: true,
    requiredEnv: ['LIATIR_RUN_HEAVY_AI'],
    e2eReport: true,
    description: 'Opt-in AI Model catalog/install checks that may download large runtimes or model files.',
  },
];
