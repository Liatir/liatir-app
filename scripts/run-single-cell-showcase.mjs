/** Execute the actual no-code showcase in a native test workspace, reusing installed signed models. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBackground } from './single-cell-background.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--detach')) {
  const launched = launchBackground({
    directory: path.join(root, 'showcases/single-cell-foundation-benchmark/transfer/executions'),
    args: [fileURLToPath(import.meta.url), ...process.argv.slice(2).filter((arg) => arg !== '--detach')], cwd: root,
  });
  console.log(JSON.stringify(launched));
  process.exit(0);
}
const dataset = process.argv[2] ?? 'pbmc';
const methods = process.argv[3] ?? 'pca,geneformer,harmony,scvi,scgpt,uce';
if (!['pbmc', 'pancreas'].includes(dataset)) throw new Error('Expected pbmc or pancreas.');
const allowed = ['pca', 'geneformer', 'harmony', 'scvi', 'scgpt', 'uce'];
if (methods.split(',').some((m) => !allowed.includes(m))) throw new Error('Unknown method.');
const modelRoot = process.env.LIATIR_STUDY_MODEL_ROOT;
if (!modelRoot || !path.isAbsolute(modelRoot) || !fs.statSync(modelRoot).isDirectory()) {
  throw new Error('Set LIATIR_STUDY_MODEL_ROOT to the existing signed ai-runtimes directory.');
}
const home = path.join(root, 'tests/.artifacts/home/single-cell-showcase');
const app = process.platform === 'darwin'
  ? path.join(home, 'Library/Application Support/app.liatir.app')
  : process.platform === 'linux' ? path.join(home, '.local/share/app.liatir.app') : null;
if (!app) throw new Error('This driver supports native macOS/Linux. The UI remains the cross-platform entry point.');
const destination = path.join(app, '.liatir/.main/data/ai-runtimes');
const runtimeNames = ['single-cell-foundation-geneformer-v1-10m', 'single-cell-foundation-scgpt-whole-human', 'single-cell-foundation-uce'];
fs.mkdirSync(destination, { recursive: true });
for (const name of runtimeNames) {
  const source = path.join(modelRoot, name);
  if (!fs.existsSync(path.join(source, 'runtime-box-activation.json'))) continue;
  const target = path.join(destination, name);
  if (fs.existsSync(target)) {
    if (fs.realpathSync(target) !== fs.realpathSync(source)) throw new Error(`Conflicting runtime: ${target}`);
  } else fs.symlinkSync(source, target, 'dir');
}
const report = path.join(root, `showcases/single-cell-foundation-benchmark/validation/native-${dataset}-${Date.now()}.json`);
// Installed environments contain large trees and directory links. Only this
// workspace's run outputs belong to the progress observer.
const runsRoot = path.join(app, '.liatir/.main/data/workspaces/__test__/runs');
fs.mkdirSync(runsRoot, { recursive: true });
const child = spawn(process.execPath, ['tests/e2e/run-tauri-e2e.mjs', '--heavy', '--report', report,
  'tests/e2e/specs/heavy.single-cell-study.e2e.mjs'], {
  cwd: root, stdio: 'inherit', env: { ...process.env,
    LIATIR_E2E_TEST_HOME_OVERRIDE: home, LIATIR_TEST_ARTIFACT_TTL_DAYS: '-1',
    LIATIR_E2E_SCRIPT_TIMEOUT_MS: '86400000', LIATIR_STUDY_DATASET: dataset, LIATIR_STUDY_METHODS: methods,
    LIATIR_STUDY_RUN: '1', UV_NO_CACHE: '1', OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1', NUMBA_NUM_THREADS: '1', JAX_PLATFORMS: 'cpu', PYTHONHASHSEED: '23',
    LIATIR_AI_FORCE_CPU: '1', ACCELERATE_USE_CPU: 'true',
  },
});
// Keep the host awake only for the lifetime of this explicitly requested study.
if (process.platform === 'darwin') spawn('/usr/bin/caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore' });
const seen = new Set();
let watcher;
child.once('exit', (code) => { watcher?.close(); process.exitCode = code ?? 1; });
watcher = fs.watch(runsRoot, { recursive: true }, (_event, file) => {
  const normalized = file?.replaceAll('\\', '/');
  if (!/^[a-f0-9-]{36}\/output\/(datasets|runs|stages)\//i.test(normalized ?? '')) return;
  // Some macOS filesystem events arrive only when an open log is closed.
  // Atomic monitor records also signal a chance to consume newly flushed logs.
  const progressLog = normalized?.endsWith('/logs/stderr.log') ? path.join(runsRoot, file)
    : /\/(geneformer|scgpt)\/resource-monitor\.json$/.test(normalized ?? '')
      ? path.join(runsRoot, path.dirname(file), 'logs/stderr.log') : null;
  if (progressLog) {
    try {
      const monitor = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(progressLog)), 'resource-monitor.json'), 'utf8'));
      if (monitor.status !== 'monitoring') return;
      for (const line of fs.readFileSync(progressLog, 'utf8').split('\n')) {
        if (/^(Geneformer|scGPT): \d+\/\d+ cells$/.test(line) && !seen.has(`${progressLog}:${line}`)) {
          seen.add(`${progressLog}:${line}`);
          console.log(line);
        }
      }
    } catch { /* Another event retries an incomplete log write. */ }
  }
  if (!file || !/\/(provenance|metrics|telemetry|manifest)\.json$/.test(file) || seen.has(file)) return;
  const full = path.join(runsRoot, file);
  try {
    const record = JSON.parse(fs.readFileSync(full, 'utf8'));
    seen.add(file);
    console.log(`Artifact ready: ${file} (${record.status ?? record.dataset ?? 'measured'})`);
  } catch { /* The write may not be complete; its next filesystem event will retry. */ }
});
