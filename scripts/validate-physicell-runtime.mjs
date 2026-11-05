#!/usr/bin/env node

/** Exercise the exact offline PhysiCell runner against invariants that follow from its models' own parameters. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { builderVersionFields } from 'scrollcase/build';
import { verifyExtractedPayload } from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REVISION = 'physicell-1.14.2+2dd954ad781f';
const COMPONENT_ID = 'physicell-multicellular-simulation';
// PhysiCell draws a stochastic phase exit or death once per phenotype step dt with probability rate * dt.
const PHENOTYPE_STEP = 6;
const PROBABILITY = PHENOTYPE_STEP / 600;
// A Galton-Watson process: each step every cell divides with probability p, so the mean grows by m = 1 + p
// per step and Var N_k = N_0 (1 - p) m^(k-1) (m^k - 1).
function growthBound(initial, steps) {
  const m = 1 + PROBABILITY;
  const mean = initial * m ** steps;
  const sd = Math.sqrt(initial * (1 - PROBABILITY) * m ** (steps - 1) * (m ** steps - 1));
  return { mean, sd };
}
// Survival to step k is binomial with q = (1 - p)^k.
function survivalBound(initial, steps) {
  const q = (1 - PROBABILITY) ** steps;
  return { mean: initial * q, sd: Math.sqrt(initial * q * (1 - q)) };
}
// BioFVM integrates decay implicitly; a uniform field follows e^(-lambda t) to well within this.
const DECAY_RATE = 0.001;
const DECAY_TOLERANCE = 1e-4;

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'physicell-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_PHYSICELL_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-physicell-validation-'));
const home = join(workDir, 'home');
await mkdir(home);
const keep = process.argv.includes('--keep-work-dir');
function pathOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path`);
  return resolve(value);
}
const outputPath = pathOption('--output');
const releasePath = pathOption('--release-document');
const publicPath = pathOption('--public-key');
assert.equal(Boolean(releasePath), Boolean(publicPath), '--release-document and --public-key are required together');
const measurementPath = join(ROOT, 'scripts/runtime-box/measure-python.py');
const samples = [];
const cases = [];

function execute(script, payload, { measured = true, timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const args = measured ? [measurementPath, '--accelerator', 'cpu', '--process-tree', script] : ['-I', script];
    const child = spawn(python, args, { cwd: workDir, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      const marker = stderr.split(/\r?\n/u).findLast((line) => line.startsWith('LIATIR_SCIENTIFIC_MEASUREMENT '));
      const measurement = marker ? JSON.parse(marker.slice('LIATIR_SCIENTIFIC_MEASUREMENT '.length)) : null;
      resolveResult({ code, signal, stdout, stderr, measurement });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function parseResult(execution, label) {
  assert.equal(execution.code, 0, `${label} failed (${execution.signal ?? execution.code}):\n${execution.stderr}`);
  const line = execution.stdout.split(/\r?\n/u).findLast((value) => value.startsWith('{'));
  assert.ok(line, `${label} emitted no structured result`);
  return JSON.parse(line);
}

function csvRows(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/u);
  const names = header.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], Number(value)])));
}

// The substrate field PhysiCell wrote last, read with the box's SciPy.
const FIELD_PROBE = String.raw`
import json, sys
import scipy.io
p = json.load(sys.stdin)
field = scipy.io.loadmat(p["path"])["multiscale_microenvironment"][4]
print(json.dumps({"min": float(field.min()), "max": float(field.max())}))
`;

try {
  let runtimeEvidence = { kind: 'development-environment', signedPayloadVerified: false };
  if (releasePath) {
    const signedBytes = await readFile(releasePath);
    const release = await verifySignedDocument(JSON.parse(signedBytes), publicPath);
    assert.equal(release.kind, 'liatir.runtime-box.release');
    assert.equal(release.boxId, recipe.boxId);
    assert.equal(release.labels.runtime, recipe.labels.runtime);
    assert.equal(release.version, recipe.version);
    assert.deepEqual(release.target, recipe.target);
    assert.equal(release.provenance.dependencyLockSha256, dependencyLockSha256);
    assert.equal(release.provenance.sourceRevision, SOURCE_REVISION);
    await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
    runtimeEvidence = { kind: 'signed-payload', signedPayloadVerified: true,
      releaseManifestSha256: sha256(signedBytes), archiveSha256: release.archive.sha256,
      payloadDigestSha256: release.payloadDigest.sha256, provenance: release.provenance };
  }
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/physicell/python-scripts/physicell.ts'), 'utf8');
  const prefix = 'export const PHYSICELL_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product PhysiCell script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-physicell.py');
  const fixturePath = join(workDir, 'fixtures.py');
  const probePath = join(workDir, 'field-probe.py');
  await writeFile(productPath, productRunner);
  await writeFile(fixturePath, await readFile(join(ROOT, 'runtime-boxes/fixtures/physicell/fixtures.py'), 'utf8'));
  await writeFile(probePath, FIELD_PROBE);
  const marker = join(workDir, 'shell-marker');
  const fixtures = parseResult(await execute(fixturePath, { template: join(runtimeDir, 'physicell/config/PhysiCell_settings.xml'),
    workDir, marker }, { measured: false }), 'fixtures');
  const base = { runtimeBoxRelease: recipe.version, targetId };

  async function productCase(id, input) {
    const payload = { ...base, ...input, outputDir: join(workDir, id) };
    const metrics = parseResult(await execute(productPath, { ...payload, action: 'preflight-physicell' }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action: 'simulate-physicell', measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.physicell-result');
    assert.equal(result.summary.networkAccess, false);
    assert.equal(result.summary.runtimeId, recipe.labels.runtime);
    assert.equal(result.summary.versions.physicell, '1.14.2');
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    assert.deepEqual(measurement.processTreeMeasurementErrors, []);
    // PhysiCell runs as a child of the runner: the envelope keeps the whole tree.
    const peakRamBytes = Math.max(measurement.peakRamBytes, measurement.peakProcessTreePssBytes ?? 0);
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes, peakVramBytes: null, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics: { workloadId: metrics.workloadId, tokenCount: metrics.tokenCount, atomCount: metrics.atomCount,
      stepCount: metrics.stepCount, outputItemCount: metrics.outputItemCount }, measurement: { ...measurement, peakRamBytes },
    outputBytes, final: result.summary.final });
    console.error(`physicell ${id}: passed`);
    return result;
  }

  async function refused(id, input, message) {
    const execution = await execute(productPath, { ...base, ...input, action: 'simulate-physicell', measurementMode: true,
      outputDir: join(workDir, id) }, { measured: false, timeoutMs: 600_000 });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr.slice(-3000)}`);
    cases.push({ id, rejected: true, message });
    console.error(`physicell ${id}: refused as expected`);
  }

  const settings = (name, physicell = {}) => ({ source: 'settings', settings: fixtures[name], physicell: { seed: 3, ...physicell } });

  // 1. PhysiCell's template as it ships, and its seeded single-thread run repeated.
  const template = await productCase('template', { source: 'builtin', physicell: { seed: 1 } });
  assert.ok(template.summary.final.default.live >= 5, 'The template lost its cells');
  const repeat = await productCase('template-repeat', { source: 'builtin', physicell: { seed: 1 } });
  for (const key of ['finalCellsCsv', 'populationCsv', 'substratesCsv']) {
    assert.equal(sha256(await readFile(repeat.paths[key])), sha256(await readFile(template.paths[key])),
      `The same seed on one thread did not repeat ${key}`);
  }
  const otherSeed = await productCase('template-other-seed', { source: 'builtin', physicell: { seed: 2 } });
  assert.notEqual(sha256(await readFile(otherSeed.paths.finalCellsCsv)), sha256(await readFile(template.paths.finalCellsCsv)),
    'A different seed gave the same cells');

  // 2. Fixed 600-minute cycles: the population doubles exactly at every multiple of 600 minutes.
  const doubling = await productCase('fixed-cycle-doubling', settings('doubling'));
  const doublingRows = csvRows(await readFile(doubling.paths.populationCsv, 'utf8'));
  const checkedTimes = [];
  for (const row of doublingRows) {
    const time = row['Time (min)'];
    const intoPeriod = time % 600;
    // A division lands on the phenotype step at the period's end; times next to it are not checked.
    if (intoPeriod < 2 * PHENOTYPE_STEP || intoPeriod > 600 - 2 * PHENOTYPE_STEP) continue;
    assert.equal(row['default live'], 50 * 2 ** Math.floor(time / 600), `Fixed-cycle population at ${time} min`);
    assert.equal(row['default dead'], 0);
    checkedTimes.push(time);
  }
  assert.ok(checkedTimes.length >= 30, 'Too few times between divisions were checked');

  // 3. Stochastic division at 1/600 per minute: a Galton-Watson process over 100 phenotype steps.
  const growth = await productCase('stochastic-growth', settings('exponential'));
  const grown = csvRows(await readFile(growth.paths.populationCsv, 'utf8')).at(-1)['default live'];
  const growthExpected = growthBound(1000, 100);
  // Whether the step at t = 600 precedes the last snapshot changes the mean by one step; both are admitted.
  const growthSlack = growthExpected.mean - growthBound(1000, 99).mean;
  assert.ok(Math.abs(grown - growthExpected.mean) <= 4 * growthExpected.sd + growthSlack,
    `Grown to ${grown}; expected ${growthExpected.mean.toFixed(1)} ± ${(4 * growthExpected.sd).toFixed(1)}`);

  // 4. Apoptosis at 1/600 per minute and no division: binomial survival.
  const deaths = await productCase('apoptosis-survival', settings('apoptosis'));
  const survived = csvRows(await readFile(deaths.paths.populationCsv, 'utf8')).at(-1)['default live'];
  const survivalExpected = survivalBound(1000, 100);
  const survivalSlack = survivalBound(1000, 99).mean - survivalExpected.mean;
  assert.ok(Math.abs(survived - survivalExpected.mean) <= 4 * survivalExpected.sd + survivalSlack,
    `${survived} survived; expected ${survivalExpected.mean.toFixed(1)} ± ${(4 * survivalExpected.sd).toFixed(1)}`);

  // 5. A uniform substrate decaying through BioFVM, with one cell that neither secretes nor takes it up.
  const decay = await productCase('substrate-decay', settings('substrate-decay'));
  let decayWorst = 0;
  for (const row of csvRows(await readFile(decay.paths.substratesCsv, 'utf8'))) {
    const exact = Math.exp(-DECAY_RATE * row['Time (min)']);
    decayWorst = Math.max(decayWorst, Math.abs(row['substrate mean'] - exact) / exact);
  }
  assert.ok(decayWorst <= DECAY_TOLERANCE, `Uniform decay differs from e^(-lambda t) by ${decayWorst}`);
  const field = parseResult(await execute(probePath, { path: join(workDir, 'substrate-decay/physicell/output/final_microenvironment0.mat') },
    { measured: false }), 'field probe');
  assert.ok(field.max - field.min <= 1e-12 * field.max, `The uniform field became uneven: ${field.min} to ${field.max}`);

  // 6. Shell metacharacters in the settings' paths never reach a shell.
  const hostile = await productCase('hostile-paths', { ...settings('hostile-paths'), cells: fixtures['hostile-cells'] });
  assert.equal(hostile.summary.final.default.live + hostile.summary.final.default.dead >= 2, true);
  assert.deepEqual((await readdir(workDir)).filter((name) => name.startsWith('shell-marker')), [], 'A shell command ran');
  const ran = await readFile(join(workDir, 'hostile-paths/physicell/config/PhysiCell_settings.xml'), 'utf8');
  assert.ok(ran.includes('<folder>output</folder>') && !ran.includes('touch'), 'The run settings kept a hostile path');

  // 7. Unsupported and malformed requests are refused with an actionable message.
  await refused('doctype', settings('doctype'), 'declare a document type or entities');
  await refused('intracellular', settings('intracellular'), 'attach intracellular models');
  await refused('matlab-initial-condition', settings('matlab-initial-condition'), 'from .mat files');
  await refused('too-many-voxels', settings('too-many-voxels'), 'voxels, more than');
  await refused('no-cells', settings('no-cells'), 'start no cells');
  await refused('rules-without-csv', settings('rules-without-csv'), 'enable cell rules');
  await refused('seed-overflow', { source: 'builtin', physicell: { seed: 2 ** 31 } }, 'Seed must be from');
  await refused('threads-beyond-host', { source: 'builtin', physicell: { threads: 100_000 } }, 'Threads must be from');
  await refused('unknown-source', { source: 'python' }, "PhysiCell's template or a settings file");

  // 8. Nothing was written outside the run: not into the payload, not into the user's home.
  assert.deepEqual(await readdir(home), [], 'The runner wrote into the home directory');
  if (releasePath) await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
  cases.push({ id: 'nothing-written-outside-the-run', homeEmpty: true, signedPayloadReverified: Boolean(releasePath) });

  const validation = { schemaVersion: 1, kind: 'liatir.physicell-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: {
      fixedCycleDoubling: { initialCells: 50, periodMinutes: 600, checkedTimes: checkedTimes.length },
      stochasticGrowth: { observed: grown, expected: growthExpected.mean, sd: growthExpected.sd, slack: growthSlack },
      apoptosisSurvival: { observed: survived, expected: survivalExpected.mean, sd: survivalExpected.sd, slack: survivalSlack },
      substrateDecay: { rate: DECAY_RATE, maxRelativeError: decayWorst, finalField: field },
    },
    measurementHost: { platform: platform(), arch: arch(), osRelease: osRelease(),
      cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem() },
    validatorSource: {
      gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      sourceTreeDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
      scriptSha256: sha256(await readFile(import.meta.filename)),
      measurementScriptSha256: sha256(await readFile(measurementPath)),
      recipeSha256: sha256(await readFile(recipePath)),
    },
    provenance: { recipeId: authoringId, recipeVersion: authoringVersion, pythonVersion: recipe.runtime.version,
      ...builderVersionFields(recipe), dependencyLockSha256 },
    evidence: {
      fixture: { id: 'physicell-1.14.2-template-settings',
        sha256: sha256(await readFile(join(runtimeDir, 'physicell/config/PhysiCell_settings.xml'))) },
      framework: { name: 'physicell', version: '1.14.2', backend: 'cpu' },
      accelerator: { kind: 'cpu' },
      finiteValues: true,
      peakRamBytes: Math.max(...samples.map((sample) => sample.peakRamBytes)),
      peakVramBytes: null,
      outputContract: 'passed', provenanceContract: 'passed',
    },
  };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify(validation, null, 2));
} finally {
  if (keep) console.error(`Preserved PhysiCell validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
