import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmInvocation } from './node-cli.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostHome = os.homedir();
const artifactsDir = path.join(rootDir, 'tests', '.artifacts');
const testHome = path.join(artifactsDir, 'home-dev-smoke');
const logDir = path.join(artifactsDir, 'tauri-dev-smoke');
const timeoutMs = Number(process.env.LIATIR_DEV_SMOKE_TIMEOUT_MS ?? 90_000);
const startedPattern = /Running.*target\/debug\/liatir/;
const failedPattern = /error: failed to run custom build command|Permission .* not found|failed to compile|error\[/i;

fs.mkdirSync(testHome, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(logDir, `dev-smoke-${runId}.log`);
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

let settled = false;
let output = '';

const npm = npmInvocation(['run', 'dev']);
const child = spawn(npm.command, npm.args, {
  cwd: rootDir,
  detached: true,
  env: {
    ...process.env,
    HOME: testHome,
    XDG_DATA_HOME: path.join(testHome, '.local', 'share'),
    XDG_CACHE_HOME: path.join(testHome, '.cache'),
    XDG_CONFIG_HOME: path.join(testHome, '.config'),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(hostHome, '.rustup'),
    CARGO_HOME: process.env.CARGO_HOME ?? path.join(hostHome, '.cargo'),
    LIATIR_TEST_MODE: '1',
    RUST_LOG: process.env.RUST_LOG ?? 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

function append(chunk) {
  const text = chunk.toString();
  output += text;
  logStream.write(text);

  if (!settled && failedPattern.test(output)) {
    settled = true;
    fail(`Tauri dev smoke failed before startup. Log: ${logPath}`);
  }

  if (!settled && startedPattern.test(output)) {
    settled = true;
    pass();
  }
}

function stopChild(signal) {
  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // The process may already be gone.
      }
    }
  }
}

function pass() {
  const forceTimer = setTimeout(() => stopChild('SIGKILL'), 5_000);
  child.once('exit', () => {
    clearTimeout(forceTimer);
    logStream.end();
    console.log(`Tauri dev smoke passed. Log: ${logPath}`);
    process.exit(0);
  });
  stopChild('SIGINT');
}

function fail(message) {
  const forceTimer = setTimeout(() => stopChild('SIGKILL'), 5_000);
  child.once('exit', () => {
    clearTimeout(forceTimer);
    logStream.end();
    console.error(message);
    process.exit(1);
  });
  stopChild('SIGINT');
}

child.stdout.on('data', append);
child.stderr.on('data', append);

child.once('exit', (code) => {
  if (!settled) {
    settled = true;
    logStream.end();
    console.error(`Tauri dev smoke exited before startup with code ${code}. Log: ${logPath}`);
    process.exit(1);
  }
});

setTimeout(() => {
  if (!settled) {
    settled = true;
    fail(`Timed out waiting for Tauri dev startup after ${timeoutMs}ms. Log: ${logPath}`);
  }
}, timeoutMs);
