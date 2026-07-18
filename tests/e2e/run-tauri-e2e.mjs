import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'expect';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { cleanupTestArtifacts } from '../support/artifact-cleanup.mjs';
import { tauriTestEnvironment } from './support/tauri-process.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appBinaryCandidates = process.platform === 'darwin'
  ? [
      path.join(rootDir, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'Liatir.app', 'Contents', 'MacOS', 'Liatir'),
      path.join(rootDir, 'src-tauri', 'target', 'debug', 'bundle', 'macos', 'Liatir.app', 'Contents', 'MacOS', 'liatir'),
      path.join(rootDir, 'src-tauri', 'target', 'debug', 'liatir'),
    ]
  : [path.join(rootDir, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'liatir.exe' : 'liatir')];
const appBinary = process.env.LIATIR_TAURI_APP
  ?? appBinaryCandidates.find((candidate) => fs.existsSync(candidate))
  ?? appBinaryCandidates[0];
const artifactsDir = path.join(rootDir, 'tests', '.artifacts');
const testHome = path.join(artifactsDir, 'home', `${Date.now()}-${process.pid}`);
const logDir = path.join(artifactsDir, 'tauri-logs');
const screenshotDir = path.join(artifactsDir, 'screenshots');
const baselineDir = path.join(rootDir, 'tests', 'e2e', '__snapshots__');
const diffDir = path.join(artifactsDir, 'visual-diffs');
const embeddedPort = Number(process.env.TAURI_WEBDRIVER_PORT ?? 4445);
const baseUrl = `http://127.0.0.1:${embeddedPort}`;
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const traceLifecycle = process.env.LIATIR_E2E_TRACE === '1';

cleanupTestArtifacts(rootDir);

for (const dir of [testHome, logDir, screenshotDir, baselineDir, diffDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'artifact';
}

function parseArgs(argv) {
  const options = {
    heavy: argv.includes('--heavy') || process.env.LIATIR_RUN_HEAVY_AI === '1',
    reportPath: process.env.LIATIR_E2E_REPORT ?? null,
    specs: [],
    updateSnapshots: argv.includes('--update-snapshots') || process.env.LIATIR_UPDATE_SNAPSHOTS === '1',
    visual: argv.includes('--visual') || process.env.LIATIR_VISUAL === '1',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--visual' || arg === '--heavy' || arg === '--update-snapshots') continue;
    if (arg === '--report') {
      options.reportPath = path.resolve(rootDir, argv[++index]);
      continue;
    }
    if (arg.startsWith('--report=')) {
      options.reportPath = path.resolve(rootDir, arg.slice('--report='.length));
      continue;
    }
    options.specs.push(arg);
  }

  return {
    ...options,
    specs: options.specs,
  };
}

function resolveSpecs(specArgs, visual, heavy) {
  if (specArgs.length > 0) {
    return specArgs.map((spec) => path.resolve(rootDir, spec));
  }

  return fs.readdirSync(path.join(rootDir, 'tests', 'e2e', 'specs'))
    .filter((file) => file.endsWith('.e2e.mjs'))
    .filter((file) => visual || !file.startsWith('visual.'))
    .filter((file) => heavy || !file.startsWith('heavy.'))
    .sort()
    .map((file) => path.join(rootDir, 'tests', 'e2e', 'specs', file));
}

function startTauriApp() {
  if (!fs.existsSync(appBinary)) {
    throw new Error(`Tauri test binary was not found at ${appBinary}. Run npm run test:tauri:prepare first.`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logDir, `tauri-${runId}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(appBinary, [], {
    cwd: rootDir,
    env: {
      ...process.env,
      ...tauriTestEnvironment(testHome),
      LIATIR_TEST_MODE: '1',
      NODE_ENV: 'test',
      RUST_BACKTRACE: process.env.RUST_BACKTRACE ?? '1',
      RUST_LOG: process.env.RUST_LOG ?? 'warn',
      TAURI_WEBDRIVER_PORT: String(embeddedPort),
      WDIO_EMBEDDED_SERVER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Both native streams share one destination, which cleanup closes only after
  // the child has finished so the final panic lines cannot be truncated.
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  const app = {
    child,
    closePromise: new Promise((resolve) => child.once('close', resolve)),
    logPath,
    logStream,
    spawnError: null,
  };
  child.once('error', (error) => {
    app.spawnError = error;
    if (traceLifecycle) {
      console.error(`[e2e ${new Date().toISOString()}] Tauri spawn error: ${error.message}`);
    }
  });

  if (traceLifecycle) {
    console.error(`[e2e ${new Date().toISOString()}] spawned Tauri pid=${child.pid ?? 'unknown'} port=${embeddedPort}`);
    child.once('exit', (code, signal) => {
      console.error(`[e2e ${new Date().toISOString()}] Tauri exited code=${code ?? 'none'} signal=${signal ?? 'none'}`);
    });
  }

  return app;
}

async function waitForWebDriver(app) {
  let lastError = null;
  let readySince = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (app.spawnError) {
      throw new Error(`Tauri app could not be started: ${app.spawnError.message}`, { cause: app.spawnError });
    }
    if (app.child.exitCode !== null) {
      throw new Error(`Tauri app exited before WebDriver became available with code ${app.child.exitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/status`);
      const payload = await response.json();
      if (response.ok && payload.value?.ready === true) {
        readySince ??= Date.now();
        // The embedded server can see the window just before WebKit finishes its first navigation.
        // Require two consecutive ready checks so the first script is not sent into that transition.
        if (Date.now() - readySince >= 500) return payload;
      } else {
        readySince = null;
        lastError = new Error(payload.value?.message ?? `WebDriver status returned ${response.status}`);
      }
    } catch (error) {
      readySince = null;
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for embedded WebDriver at ${baseUrl}/status: ${lastError?.message ?? 'unknown error'}`);
}

async function createSession() {
  const response = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: { 'wdio:tauriServiceOptions': { windowLabel: 'main' } },
        firstMatch: [{}],
      },
    }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok || !payload.value?.sessionId) {
    throw new Error(`Failed to create WebDriver session: ${response.status} ${text}`);
  }

  return {
    sessionId: payload.value.sessionId,
    capabilities: payload.value.capabilities ?? {},
  };
}

class WebDriverElement {
  constructor(client, selector, id = null) {
    this.client = client;
    this.selector = selector;
    this.id = id;
  }

  async resolveId() {
    if (this.id) return this.id;
    this.id = await this.client.findElementId(this.selector);
    return this.id;
  }

  async isExisting() {
    try {
      await this.resolveId();
      return true;
    } catch (error) {
      if (error.code === 'no such element') return false;
      throw error;
    }
  }

  async isDisplayed() {
    if (!(await this.isExisting())) return false;
    return this.client.request('GET', `/element/${await this.resolveId()}/displayed`);
  }

  async waitForDisplayed(options = {}) {
    await this.client.waitUntil(
      async () => this.isDisplayed(),
      {
        timeout: options.timeout ?? 20_000,
        timeoutMsg: options.timeoutMsg ?? `Element was not displayed: ${this.selector}`,
      },
    );
  }

  async click() {
    await this.client.request('POST', `/element/${await this.resolveId()}/click`, {});
  }

  async setValue(value) {
    const id = await this.resolveId();
    await this.client.request('POST', `/element/${id}/clear`, {});
    await this.client.request('POST', `/element/${id}/value`, {
      text: String(value),
      value: Array.from(String(value)),
    });
  }

  async getText() {
    return this.client.request('GET', `/element/${await this.resolveId()}/text`);
  }
}

class NativeWebDriverClient {
  constructor(session) {
    this.sessionId = session.sessionId;
    this.capabilities = session.capabilities;
  }

  async request(method, endpoint, body) {
    const requestStartedAt = Date.now();
    if (traceLifecycle) {
      console.error(`[e2e ${new Date().toISOString()}] WebDriver ${method} ${endpoint}`);
    }
    const response = await fetch(`${baseUrl}/session/${this.sessionId}${endpoint}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    const value = payload.value;

    if (!response.ok || value?.error) {
      const error = new Error(value?.message ?? `WebDriver ${method} ${endpoint} failed with ${response.status}`);
      error.code = value?.error;
      throw error;
    }

    if (traceLifecycle) {
      console.error(`[e2e ${new Date().toISOString()}] WebDriver ${method} ${endpoint} completed in ${Date.now() - requestStartedAt}ms`);
    }

    return value;
  }

  async deleteSession() {
    await fetch(`${baseUrl}/session/${this.sessionId}`, { method: 'DELETE' }).catch(() => {});
  }

  async execute(scriptOrFn, ...args) {
    const script = typeof scriptOrFn === 'function'
      ? `return (${scriptOrFn.toString()}).apply(null, arguments)`
      : scriptOrFn;
    return this.request('POST', '/execute/sync', { script, args });
  }

  async findElementId(selector) {
    const result = await this.request('POST', '/element', {
      using: 'css selector',
      value: selector,
    });
    return result[elementKey] ?? result.ELEMENT;
  }

  async findElements(selector) {
    const result = await this.request('POST', '/elements', {
      using: 'css selector',
      value: selector,
    });
    return result.map((element) => new WebDriverElement(this, selector, element[elementKey] ?? element.ELEMENT));
  }

  async $(selector) {
    return new WebDriverElement(this, selector);
  }

  async $$(selector) {
    return this.findElements(selector);
  }

  async waitUntil(condition, options = {}) {
    const timeout = options.timeout ?? 20_000;
    const interval = options.interval ?? 100;
    const started = Date.now();
    let lastError = null;

    while (Date.now() - started <= timeout) {
      try {
        if (await condition()) return true;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`${options.timeoutMsg ?? 'waitUntil condition failed'}${lastError ? `: ${lastError.message}` : ''}`);
  }

  async saveScreenshot(screenshotPath) {
    const base64 = await this.request('GET', '/screenshot');
    fs.writeFileSync(screenshotPath, Buffer.from(base64, 'base64'));
  }
}

async function captureScreenshot(browser, name) {
  const screenshotPath = path.join(screenshotDir, `${slugify(name)}.png`);
  await browser.saveScreenshot(screenshotPath);
  return screenshotPath;
}

async function compareScreenshot(browser, name, options = {}) {
  const threshold = Number(options.threshold ?? process.env.LIATIR_VISUAL_THRESHOLD ?? 0.01);
  const actualPath = await captureScreenshot(browser, name);
  const baselinePath = path.join(baselineDir, `${slugify(name)}.png`);
  const diffPath = path.join(diffDir, `${slugify(name)}.diff.png`);

  if (options.updateSnapshots) {
    fs.copyFileSync(actualPath, baselinePath);
    return { actualPath, baselinePath, baselineUpdated: true, diffRatio: 0 };
  }

  if (!fs.existsSync(baselinePath)) {
    throw new Error(
      `Visual baseline is missing for ${name}: ${baselinePath}. Run npm run test:visual:update to create it intentionally.`,
    );
  }

  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));

  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    throw new Error(
      `Visual baseline size mismatch for ${name}: expected ${baseline.width}x${baseline.height}, got ${actual.width}x${actual.height}.`,
    );
  }

  const diff = new PNG({ width: actual.width, height: actual.height });
  const mismatch = pixelmatch(actual.data, baseline.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
  });
  const diffRatio = mismatch / (actual.width * actual.height);

  if (diffRatio > threshold) {
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
    throw new Error(
      `Visual mismatch for ${name}: ${(diffRatio * 100).toFixed(2)}% changed, threshold ${(threshold * 100).toFixed(2)}%. Diff: ${diffPath}`,
    );
  }

  return { actualPath, baselinePath, diffRatio };
}

async function cleanup(browser, app) {
  if (browser) {
    try {
      await browser.deleteSession();
    } catch {
      // The session may already be gone after a failed startup.
    }
  }

  if (app?.child && app.child.exitCode === null) {
    app.child.kill('SIGTERM');
    await Promise.race([
      app.closePromise,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (app.child.exitCode === null) app.child.kill('SIGKILL');
  }

  if (app?.closePromise) {
    await Promise.race([
      app.closePromise,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  if (app) await closeLogStream(app.logStream);
}

/** Flushes and closes the shared native-app log exactly once. */
async function closeLogStream(logStream) {
  if (!logStream || logStream.closed || logStream.destroyed) return;
  await new Promise((resolve, reject) => {
    logStream.once('error', reject);
    logStream.end(resolve);
  });
}

function missingRequiredEnv(test) {
  return (test.requiredEnv ?? []).filter((name) => !process.env[name]);
}

function writeE2EReport(reportPath, report) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

/** Returns a bounded native-app log tail so CI failures are actionable without uploading logs. */
function readTauriLogTail(logPath, maxBytes = 12 * 1024) {
  try {
    const log = fs.readFileSync(logPath);
    return log.subarray(Math.max(0, log.length - maxBytes)).toString('utf8').trim();
  } catch {
    return '';
  }
}

async function run() {
  const { heavy, reportPath, updateSnapshots, visual, specs: specArgs } = parseArgs(process.argv.slice(2));
  const specs = resolveSpecs(specArgs, visual, heavy);
  const app = startTauriApp();
  let browser = null;
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  let harnessError = null;
  let startupCompleted = false;
  const runStartedAt = new Date();
  const results = [];

  const stop = async (exitCode) => {
    await cleanup(browser, app);
    process.exit(exitCode);
  };
  process.once('SIGINT', () => { void stop(130); });
  process.once('SIGTERM', () => { void stop(143); });

  try {
    await waitForWebDriver(app);
    const session = await createSession();
    browser = new NativeWebDriverClient(session);
    startupCompleted = true;

    const context = {
      appLogPath: app.logPath,
      artifactsDir,
      baselineDir,
      browser,
      captureScreenshot,
      compareScreenshot: (client, name, options = {}) => compareScreenshot(client, name, {
        ...options,
        updateSnapshots,
      }),
      expect,
      rootDir,
      screenshotDir,
    };

    for (const specPath of specs) {
      const mod = await import(pathToFileURL(specPath).href);
      const tests = mod.tests ?? [];
      if (!Array.isArray(tests) || tests.length === 0) {
        throw new Error(`E2E spec ${specPath} does not export a non-empty tests array.`);
      }

      console.log(`\n${path.relative(rootDir, specPath)}`);
      for (const test of tests) {
        const testStartedAt = new Date();
        const requiredEnvMissing = missingRequiredEnv(test);
        if (test.heavy && !heavy) {
          skipped += 1;
          console.log(`  - ${test.name} ... skipped`);
          results.push({
            durationMs: 0,
            heavy: true,
            name: test.name,
            reason: 'Heavy test not enabled.',
            specPath: path.relative(rootDir, specPath),
            status: 'skipped',
          });
          continue;
        }
        if (requiredEnvMissing.length > 0) {
          skipped += 1;
          console.log(`  - ${test.name} ... skipped`);
          results.push({
            durationMs: 0,
            heavy: Boolean(test.heavy),
            name: test.name,
            reason: `Missing required environment variable${requiredEnvMissing.length === 1 ? '' : 's'}: ${requiredEnvMissing.join(', ')}`,
            specPath: path.relative(rootDir, specPath),
            status: 'skipped',
          });
          continue;
        }

        process.stdout.write(`  - ${test.name} ... `);
        try {
          await test.run(context);
          passed += 1;
          console.log('ok');
          results.push({
            durationMs: Date.now() - testStartedAt.getTime(),
            heavy: Boolean(test.heavy),
            name: test.name,
            specPath: path.relative(rootDir, specPath),
            status: 'passed',
          });
        } catch (error) {
          failed += 1;
          console.log('failed');
          const failureScreenshot = await captureScreenshot(browser, `failure-${test.name}`).catch(() => null);
          console.error(error?.stack ?? error);
          if (failureScreenshot) console.error(`Failure screenshot: ${failureScreenshot}`);
          console.error(`Tauri log: ${app.logPath}`);
          console.error(`Tauri process: exitCode=${app.child.exitCode ?? 'running'}, signal=${app.child.signalCode ?? 'none'}`);
          const tauriLogTail = readTauriLogTail(app.logPath);
          if (tauriLogTail) console.error(`Tauri log tail (last 12 KiB):\n${tauriLogTail}`);
          results.push({
            durationMs: Date.now() - testStartedAt.getTime(),
            error: error?.stack ?? String(error),
            failureScreenshot,
            heavy: Boolean(test.heavy),
            name: test.name,
            specPath: path.relative(rootDir, specPath),
            status: 'failed',
          });
        }
      }
    }
  } catch (error) {
    harnessError = error;
    failed += 1;
  } finally {
    await cleanup(browser, app);
  }

  if (harnessError) {
    const tauriLogTail = readTauriLogTail(app.logPath);
    results.push({
      durationMs: Date.now() - runStartedAt.getTime(),
      error: harnessError?.stack ?? String(harnessError),
      heavy,
      name: startupCompleted ? 'E2E harness' : 'Native app startup',
      nativeLogTail: tauriLogTail || null,
      specPath: '<runner>',
      status: 'failed',
    });
    if (!startupCompleted) {
      console.error('Tauri startup failed before WebDriver became available.');
    }
    console.error(harnessError?.stack ?? harnessError);
    console.error(`Tauri log: ${app.logPath}`);
    console.error(`Tauri process: exitCode=${app.child.exitCode ?? 'running'}, signal=${app.child.signalCode ?? 'none'}`);
    if (tauriLogTail) console.error(`Tauri log tail (last 12 KiB):\n${tauriLogTail}`);
  }

  const runFinishedAt = new Date();
  writeE2EReport(reportPath, {
    appLogPath: app.logPath,
    artifactsDir,
    heavy,
    specs: specs.map((spec) => path.relative(rootDir, spec)),
    startedAt: runStartedAt.toISOString(),
    finishedAt: runFinishedAt.toISOString(),
    summary: {
      durationMs: runFinishedAt.getTime() - runStartedAt.getTime(),
      failed,
      passed,
      skipped,
      total: passed + failed + skipped,
    },
    tests: results,
    visual,
  });

  console.log(`\nE2E result: ${passed} passed, ${failed} failed, ${skipped} skipped.`);
  if (reportPath) console.log(`E2E report: ${reportPath}`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
