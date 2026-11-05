#!/usr/bin/env node

/**
 * Validate the GNINA box the way a consumer runs it: GNINA's official binary placed as the installer
 * places it and verified by Scrollcase, GNINA's own regression checks, GPU-CPU agreement, and the
 * exact product runner on Liatir's own docking output for 1IEP.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release as osRelease, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { builderVersionFields } from 'scrollcase/build';
import { attachExtractedBox, verifyExtractedPayload } from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_REVISION = 'gnina-1.3.3+6fe1ce2bb9c3+binary-3340c1f49cd3';
const COMPONENT_ID = 'gnina-pose-rescoring';
const GNINA_BUILD = 'gnina v1.3.3 master:6fe1ce2';
const BINARY_PATH = 'gnina/bin/gnina';
const PRELOADED_LIBRARIES = ['libstdc++.so.6', 'libgcc_s.so.1', 'libcudart.so.12', 'libcublasLt.so.12', 'libcublas.so.12',
  'libcufft.so.11', 'libcusparse.so.12', 'libcusolver.so.11', 'libcudnn.so.9'];
// GNINA's test_cnn.py holds GPU and CPU results to numpy's assert_array_almost_equal(..., 3): |a - b| < 1.5e-3.
const GPU_CPU_TOLERANCE = 1.5e-3;
// The redocking success criterion of Vina 1.2 and GNINA's evaluations, as the docking validator applies it.
const REDOCKING_RMSD_ANGSTROM = 2.0;
// Upstream test_cnn.py docks with every core; both runs here use the same four, so the search is identical.
const DOCKING_CPU = 4;
const FIXTURES = join(ROOT, 'runtime-boxes/fixtures/gnina');

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'gnina-linux-x86_64-cuda12.8',
    runtimeDirectoryEnvironment: 'LIATIR_GNINA_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
assert.equal(recipe.target.accelerator, 'cuda');
const binaryAsset = recipe.assets.find((asset) => asset.relativePath === BINARY_PATH);
assert.ok(binaryAsset && binaryAsset.embed === false && binaryAsset.executable === true, 'The scroll must defer the GNINA binary');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-gnina-validation-'));
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
// A copy of the release asset already on disk; without one, it is fetched from GNINA's release as the installer fetches it.
const binarySource = pathOption('--gnina-binary');
assert.equal(Boolean(releasePath), Boolean(publicPath), '--release-document and --public-key are required together');
const measurementPath = join(ROOT, 'scripts/runtime-box/measure-python.py');
const libraryDir = join(runtimeDir, 'venv/lib');
const gnina = join(runtimeDir, BINARY_PATH);
const reference = join(runtimeDir, 'reference');
const samples = [];
const cases = [];

function fileSha256(path) {
  return new Promise((resolveDigest, reject) => {
    const digest = createHash('sha256');
    createReadStream(path).on('data', (chunk) => digest.update(chunk)).on('error', reject)
      .on('end', () => resolveDigest(digest.digest('hex')));
  });
}

function spawnCollect(command, args, { cwd, env, input = null, timeoutMs = 3_600_000 }) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timeout); resolveResult({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/** GNINA started directly, as the runner starts it: box libraries preloaded, from an empty directory. */
async function runGnina(args, extraEnv = {}) {
  const scratch = await mkdtemp(join(workDir, 'gnina-'));
  const empty = join(scratch, 'cwd');
  await mkdir(empty);
  const env = { ...process.env, HOME: home, LD_PRELOAD: PRELOADED_LIBRARIES.map((name) => join(libraryDir, name)).join(' '),
    LD_LIBRARY_PATH: libraryDir, CUDA_CACHE_PATH: join(scratch, 'nv-cache'), ...extraEnv };
  const result = await spawnCollect('nice', ['-n', '10', gnina, ...args], { cwd: empty, env });
  assert.equal(result.code, 0, `gnina ${args.join(' ')} failed:\n${result.stdout.slice(-2000)}${result.stderr.slice(-2000)}`);
  assert.deepEqual(await readdir(empty), [], 'GNINA wrote into its working directory');
  return result.stdout + result.stderr;
}

// test_gnina.py's get_scores: the first Affinity and CNNaffinity GNINA prints.
function scores(output) {
  const affinity = output.match(/Affinity: (\S+)/u);
  const cnn = output.match(/CNNaffinity: (\S+)/u);
  return { affinity: Number(affinity?.[1]), cnnAffinity: Number(cnn?.[1]) };
}

// test_cnn.py's getscores: (affinity, CNN pose score, CNN affinity) of every docked mode.
function dockedModes(output) {
  return [...output.matchAll(/^\s*\d+\s+(\S+)\s+\S+\s+(\S+)\s+(\S+)/gmu)].map((match) => match.slice(1, 4).map(Number));
}

/** SD data items per record, read the way the runner reads them. */
function sdfProperties(text) {
  return text.split(/^\$\$\$\$\r?$/mu).filter((record) => record.trim()).map((record) => {
    const lines = record.split(/\r?\n/u);
    const values = {};
    lines.forEach((line, index) => {
      const match = line.match(/^>.*<([^>]+)>/u);
      if (match && index + 1 < lines.length) values[match[1]] = lines[index + 1].trim();
    });
    return values;
  });
}

function execute(script, payload, { measured = true, env = {}, timeoutMs = 3_600_000 } = {}) {
  const args = measured ? [measurementPath, '--accelerator', 'cuda', '--process-tree', script] : ['-I', script];
  return spawnCollect(python, args, { cwd: workDir, env: { ...process.env, HOME: home, ...env }, input: JSON.stringify(payload),
    timeoutMs }).then((result) => {
    const marker = result.stderr.split(/\r?\n/u).findLast((line) => line.startsWith('LIATIR_SCIENTIFIC_MEASUREMENT '));
    return { ...result, measurement: marker ? JSON.parse(marker.slice('LIATIR_SCIENTIFIC_MEASUREMENT '.length)) : null };
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
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) =>
    [names[index], names[index] === 'ligand' ? value : Number(value)])));
}

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
    // The signed release names exactly one on-demand asset: GNINA, at its own release URL.
    assert.deepEqual(release.assets, [{ url: binaryAsset.url, relativePath: BINARY_PATH, sizeBytes: binaryAsset.sizeBytes,
      sha256: binaryAsset.sha256, executable: true }]);
    await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
    runtimeEvidence = { kind: 'signed-payload', signedPayloadVerified: true,
      releaseManifestSha256: sha256(signedBytes), archiveSha256: release.archive.sha256,
      payloadDigestSha256: release.payloadDigest.sha256, provenance: release.provenance, onDemandAssets: release.assets };
  }

  // 1. GNINA placed as the installer places it, then verified by Scrollcase as the app verifies it.
  await mkdir(dirname(gnina), { recursive: true });
  if (binarySource) {
    await copyFile(binarySource, gnina);
  } else {
    const response = await fetch(binaryAsset.url, { redirect: 'follow' });
    assert.ok(response.ok && response.body, `GNINA download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(gnina));
  }
  await chmod(gnina, 0o755);
  if (releasePath) await attachExtractedBox(releasePath, { publicPath, root: runtimeDir });
  else assert.equal(await fileSha256(gnina), binaryAsset.sha256, 'The GNINA binary is not the release asset');
  const selfTest = await spawnCollect(python, ['-I', '-c', recipe.selfTest.code], { cwd: runtimeDir,
    env: { ...process.env, HOME: home } });
  assert.equal(selfTest.code, 0, `Box self-test failed:\n${selfTest.stdout}${selfTest.stderr}`);
  assert.ok(selfTest.stdout.includes(`GNINA self-test passed: ${GNINA_BUILD}`), selfTest.stdout);
  cases.push({ id: 'installed-self-test', output: selfTest.stdout.trim() });

  // 2. GNINA's own regression checks, test/gnina/test_gnina.py at the v1.3.3 commit.
  const data = (name) => join(reference, 'gnina-tests', name);
  const version = await runGnina(['--version']);
  assert.ok(version.includes(GNINA_BUILD), version);
  const noelem = scores(await runGnina(['-r', data('noelem_rec.pdb'), '-l', data('noelem.sdf'), '--score_only']));
  assert.ok(noelem.affinity < -8 && noelem.cnnAffinity > 5, `noelem: ${JSON.stringify(noelem)}`);
  const vinardo = scores(await runGnina(['-r', data('noelem_rec.pdb'), '-l', data('noelem.sdf'), '--score_only',
    '--scoring', 'vinardo']));
  assert.ok(vinardo.affinity < -8 && vinardo.cnnAffinity > 5, `noelem vinardo: ${JSON.stringify(vinardo)}`);
  const rod = ['-r', data('3rod_rec.pdb'), '-l', data('3rod_lig.pdb'), '--score_only'];
  const rodDefault = scores(await runGnina(rod));
  const rodModels = {};
  for (const model of ['fast', 'default1.0']) {
    const other = scores(await runGnina([...rod, '--cnn', model]));
    assert.equal(other.affinity, rodDefault.affinity, `3rod ${model}: the Vina term must not depend on the CNN`);
    assert.notEqual(other.cnnAffinity, rodDefault.cnnAffinity, `3rod ${model}: a different model gave the same CNN affinity`);
    assert.ok(Math.abs(other.cnnAffinity - rodDefault.cnnAffinity) < 1, `3rod ${model}: models disagree by 1 pK or more`);
    rodModels[model] = other;
  }
  cases.push({ id: 'upstream-test-gnina', noelem, vinardo, rodDefault, rodModels });

  // 3. GPU against CPU, test/gnina/test_cnn.py: the same seeded docking of 184l with and without the GPU.
  const dock = ['-r', data('184l_rec.pdb'), '-l', data('184l_lig.sdf'), '--autobox_ligand', data('184l_lig.sdf'), '--seed', '2',
    '--num_modes=10', '--cpu', String(DOCKING_CPU)];
  const gpuModes = dockedModes(await runGnina(dock));
  const cpuModes = dockedModes(await runGnina([...dock, '--no_gpu']));
  assert.ok(gpuModes.length >= 2 && gpuModes.length === cpuModes.length, `184l modes: ${gpuModes.length} GPU, ${cpuModes.length} CPU`);
  let dockingWorst = 0;
  gpuModes.forEach((mode, index) => {
    if (index > 0) assert.ok(gpuModes[index - 1][1] >= mode[1], '184l GPU modes are not sorted by CNN pose score');
    mode.forEach((value, column) => { dockingWorst = Math.max(dockingWorst, Math.abs(value - cpuModes[index][column])); });
  });
  assert.ok(dockingWorst < GPU_CPU_TOLERANCE, `184l GPU and CPU differ by ${dockingWorst}`);
  cases.push({ id: 'upstream-test-cnn-gpu-cpu', modes: gpuModes.length, maxAbsoluteDifference: dockingWorst,
    gpuModes, cpuModes });

  // 4. The product runner on Liatir Molecular Docking output.
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/gnina/python-scripts/gnina.ts'), 'utf8');
  const prefix = 'export const GNINA_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product GNINA script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-gnina.py');
  await writeFile(productPath, productRunner);
  const provenance = JSON.parse(await readFile(join(FIXTURES, 'provenance.json'), 'utf8'));
  const receptorPdbqt = join(reference, 'vina-1iep/1iep_receptor.pdbqt');
  assert.equal(await fileSha256(receptorPdbqt), provenance.receptorPdbqtSha256);
  for (const [name, entry] of Object.entries(provenance.fixtures)) {
    assert.equal(sha256(await readFile(join(FIXTURES, name))), entry.sha256, `${name} changed`);
  }
  const base = { runtimeBoxRelease: recipe.version, targetId };

  async function productCase(id, posesSdf) {
    const payload = { ...base, posesSdf, receptorPdbqt, outputDir: join(workDir, id) };
    const metrics = parseResult(await execute(productPath, { ...payload, action: 'preflight-rescore-poses' }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action: 'rescore-poses', measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.gnina-result');
    assert.equal(result.summary.networkAccess, false);
    assert.equal(result.summary.runtimeId, recipe.labels.runtime);
    assert.equal(result.summary.versions.build, GNINA_BUILD);
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    assert.deepEqual(measurement.processTreeMeasurementErrors, []);
    assert.deepEqual(measurement.vramMeasurementErrors, []);
    assert.ok(measurement.peakVramBytes > 0, `${id}: no measured GPU memory`);
    // The runner's own reading of its GPU, held to the measuring process's separate nvidia-smi query,
    // and the CUDA runtime GNINA ran on, read from the box's libcudart: the target's CUDA, as measured.
    assert.equal(result.summary.device.name, measurement.gpuName, `${id} GPU`);
    assert.equal(result.summary.device.computeCapability, measurement.gpuComputeCapability, `${id} compute capability`);
    assert.equal(result.summary.device.reportedCudaCompatibility, recipe.target.cudaVersion, `${id} CUDA runtime`);
    assert.ok(result.summary.device.peakVramBytes > 0, `${id} reported no VRAM peak of its own`);
    assert.equal(result.summary.device.vramMeasurementMethod, 'device-wide-delta');
    // GNINA runs as a child of the runner: the envelope keeps the whole tree.
    const peakRamBytes = Math.max(measurement.peakRamBytes, measurement.peakProcessTreePssBytes ?? 0);
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes, peakVramBytes: measurement.peakVramBytes, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics: { workloadId: metrics.workloadId, tokenCount: metrics.tokenCount, atomCount: metrics.atomCount,
      stepCount: metrics.stepCount, outputItemCount: metrics.outputItemCount }, measurement: { ...measurement, peakRamBytes },
    outputBytes, device: result.summary.device, ligands: result.summary.ligands });
    console.error(`gnina ${id}: passed`);
    return { result, rows: csvRows(await readFile(result.paths.scoresCsv, 'utf8')) };
  }

  async function refused(id, input, message, env = {}) {
    const execution = await execute(productPath, { ...base, receptorPdbqt, ...input, action: 'rescore-poses',
      measurementMode: true, outputDir: join(workDir, id) }, { measured: false, env, timeoutMs: 600_000 });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr.slice(-3000)}`);
    cases.push({ id, rejected: true, message });
    console.error(`gnina ${id}: refused as expected`);
  }

  const rmsdOf = (fixture) => new Map(provenance.fixtures[fixture].poseRows
    .map((row) => [`${row.ligand}#${row.poseRank}`, row.rmsdToCrystalAngstrom]));
  const redockingPoses = join(FIXTURES, '1iep-redocking-poses.sdf');
  const screenPoses = join(FIXTURES, '1iep-screen-poses.sdf');
  const redocking = {};
  for (const [id, poses, fixture] of [['1iep-redocking', redockingPoses, '1iep-redocking-poses.sdf'],
    ['1iep-screen', screenPoses, '1iep-screen-poses.sdf']]) {
    const { result, rows } = await productCase(id, poses);
    const rmsd = rmsdOf(fixture);
    assert.equal(rows.length, provenance.fixtures[fixture].poses, `${id}: every pose is rescored`);
    // Every pose comes back in docking order, with docking's own Vina score, and its rescored record keeps
    // docking's record byte for byte ahead of the values GNINA added.
    const input = (await readFile(poses, 'utf8')).split(/^\$\$\$\$\r?\n/mu).filter((record) => record.trim());
    const output = (await readFile(result.paths.rescoredPosesSdf, 'utf8')).split(/^\$\$\$\$\r?\n/mu).filter((record) => record.trim());
    assert.equal(output.length, input.length);
    output.forEach((record, index) => assert.ok(record.startsWith(input[index].replace(/\n+$/u, '\n')),
      `${id}: rescored pose ${index + 1} is not docking's record`));
    provenance.fixtures[fixture].poseRows.forEach((pose, index) => {
      assert.equal(rows[index].ligand, pose.ligand);
      assert.equal(rows[index].poseRank, pose.poseRank);
      assert.equal(rows[index].vinaScoreKcalPerMol, pose.vinaScoreKcalPerMol);
    });
    // Score extraction: the runner reports exactly what GNINA wrote for the same command.
    const direct = join(workDir, `${id}-direct.sdf`);
    await runGnina(['--receptor', receptorPdbqt, '--ligand', poses, '--score_only', '--cnn_scoring', 'rescore', '--device', '0',
      '--out', direct]);
    const directValues = sdfProperties(await readFile(direct, 'utf8'));
    rows.forEach((row, index) => {
      assert.equal(row.gninaVinaScoreKcalPerMol, Number(directValues[index].minimizedAffinity), `${id} Vina term ${index + 1}`);
      assert.equal(row.cnnPoseScore, Number(directValues[index].CNNscore), `${id} CNN score ${index + 1}`);
      assert.equal(row.cnnAffinityPk, Number(directValues[index].CNNaffinity), `${id} CNN affinity ${index + 1}`);
    });
    // The same poses on the CPU, held to the upstream GPU-CPU tolerance; the Vina term is identical.
    const cpu = join(workDir, `${id}-cpu.sdf`);
    await runGnina(['--receptor', receptorPdbqt, '--ligand', poses, '--score_only', '--cnn_scoring', 'rescore', '--no_gpu',
      '--out', cpu]);
    const cpuValues = sdfProperties(await readFile(cpu, 'utf8'));
    let rescoringWorst = 0;
    rows.forEach((row, index) => {
      assert.equal(row.gninaVinaScoreKcalPerMol, Number(cpuValues[index].minimizedAffinity), `${id} CPU Vina term ${index + 1}`);
      rescoringWorst = Math.max(rescoringWorst, Math.abs(row.cnnPoseScore - Number(cpuValues[index].CNNscore)),
        Math.abs(row.cnnAffinityPk - Number(cpuValues[index].CNNaffinity)));
    });
    assert.ok(rescoringWorst < GPU_CPU_TOLERANCE, `${id}: GPU and CPU rescoring differ by ${rescoringWorst}`);
    // Redocking success: for imatinib, the pose GNINA ranks first lies within 2 Å of the crystal ligand.
    const imatinib = result.summary.ligands.filter((item) => rmsd.get(`${item.ligand}#1`) !== null);
    assert.ok(imatinib.length >= 1, `${id}: no imatinib ligand`);
    const perLigand = imatinib.map((item) => {
      const topRmsd = rmsd.get(`${item.ligand}#${item.bestCnnPoseRank}`);
      assert.ok(topRmsd <= REDOCKING_RMSD_ANGSTROM, `${id}: GNINA's top ${item.ligand} pose is ${topRmsd} Å from the crystal`);
      return { ligand: item.ligand, gninaTopPoseRank: item.bestCnnPoseRank, gninaTopPoseRmsdAngstrom: topRmsd,
        vinaTopPoseRmsdAngstrom: rmsd.get(`${item.ligand}#1`),
        correctPosesRankedBelowIncorrect: rows.filter((row) => row.ligand === item.ligand).some((low) =>
          rmsd.get(`${low.ligand}#${low.poseRank}`) <= REDOCKING_RMSD_ANGSTROM
          && rows.some((high) => high.ligand === item.ligand && high.cnnRank < low.cnnRank
            && rmsd.get(`${high.ligand}#${high.poseRank}`) > REDOCKING_RMSD_ANGSTROM)) };
    });
    const top = rows.find((row) => row.poseRank === 1 && rmsd.get(`${row.ligand}#1`) !== null);
    redocking[id] = { perLigand, gpuCpuMaxAbsoluteDifference: rescoringWorst,
      vinaTermOnVinaTopPose: { vina: top.vinaScoreKcalPerMol, gnina: top.gninaVinaScoreKcalPerMol },
      agreeing: result.summary.agreeing, ligands: result.summary.ligands.length };
  }

  // 5. The same input twice on the GPU: measured, and held to the GPU-CPU tolerance rather than assumed exact.
  const again = await productCase('1iep-screen-repeat', screenPoses);
  const first = csvRows(await readFile(join(workDir, '1iep-screen/rescoring-scores.csv'), 'utf8'));
  let repeatWorst = 0;
  again.rows.forEach((row, index) => {
    for (const key of ['gninaVinaScoreKcalPerMol', 'cnnPoseScore', 'cnnAffinityPk', 'cnnAffinityVariance']) {
      repeatWorst = Math.max(repeatWorst, Math.abs(row[key] - first[index][key]));
    }
  });
  assert.ok(repeatWorst < GPU_CPU_TOLERANCE, `Two GPU runs differ by ${repeatWorst}`);
  const repeatIdentical = sha256(await readFile(again.result.paths.scoresCsv))
    === sha256(await readFile(join(workDir, '1iep-screen/rescoring-scores.csv')));

  // 6. Nothing is compiled for the GPU at run time: with the driver's PTX JIT disabled the run gives the
  // same scores, so which drivers can run it depends on the compiled GPU code alone.
  const noJit = parseResult(await execute(productPath, { ...base, posesSdf: screenPoses, receptorPdbqt, action: 'rescore-poses',
    measurementMode: true, outputDir: join(workDir, 'no-ptx-jit') }, { measured: false, env: { CUDA_DISABLE_PTX_JIT: '1' } }),
  'no-ptx-jit');
  const noJitRows = csvRows(await readFile(noJit.paths.scoresCsv, 'utf8'));
  let noJitWorst = 0;
  noJitRows.forEach((row, index) => {
    for (const key of ['gninaVinaScoreKcalPerMol', 'cnnPoseScore', 'cnnAffinityPk']) {
      noJitWorst = Math.max(noJitWorst, Math.abs(row[key] - first[index][key]));
    }
  });
  assert.ok(noJitWorst < GPU_CPU_TOLERANCE, `With PTX JIT disabled the scores differ by ${noJitWorst}`);
  cases.push({ id: 'no-ptx-jit', poses: noJitRows.length, maxAbsoluteDifference: noJitWorst });

  // 7. Unusable inputs are refused before GNINA runs, with an actionable message.
  const redockingText = await readFile(redockingPoses, 'utf8');
  const otherReceptor = join(workDir, 'other-receptor.pdbqt');
  await writeFile(otherReceptor, `REMARK  a different receptor file\n${await readFile(receptorPdbqt, 'utf8')}`);
  await refused('other-receptor', { posesSdf: redockingPoses, receptorPdbqt: otherReceptor }, 'were not docked into this receptor PDBQT');
  await refused('not-liatir-poses', { posesSdf: data('184l_lig.sdf') }, "does not come from Liatir's Molecular Docking");
  const unrecorded = join(workDir, 'unrecorded.sdf');
  await writeFile(unrecorded, redockingText.replace(/^>.*<liatir_receptor_pdbqt_sha256>.*\r?\n.*\r?\n\r?\n/gmu, ''));
  await refused('receptor-not-recorded', { posesSdf: unrecorded }, 'do not record the receptor');
  const doubled = join(workDir, 'doubled.sdf');
  await writeFile(doubled, redockingText + redockingText);
  await refused('pose-twice', { posesSdf: doubled }, 'twice');
  await refused('receptor-not-pdbqt', { posesSdf: redockingPoses, receptorPdbqt: data('184l_rec.pdb') }, 'must use one of these formats');
  await refused('no-gpu-visible', { posesSdf: redockingPoses }, 'reports no usable GPU', { CUDA_VISIBLE_DEVICES: '' });
  const unmeasured = await execute(productPath, { ...base, posesSdf: redockingPoses, receptorPdbqt, action: 'rescore-poses',
    outputDir: join(workDir, 'unmeasured') }, { measured: false });
  assert.notEqual(unmeasured.code, 0);
  assert.ok(unmeasured.stderr.includes('A measured hardware preflight must accept'), unmeasured.stderr.slice(-1500));
  cases.push({ id: 'no-measured-preflight', rejected: true });

  // 8. Nothing was written outside the run: not into the payload, not into the user's home.
  assert.deepEqual(await readdir(home), [], 'The runner wrote into the home directory');
  if (releasePath) await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
  cases.push({ id: 'nothing-written-outside-the-run', homeEmpty: true, signedPayloadReverified: Boolean(releasePath) });

  const cudaRuntimes = [...new Set(cases.filter((item) => item.device).map((item) => item.device.reportedCudaCompatibility))];
  assert.deepEqual(cudaRuntimes, [recipe.target.cudaVersion], 'Every run reports the target CUDA runtime');
  const measured = (field) => {
    const values = [...new Set(cases.filter((item) => item.measurement).map((item) => item.measurement[field]))];
    assert.equal(values.length, 1, `Measurements disagree on ${field}`);
    return values[0];
  };
  const validation = { schemaVersion: 1, kind: 'liatir.gnina-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: {
      upstreamTests: 'test/gnina/test_gnina.py and test_cnn.py at gnina 6fe1ce2bb9c35c8067de9f49bb9169857dfbad70',
      gpuCpuTolerance: GPU_CPU_TOLERANCE, redockingRmsdAngstrom: REDOCKING_RMSD_ANGSTROM,
      dockingGpuCpuMaxAbsoluteDifference: dockingWorst, redocking,
      repeat: { identical: repeatIdentical, maxAbsoluteDifference: repeatWorst },
      noPtxJit: { maxAbsoluteDifference: noJitWorst },
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
      // The fixture's provenance names every pose file and the receptor by SHA-256.
      fixture: { id: 'liatir-molecular-docking-1iep-poses', sha256: sha256(await readFile(join(FIXTURES, 'provenance.json'))),
        receptorPdbqtSha256: provenance.receptorPdbqtSha256 },
      framework: { name: 'gnina', version: '1.3.3', build: GNINA_BUILD, backend: 'cuda', binarySha256: binaryAsset.sha256 },
      accelerator: { kind: 'cuda', gpuModel: measured('gpuName'), gpuMemoryBytes: measured('gpuMemoryBytes'),
        computeCapability: measured('gpuComputeCapability'), driverVersion: measured('gpuDriverVersion'),
        vramMeasurementMethod: measured('vramMeasurementMethod'),
        reportedCudaCompatibility: cudaRuntimes[0] },
      tolerances: { absolute: GPU_CPU_TOLERANCE, relative: 0 },
      // The CPU baseline is GNINA itself without the GPU (--no_gpu), held to test_cnn.py's tolerance.
      parity: { reference: 'GNINA 1.3.3 --no_gpu: test_cnn.py 184l docking and the 1IEP rescorings', passed: true,
        cpuBaselinePassed: true, acceleratorPassed: true,
        maximumAbsoluteDifference: Math.max(dockingWorst, ...Object.values(redocking).map((item) => item.gpuCpuMaxAbsoluteDifference)),
        meanAbsoluteDifference: null, minimumCosineSimilarity: null },
      finiteValues: true,
      peakRamBytes: Math.max(...samples.map((sample) => sample.peakRamBytes)),
      peakVramBytes: Math.max(...samples.map((sample) => sample.peakVramBytes)),
      outputContract: 'passed', provenanceContract: 'passed',
    },
  };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(validation, null, 2) + '\n');
  console.log(JSON.stringify(validation, null, 2));
} finally {
  if (keep) console.error(`Preserved GNINA validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
