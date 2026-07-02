import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'expect';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { cleanupTestArtifacts } from '../support/artifact-cleanup.mjs';

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
const testHome = path.join(artifactsDir, 'home');
const logDir = path.join(artifactsDir, 'tauri-logs');
const screenshotDir = path.join(artifactsDir, 'screenshots');
const baselineDir = path.join(rootDir, 'tests', 'e2e', '__snapshots__');
const diffDir = path.join(artifactsDir, 'visual-diffs');
const embeddedPort = Number(process.env.TAURI_WEBDRIVER_PORT ?? 4445);
const baseUrl = `http://127.0.0.1:${embeddedPort}`;
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

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
    visual: argv.includes('--visual') || process.env.LIATIR_VISUAL === '1',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--visual' || arg === '--heavy') continue;
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
      HOME: testHome,
      XDG_DATA_HOME: path.join(testHome, '.local', 'share'),
      XDG_CACHE_HOME: path.join(testHome, '.cache'),
      XDG_CONFIG_HOME: path.join(testHome, '.config'),
      LIATIR_TEST_MODE: '1',
      NODE_ENV: 'test',
      RUST_LOG: process.env.RUST_LOG ?? 'warn',
      TAURI_WEBDRIVER_PORT: String(embeddedPort),
      WDIO_EMBEDDED_SERVER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  return { child, logPath, logStream };
}

async function waitForWebDriver(child) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Tauri app exited before WebDriver became available with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${baseUrl}/status`);
      if (response.ok) return await response.json();
    } catch (error) {
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
    body: JSON.stringify({ capabilities: { alwaysMatch: {}, firstMatch: [{}] } }),
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

  if (!fs.existsSync(baselinePath)) {
    fs.copyFileSync(actualPath, baselinePath);
    return { actualPath, baselinePath, baselineCreated: true, diffRatio: 0 };
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (app.child.exitCode === null) app.child.kill('SIGKILL');
  }

  app?.logStream?.end();
}

function missingRequiredEnv(test) {
  return (test.requiredEnv ?? []).filter((name) => !process.env[name]);
}

function writeE2EReport(reportPath, report) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}

async function run() {
  const { heavy, reportPath, visual, specs: specArgs } = parseArgs(process.argv.slice(2));
  const specs = resolveSpecs(specArgs, visual, heavy);
  const app = startTauriApp();
  let browser = null;
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  const runStartedAt = new Date();
  const results = [];

  const stop = async (exitCode) => {
    await cleanup(browser, app);
    process.exit(exitCode);
  };
  process.once('SIGINT', () => { void stop(130); });
  process.once('SIGTERM', () => { void stop(143); });

  try {
    await waitForWebDriver(app.child);
    const session = await createSession();
    browser = new NativeWebDriverClient(session);

    const context = {
      appLogPath: app.logPath,
      artifactsDir,
      baselineDir,
      browser,
      captureScreenshot,
      compareScreenshot,
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
  } finally {
    await cleanup(browser, app);
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
