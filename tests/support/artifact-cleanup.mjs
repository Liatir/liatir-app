/**
 * Prunes old test artifacts (screenshots, reports, extracted runtimes) before a run.
 *
 * These accumulate quickly — a visual run alone writes a screenshot per assertion — so without this the
 * artifacts directory grows without bound. They are kept for a week rather than deleted immediately, because
 * the whole reason to write them is to look at them *after* a failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TTL_DAYS = 7;

function ttlDays() {
  // Overridable, so CI can keep artifacts for a shorter or longer window than a developer's machine.
  const value = Number(process.env.LIATIR_TEST_ARTIFACT_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  return Number.isFinite(value) ? value : DEFAULT_TTL_DAYS;
}

/** A file that cannot be stat'd is treated as *not* expired — cleanup must never be the thing that fails a run. */
function isExpired(entryPath, cutoffMs) {
  try {
    return fs.statSync(entryPath).mtimeMs < cutoffMs;
  } catch {
    return false;
  }
}

function pruneChildren(parentDir, cutoffMs) {
  if (!fs.existsSync(parentDir)) return;
  for (const entry of fs.readdirSync(parentDir)) {
    const entryPath = path.join(parentDir, entry);
    if (isExpired(entryPath, cutoffMs)) {
      fs.rmSync(entryPath, { force: true, recursive: true });
    }
  }
}

export function cleanupTestArtifacts(rootDir) {
  const days = ttlDays();
  if (days < 0) return { enabled: false, ttlDays: days };

  const artifactsDir = path.join(rootDir, 'tests', '.artifacts');
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const dirs = [
    path.join(artifactsDir, 'reports'),
    path.join(artifactsDir, 'screenshots'),
    path.join(artifactsDir, 'tauri-logs'),
    path.join(artifactsDir, 'visual-diffs'),
  ];

  for (const dir of dirs) {
    pruneChildren(dir, cutoffMs);
  }

  for (const stateDir of ['home', 'home-dev-smoke']) {
    const entryPath = path.join(artifactsDir, stateDir);
    if (isExpired(entryPath, cutoffMs)) {
      fs.rmSync(entryPath, { force: true, recursive: true });
    }
  }

  // The Windows E2E home lives at the root of the temp drive, not here: neither the checkout nor
  // `%TEMP%` leaves the installed box room under MAX_PATH. It still has to be pruned, or a machine
  // that runs the suite regularly keeps every past run's extracted box — several gigabytes each.
  if (process.platform === 'win32') {
    const driveRoot = path.parse(os.tmpdir()).root;
    for (const entry of fs.readdirSync(driveRoot).filter((name) => /^lt-\d+$/.test(name))) {
      const entryPath = path.join(driveRoot, entry);
      if (isExpired(entryPath, cutoffMs)) {
        fs.rmSync(entryPath, { force: true, recursive: true });
      }
    }
  }

  return { enabled: true, ttlDays: days };
}
