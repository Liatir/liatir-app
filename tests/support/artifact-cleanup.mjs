import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TTL_DAYS = 7;

function ttlDays() {
  const value = Number(process.env.LIATIR_TEST_ARTIFACT_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  return Number.isFinite(value) ? value : DEFAULT_TTL_DAYS;
}

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

  return { enabled: true, ttlDays: days };
}
