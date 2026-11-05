#!/usr/bin/env node

/** Exercise the exact offline PySB and BioNetGen runner against published and analytical references. */
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
const SOURCE_REVISION = 'pysb-1.17.0+bionetgen-2.9.3';
const COMPONENT_ID = 'pysb-biochemical-simulation';
// Mazzia and Magherini, Test Set for IVP Solvers (University of Bari), problem ROBER: y(1e11), computed
// in extended precision with RADAU at rtol = atol = 1.1e-18.
const ROBERTSON_REFERENCE = { A_total: 0.2083340149701255e-07, B_total: 0.8333360770334713e-13, C_total: 0.9999999791665050 };
const ROBERTSON_RELATIVE_TOLERANCE = 1e-6;
// synth_deg: A is made at kA_syn and removed at kA_deg * A, so A(t) = s/d + (A0 - s/d) e^(-d t) and the
// stationary copy number is Poisson with mean and variance s/d.
const SYNTHESIS = { kA_syn: 2, kA_deg: 0.1, A0: 1 };
const STATIONARY_MEAN = 10;
const SSA_RUNS = 1000;
// Four standard errors: of the mean, sqrt(10 / n); of the variance of a Poisson(10) sample,
// sqrt((mu4 - sigma^4 (n - 3) / (n - 1)) / n) with mu4 = 3 * 10^2 + 10.
const SSA_MEAN_BOUND = 4 * Math.sqrt(STATIONARY_MEAN / SSA_RUNS);
const SSA_VARIANCE_BOUND = 4 * Math.sqrt((310 - 100 * (SSA_RUNS - 3) / (SSA_RUNS - 1)) / SSA_RUNS);
// PySB's LSODA against BioNetGen's own CVODE on the same generated network.
const INTEGRATOR_AGREEMENT = 1e-5;

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'biochemical-simulation-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_BIOCHEMICAL_SIMULATION_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-biochemical-validation-'));
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
const bionetgen = join(runtimeDir, 'bionetgen-release/BioNetGen-2.9.3');
const models = join(bionetgen, 'Models2');
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
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], value])));
}

// BioNetGen's own CVODE on the network PySB generates, for the same output times.
const CVODE_REFERENCE = String.raw`
import json, os, pathlib, sys, tempfile, warnings
warnings.filterwarnings('ignore')
p = json.load(sys.stdin)
os.environ['BNGPATH'] = p['bionetgen']
os.environ['PATH'] = os.pathsep.join([str(pathlib.Path(sys.executable).parent), os.environ['PATH']])
tempfile.tempdir = p['scratch']
import numpy as np
from pysb.importers.bngl import model_from_bngl
from pysb.simulator import BngSimulator
model = model_from_bngl(p['bngl'])
result = BngSimulator(model, tspan=np.linspace(0, p['tEnd'], p['points'])).run(method='ode')
print(json.dumps({obs.name: [float(v) for v in result.observables[obs.name]] for obs in model.observables}))
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
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/biochemical-simulation/python-scripts/biochemical.ts'), 'utf8');
  const prefix = 'export const BIOCHEMICAL_SIMULATION_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product biochemical script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-biochemical.py');
  const referencePath = join(workDir, 'cvode-reference.py');
  await writeFile(productPath, productRunner);
  await writeFile(referencePath, CVODE_REFERENCE);
  const scratch = join(workDir, 'scratch');
  await mkdir(scratch);
  const base = { runtimeBoxRelease: recipe.version, targetId };

  // Inputs: a bounded BioNetGen model with actions that must never run, an unbounded polymer, a broken file.
  // BioNetGen's own TLBR model (a trivalent ligand crosslinking bivalent receptors) is written for
  // network-free simulation: its network has no end.
  const marker = join(workDir, 'action-marker');
  const repressilator = await readFile(join(models, 'Repressilator.bngl'), 'utf8');
  await writeFile(join(workDir, 'with-actions.bngl'),
    `${repressilator}\nwriteXML({prefix=>"${marker}"})\nwriteSBML({prefix=>"${marker}"})\n`);
  await writeFile(join(workDir, 'polymer.bngl'), [
    'begin model', 'begin parameters', '  kon 1e-3', '  A0 100', 'end parameters', 'begin molecule types', '  A(l,r)',
    'end molecule types', 'begin seed species', '  A(l,r) A0', 'end seed species', 'begin observables',
    '  Molecules Atot A()', 'end observables', 'begin reaction rules', '  A(r) + A(l) -> A(r!1).A(l!1) kon',
    'end reaction rules', 'end model', ''].join('\n'));
  await writeFile(join(workDir, 'broken.bngl'), repressilator.replace('->', '-?>'));

  async function productCase(id, input) {
    const payload = { ...base, ...input, outputDir: join(workDir, id) };
    const metrics = parseResult(await execute(productPath, { ...payload, action: 'preflight-network' }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action: 'simulate-network', measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.biochemical-simulation-result');
    // BioNetGen generates the same network for the preflight and for the run: the size an envelope is
    // matched on is the size that is integrated.
    assert.deepEqual(result.summary.network, metrics.network);
    assert.equal(result.summary.networkAccess, false);
    assert.equal(result.summary.runtimeId, recipe.labels.runtime);
    assert.equal(result.summary.versions.pysb, '1.17.0');
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    assert.deepEqual(measurement.processTreeMeasurementErrors, []);
    // BioNetGen runs as a Perl child and run_network as its child: the envelope keeps the whole tree.
    const peakRamBytes = Math.max(measurement.peakRamBytes, measurement.peakProcessTreePssBytes ?? 0);
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes, peakVramBytes: null, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics: { workloadId: metrics.workloadId, tokenCount: metrics.tokenCount, atomCount: metrics.atomCount,
      stepCount: metrics.stepCount, outputItemCount: metrics.outputItemCount }, measurement: { ...measurement, peakRamBytes },
    outputBytes, network: result.summary.network });
    console.error(`biochemical ${id}: passed`);
    return result;
  }

  async function refused(id, input, message) {
    const execution = await execute(productPath, { ...base, ...input, action: 'simulate-network', measurementMode: true,
      outputDir: join(workDir, id) }, { measured: false, timeoutMs: 600_000 });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr.slice(-3000)}`);
    cases.push({ id, rejected: true, message });
    console.error(`biochemical ${id}: refused as expected`);
  }

  // 1. Robertson's stiff problem against the IVP test set.
  const robertson = await productCase('robertson-ode', { source: 'builtin', builtinModel: 'robertson',
    simulation: { method: 'ode', tEnd: 1e11, points: 81, spacing: 'log', tFirst: 1e-5, rtol: 1e-10, atol: 1e-22 } });
  const robertsonErrors = Object.fromEntries(Object.entries(ROBERTSON_REFERENCE).map(([name, value]) =>
    [name, Math.abs(robertson.summary.final[name] - value) / value]));
  for (const [name, error] of Object.entries(robertsonErrors)) {
    assert.ok(error <= ROBERTSON_RELATIVE_TOLERANCE, `Robertson ${name} relative error ${error}`);
  }

  // 2. Synthesis and degradation against its exact solution, with a parameter changed.
  const synthesis = await productCase('synthesis-degradation-ode', { source: 'builtin', builtinModel: 'synth_deg',
    simulation: { method: 'ode', tEnd: 50, points: 51, parameters: [{ name: 'kA_syn', value: SYNTHESIS.kA_syn }] } });
  const steady = SYNTHESIS.kA_syn / SYNTHESIS.kA_deg;
  let analyticalWorst = 0;
  for (const row of csvRows(await readFile(synthesis.paths.observablesCsv, 'utf8'))) {
    const exact = steady + (SYNTHESIS.A0 - steady) * Math.exp(-SYNTHESIS.kA_deg * Number(row.Time));
    analyticalWorst = Math.max(analyticalWorst, Math.abs(Number(row.A_total) - exact));
  }
  assert.ok(analyticalWorst <= 1e-6, `synth_deg differs from its exact solution by ${analyticalWorst}`);

  // 3. The stochastic stationary distribution: Poisson with mean and variance 10.
  const ssa = await productCase('synthesis-degradation-ssa', { source: 'builtin', builtinModel: 'synth_deg',
    simulation: { method: 'ssa', tEnd: 200, points: 201, runs: SSA_RUNS, seed: 1234 } });
  const ssaRows = csvRows(await readFile(ssa.paths.runsCsv, 'utf8'));
  const finals = ssaRows.filter((row) => Number(row.Time) === 200).map((row) => Number(row.A_total));
  assert.equal(finals.length, SSA_RUNS);
  const mean = finals.reduce((sum, value) => sum + value, 0) / finals.length;
  const variance = finals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finals.length - 1);
  assert.ok(Math.abs(mean - STATIONARY_MEAN) <= SSA_MEAN_BOUND, `SSA mean ${mean}`);
  assert.ok(Math.abs(variance - STATIONARY_MEAN) <= SSA_VARIANCE_BOUND, `SSA variance ${variance}`);
  const repeat = await productCase('synthesis-degradation-ssa-repeat', { source: 'builtin', builtinModel: 'synth_deg',
    simulation: { method: 'ssa', tEnd: 200, points: 201, runs: SSA_RUNS, seed: 1234 } });
  assert.equal(sha256(await readFile(repeat.paths.runsCsv)), sha256(await readFile(ssa.paths.runsCsv)),
    'The same seeds did not repeat the stochastic runs');
  // Each replicate has its own seed, so their early trajectories differ (PySB's own BngSimulator gives
  // every replicate the same seed and returns identical copies).
  const earlyTrajectories = {};
  for (const row of ssaRows.filter((item) => Number(item.Time) <= 20)) {
    earlyTrajectories[row.Run] = `${earlyTrajectories[row.Run] ?? ''}${row.A_total},`;
  }
  const distinctRuns = new Set(Object.values(earlyTrajectories));
  assert.ok(distinctRuns.size > SSA_RUNS / 2, `Only ${distinctRuns.size} distinct trajectories among ${SSA_RUNS} runs`);

  // 4. BioNetGen's EGFR model: PySB's LSODA against BioNetGen's own CVODE on the same network.
  const egfr = await productCase('egfr-net-ode', { source: 'bngl', bngl: join(models, 'egfr_net.bngl'),
    simulation: { method: 'ode', tEnd: 100, points: 101 } });
  assert.deepEqual(egfr.summary.model.ignoredActions, ['generate_network', 'simulate']);
  const cvode = parseResult(await execute(referencePath, { bionetgen, scratch, bngl: join(models, 'egfr_net.bngl'), tEnd: 100,
    points: 101 }, { measured: false }), 'CVODE reference');
  const egfrRows = csvRows(await readFile(egfr.paths.observablesCsv, 'utf8'));
  let integratorWorst = 0;
  for (const [name, values] of Object.entries(cvode)) {
    const scale = Math.max(1e-12, ...values.map(Math.abs));
    values.forEach((value, index) => {
      integratorWorst = Math.max(integratorWorst, Math.abs(Number(egfrRows[index][name]) - value) / scale);
    });
  }
  assert.ok(integratorWorst <= INTEGRATOR_AGREEMENT, `LSODA and CVODE differ by ${integratorWorst}`);

  // 5. A BNGL file's actions never run.
  const actions = await productCase('bngl-actions-ignored', { source: 'bngl', bngl: join(workDir, 'with-actions.bngl'),
    simulation: { method: 'ode', tEnd: 10, points: 11 } });
  assert.ok(actions.summary.model.ignoredActions.includes('writeXML'));
  assert.deepEqual((await readdir(workDir)).filter((name) => name.startsWith('action-marker')), [],
    'An action in the BNGL file ran');

  // 6. Every reviewed built-in model generates a network.
  for (const name of ['michment', 'tyson_oscillator', 'kinase_cascade', 'earm_1_0', 'bngwiki_egfr_simple', 'schloegl']) {
    const preflight = parseResult(await execute(productPath, { ...base, action: 'preflight-network', source: 'builtin',
      builtinModel: name, simulation: { method: 'ode' } }, { measured: false }), `${name} preflight`);
    assert.ok(preflight.network.species > 0 && preflight.network.reactions > 0, `${name} generated no network`);
    cases.push({ id: `builtin-${name}`, network: preflight.network });
  }

  // 7. Unsupported, unbounded and malformed requests are refused with an actionable message. An
  // unbounded network is stopped by BioNetGen's memory or CPU limit, whichever it reaches first.
  await refused('unbounded-polymer', { source: 'bngl', bngl: join(workDir, 'polymer.bngl'),
    simulation: { method: 'ode', tEnd: 10 } }, 'needs network-free simulation');
  await refused('bionetgen-tlbr-unbounded', { source: 'bngl', bngl: join(models, 'tlbr.bngl'),
    simulation: { method: 'ode', tEnd: 10 } }, 'needs network-free simulation');
  await refused('arrhenius-rate-law', { source: 'bngl', bngl: join(models, 'catalysis.bngl'),
    simulation: { method: 'ode', tEnd: 10 } }, 'PySB cannot import this BNGL model');
  await refused('broken-bngl', { source: 'bngl', bngl: join(workDir, 'broken.bngl'), simulation: { method: 'ode', tEnd: 10 } },
    'BioNetGen could not read this BNGL model');
  await refused('unknown-builtin', { source: 'builtin', builtinModel: 'os', simulation: { method: 'ode' } },
    'The built-in model must be one of');
  await refused('unknown-parameter', { source: 'bngl', bngl: join(models, 'Repressilator.bngl'),
    simulation: { method: 'ode', parameters: [{ name: 'not_a_parameter', value: 1 }] } }, 'not in the BNGL file');
  await refused('seed-overflow', { source: 'builtin', builtinModel: 'synth_deg',
    simulation: { method: 'ssa', runs: 10, seed: 2_147_483_647 } }, 'Seed must be at most');
  await refused('log-spaced-ssa', { source: 'builtin', builtinModel: 'synth_deg',
    simulation: { method: 'ssa', spacing: 'log', tFirst: 1 } }, 'choose linear spacing');

  // 8. Nothing was written outside the run: not into the payload, not into the user's home.
  assert.deepEqual(await readdir(home), [], 'The runner wrote into the home directory');
  if (releasePath) await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
  cases.push({ id: 'nothing-written-outside-the-run', homeEmpty: true, signedPayloadReverified: Boolean(releasePath) });

  const validation = { schemaVersion: 1, kind: 'liatir.biochemical-simulation-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: { robertson: { reference: ROBERTSON_REFERENCE, relativeErrors: robertsonErrors,
      source: 'Mazzia and Magherini, Test Set for IVP Solvers, problem ROBER' },
    synthesisDegradation: { exactSolutionMaxAbsoluteError: analyticalWorst, ssaRuns: SSA_RUNS, ssaMean: mean,
      ssaVariance: variance, meanBound: SSA_MEAN_BOUND, varianceBound: SSA_VARIANCE_BOUND,
      distinctTrajectories: distinctRuns.size },
    egfrNet: { network: egfr.summary.network, lsodaAgainstCvodeMaxRelativeDifference: integratorWorst } },
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
      // The BioNetGen model the CVODE comparison reads; PySB's examples ship inside the locked wheel.
      fixture: { id: 'pysb-1.17.0-examples-and-bionetgen-2.9.3-models', sha256: sha256(await readFile(join(models, 'egfr_net.bngl'))) },
      framework: { name: 'pysb-bionetgen', version: '1.17.0+2.9.3', backend: 'cpu' },
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
  if (keep) console.error(`Preserved biochemical validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
