#!/usr/bin/env node

/** Exercise the exact offline metabolic runner against COBRApy's own published reference results. */
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
const SOURCE_REVISION = 'cobrapy-0.32.1+optlang-1.9.1+highs-1.15.1+osqp-1.1.3+glpk-5.0';
const COMPONENT_ID = 'cobrapy-metabolic-modeling';
// COBRApy's documentation ("Simulating with FBA") reports this optimum for its textbook model.
const DOCUMENTED_TEXTBOOK_GROWTH = 0.8739215069684307;
// COBRApy 0.32.1 tests/data/textbook_fva.json, compared as its test_flux_variability does (np.allclose).
const FVA_REFERENCE = { path: 'runtime-boxes/fixtures/metabolic/cobrapy-0.32.1-textbook-fva.json',
  sha256: 'cbf1767dda4f87bfdc1817d47a2b1ee34d8a6dcaa74897267e14b318c6e3c385' };
// COBRApy 0.32.1 tests/test_flux_analysis: test_essential_genes, test_essential_reactions,
// test_single_gene_deletion_fba (atol 1e-2) and test_single_reaction_deletion (atol 1e-5).
const ESSENTIAL_GENES = ['b0720', 'b1136', 'b1779', 'b2415', 'b2416', 'b2779', 'b2926'];
const ESSENTIAL_REACTIONS = ['ACONTa', 'ACONTb', 'Biomass_Ecoli_core', 'CS', 'ENO', 'EX_glc__D_e', 'EX_h_e', 'EX_nh4_e',
  'EX_pi_e', 'GAPD', 'GLCpts', 'GLNS', 'ICDHyr', 'NH4t', 'PGK', 'PGM', 'PIt2r', 'RPI'];
const GENE_DELETION_GROWTH = { b0008: 0.87, b0114: 0.80, b0116: 0.78, b2276: 0.21, b1779: 0.00 };
const REACTION_DELETION_GROWTH = { FBA: 0.70404, FBP: 0.87392, CS: 0, FUM: 0.81430, GAPD: 0, GLUDy: 0.85139 };

const { recipe, recipePath, authoringId, authoringVersion, runtimeDir, python, targetId, dependencyLockSha256 } =
  await loadRuntimeBoxValidatorContext({ root: ROOT, defaultRecipeId: 'metabolic-modeling-linux-x86_64-cpu',
    runtimeDirectoryEnvironment: 'LIATIR_METABOLIC_MODELING_RUNTIME_DIR' });
assert.equal(recipe.labels.model, COMPONENT_ID);
assert.equal(recipe.sourceRevision, SOURCE_REVISION);
assert.equal(recipe.target.accelerator, 'cpu');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workDir = await mkdtemp(join(tmpdir(), 'liatir-metabolic-validation-'));
// Every product run gets this as its home: COBRApy must not write into a user's home.
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
const data = join(runtimeDir, 'venv/lib/python3.11/site-packages/cobra/data');
const samples = [];
const cases = [];

function execute(script, payload, { measured = true, timeoutMs = 3_600_000 } = {}) {
  return new Promise((resolveResult, reject) => {
    const args = measured ? [measurementPath, '--accelerator', 'cpu', script] : ['-I', script];
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

/** RFC 4180 rows as Python's csv module writes them: reaction names carry commas and quotes. */
function csvRows(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { record.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field); records.push(record); record = []; field = '';
    } else field += char;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const [names, ...rows] = records;
  return rows.map((row) => Object.fromEntries(row.map((value, index) => [names[index], value])));
}

// Inputs derived inside the payload's own Python: the textbook model as COBRA JSON, and damaged or
// unsupported files for the refusals.
const PREPARE_FIXTURES = String.raw`
import gzip, json, os, pathlib, sys, tempfile
p = json.load(sys.stdin)
root, data = pathlib.Path(p['root']), pathlib.Path(p['data'])
os.environ['XDG_CACHE_HOME'] = tempfile.mkdtemp(dir=root)
import cobra
textbook = cobra.io.read_sbml_model(str(data / 'textbook.xml.gz'))
cobra.io.save_json_model(textbook, str(root / 'textbook.json'))
sbml = gzip.decompress((data / 'textbook.xml.gz').read_bytes())
(root / 'entities.xml').write_bytes(sbml.replace(b'?>', b'?>\n<!DOCTYPE sbml [<!ENTITY x "x">]>', 1))
compressed = (data / 'textbook.xml.gz').read_bytes()
(root / 'truncated.xml.gz').write_bytes(compressed[:len(compressed) // 2])
(root / 'not-sbml.xml').write_text('<?xml version="1.0"?><notes><note>not a model</note></notes>')
(root / 'not-a-model.json').write_text(json.dumps({'reactions': 'none'}))
genes_dropped = json.loads((root / 'textbook.json').read_text())
genes_dropped['genes'] = []
for reaction in genes_dropped['reactions']:
    reaction['gene_reaction_rule'] = ''
(root / 'no-genes.json').write_text(json.dumps(genes_dropped))
print(json.dumps({'reactions': len(textbook.reactions), 'genes': len(textbook.genes)}))
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
  const source = await readFile(join(ROOT, 'frontend/src/lib/tools/metabolic-modeling/python-scripts/metabolic.ts'), 'utf8');
  const prefix = 'export const METABOLIC_MODELING_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  assert.ok(start >= 0 && end > start, 'Product metabolic script is missing');
  const productRunner = source.slice(start + prefix.length, end);
  const productPath = join(workDir, 'product-metabolic.py');
  const fixturesPath = join(workDir, 'prepare-fixtures.py');
  await writeFile(productPath, productRunner);
  await writeFile(fixturesPath, PREPARE_FIXTURES);
  const referenceBytes = await readFile(join(ROOT, FVA_REFERENCE.path));
  assert.equal(sha256(referenceBytes), FVA_REFERENCE.sha256, 'COBRApy FVA reference changed');
  const fvaReference = JSON.parse(referenceBytes);
  const fixture = parseResult(await execute(fixturesPath, { root: workDir, data }, { measured: false }), 'Fixture preparation');
  assert.deepEqual(fixture, { reactions: 95, genes: 137 });
  const textbook = join(data, 'textbook.xml.gz');
  const genomeScale = join(data, 'iJO1366.xml.gz');
  const base = { runtimeBoxRelease: recipe.version, targetId };

  async function productCase(id, model, metabolic) {
    const payload = { ...base, model, metabolic, outputDir: join(workDir, id) };
    const metrics = parseResult(await execute(productPath, { ...payload, action: 'preflight-metabolic' }, { measured: false }),
      `${id} preflight`);
    const execution = await execute(productPath, { ...payload, action: 'analyze-metabolic', measurementMode: true });
    const result = parseResult(execution, id);
    assert.equal(result.kind, 'liatir.metabolic-modeling-result');
    assert.equal(result.summary.networkAccess, false);
    assert.equal(result.summary.runtimeId, recipe.labels.runtime);
    assert.equal(result.summary.versions.cobra, '0.32.1');
    assert.equal(result.summary.versions.highspy, '1.15.1');
    let outputBytes = 0;
    for (const path of Object.values(result.paths)) {
      const size = (await stat(path)).size;
      assert.ok(size > 0, `Missing or empty output ${path}`);
      outputBytes += size;
    }
    const measurement = execution.measurement;
    assert.ok(measurement?.peakRamBytes > 0, 'No measured OS peak memory');
    samples.push({ fixtureId: id, workloadId: metrics.workloadId, maxTokenCount: metrics.tokenCount,
      maxAtomCount: metrics.atomCount, maxStepCount: metrics.stepCount, maxOutputItemCount: metrics.outputItemCount,
      peakRamBytes: measurement.peakRamBytes, peakVramBytes: null, elapsedMs: measurement.elapsedMs, outputBytes });
    cases.push({ id, metrics: { workloadId: metrics.workloadId, tokenCount: metrics.tokenCount, atomCount: metrics.atomCount,
      stepCount: metrics.stepCount, outputItemCount: metrics.outputItemCount }, measurement, outputBytes,
    objective: result.summary.objective.value, crossCheck: result.summary.crossCheck });
    console.error(`metabolic ${id}: passed`);
    return result;
  }

  async function refused(id, model, metabolic, message) {
    const execution = await execute(productPath, { ...base, model, metabolic, action: 'analyze-metabolic',
      measurementMode: true, outputDir: join(workDir, id) }, { measured: false });
    assert.notEqual(execution.code, 0, `${id} should have been refused`);
    assert.ok(execution.stderr.includes(message), `${id}: expected "${message}" in:\n${execution.stderr}`);
    cases.push({ id, rejected: true, message });
    console.error(`metabolic ${id}: refused as expected`);
  }

  // 1. Flux balance analysis against COBRApy's documented optimum, confirmed by GLPK in the run.
  const fba = await productCase('textbook-fba', textbook, { analysis: 'fba' });
  assert.ok(Math.abs(fba.summary.objective.value - DOCUMENTED_TEXTBOOK_GROWTH) < 1e-9,
    `FBA optimum ${fba.summary.objective.value}`);
  assert.ok(fba.summary.crossCheck.maxAbsoluteDifference < 1e-9);
  const pfba = await productCase('textbook-parsimonious-fba', textbook, { analysis: 'fba', pfba: true });
  assert.ok(pfba.summary.parsimonious.totalFlux > 0);
  const json = await productCase('textbook-json-fba', join(workDir, 'textbook.json'), { analysis: 'fba' });
  assert.ok(Math.abs(json.summary.objective.value - fba.summary.objective.value) < 1e-9, 'SBML and JSON optima differ');

  // 2. Flux variability against COBRApy's published table, and reproducibility.
  const fva = await productCase('textbook-fva', textbook, { analysis: 'fva' });
  const fvaRows = csvRows(await readFile(fva.paths.variabilityCsv, 'utf8'));
  assert.equal(fvaRows.length, Object.keys(fvaReference.minimum).length);
  let fvaWorst = 0;
  for (const row of fvaRows) {
    for (const [column, key] of [['Minimum', 'minimum'], ['Maximum', 'maximum']]) {
      const expected = fvaReference[key][row.Reaction];
      const observed = Number(row[column]);
      assert.ok(Math.abs(observed - expected) <= 1e-8 + 1e-5 * Math.abs(expected),
        `${row.Reaction} ${key}: ${observed} against COBRApy's ${expected}`);
      fvaWorst = Math.max(fvaWorst, Math.abs(observed - expected));
    }
  }
  // HiGHS returns the same vertex on every run, with last bits that vary by about 1e-14, so the repeat
  // is held to the precision the runner reports rather than to identical bytes.
  const repeat = await productCase('textbook-fva-repeat', textbook, { analysis: 'fva' });
  const repeatRows = Object.fromEntries(csvRows(await readFile(repeat.paths.variabilityCsv, 'utf8'))
    .map((row) => [row.Reaction, row]));
  let repeatWorst = 0;
  for (const row of fvaRows) {
    for (const column of ['Minimum', 'Maximum']) {
      repeatWorst = Math.max(repeatWorst, Math.abs(Number(row[column]) - Number(repeatRows[row.Reaction][column])));
    }
  }
  assert.ok(repeatWorst <= 1e-9, `The repeated FVA differs by ${repeatWorst}`);
  cases.find((item) => item.id === 'textbook-fva-repeat').maxAbsoluteDifferenceFromFirstRun = repeatWorst;
  const minimized = await productCase('textbook-fva-minimized-uptake', textbook, { analysis: 'fva', objective: 'EX_glc__D_e',
    direction: 'min', fractionOfOptimum: 0.95 });
  const uptake = csvRows(await readFile(minimized.paths.variabilityCsv, 'utf8')).find((row) => row.Reaction === 'EX_glc__D_e');
  assert.deepEqual([Number(uptake.Minimum), Number(uptake.Maximum)], [-10, -9.5]);

  // 3. Single gene and reaction deletions against COBRApy's tests.
  const genes = await productCase('textbook-gene-deletion', textbook, { analysis: 'gene-deletion' });
  assert.deepEqual([...genes.summary.deletions.essential].sort(), ESSENTIAL_GENES);
  const geneRows = Object.fromEntries(csvRows(await readFile(genes.paths.deletionsCsv, 'utf8')).map((row) => [row.Gene, row]));
  for (const [gene, growth] of Object.entries(GENE_DELETION_GROWTH)) {
    assert.ok(Math.abs(Number(geneRows[gene]['Objective after deletion']) - growth) <= 1e-2, `${gene} deletion`);
  }
  const reactions = await productCase('textbook-reaction-deletion', textbook, { analysis: 'reaction-deletion' });
  assert.deepEqual([...reactions.summary.deletions.essential].sort(), ESSENTIAL_REACTIONS);
  const reactionRows = Object.fromEntries(csvRows(await readFile(reactions.paths.deletionsCsv, 'utf8'))
    .map((row) => [row.Reaction, row]));
  for (const [reaction, growth] of Object.entries(REACTION_DELETION_GROWTH)) {
    assert.ok(Math.abs(Number(reactionRows[reaction]['Objective after deletion']) - growth) <= 1e-5, `${reaction} deletion`);
  }
  const knockout = await productCase('textbook-gapd-gene-knockout', textbook, { analysis: 'fba', knockouts: ['b1779'] });
  assert.ok(Math.abs(knockout.summary.objective.value) < 1e-9, 'Knocking out GAPD (b1779) must stop growth');

  // 4. A genome-scale model: iJO1366, 2,583 reactions, 1,367 genes, confirmed by GLPK throughout.
  // At 100 % of the optimum GLPK's tolerance lets some reactions carry flux the exact optimum forbids;
  // the runner settles each dispute in exact rational arithmetic, and every one must side with HiGHS.
  const large = await productCase('ijo1366-fba', genomeScale, { analysis: 'fba' });
  const largeFva = await productCase('ijo1366-fva', genomeScale, { analysis: 'fva' });
  const largeGenes = await productCase('ijo1366-gene-deletion', genomeScale, { analysis: 'gene-deletion' });
  const settled = [...largeFva.summary.crossCheck.settledByExactArithmetic, ...largeGenes.summary.crossCheck.settledByExactArithmetic];
  for (const entry of settled) {
    assert.ok(entry.exact === null ? entry.highs === null
      : Math.abs(entry.highs - entry.exact) <= 1e-6 * Math.max(1, Math.abs(entry.exact)), JSON.stringify(entry));
  }

  // 5. Malformed, unsupported and impossible requests are refused with an actionable message.
  await refused('no-glucose', textbook, { analysis: 'fba', bounds: [{ reaction: 'EX_glc__D_e', lower: 0, upper: 1000 }] },
    'no optimal flux distribution');
  await refused('unknown-reaction', textbook, { analysis: 'fba', bounds: [{ reaction: 'EX_unobtainium_e', lower: -1, upper: 0 }] },
    'not a reaction in the model');
  await refused('inverted-bounds', textbook, { analysis: 'fba', bounds: [{ reaction: 'EX_glc__D_e', lower: 5, upper: -5 }] },
    'exceeds its upper bound');
  await refused('unknown-gene', textbook, { analysis: 'fba', knockouts: ['b9999'] }, 'not in the model: b9999');
  await refused('unknown-objective', textbook, { analysis: 'fba', objective: 'NOT_A_REACTION' }, 'is not in the model');
  await refused('entities', join(workDir, 'entities.xml'), { analysis: 'fba' }, 'declares a document type or entities');
  await refused('truncated-gzip', join(workDir, 'truncated.xml.gz'), { analysis: 'fba' }, 'damaged');
  await refused('not-sbml', join(workDir, 'not-sbml.xml'), { analysis: 'fba' }, 'not an SBML document');
  await refused('not-a-json-model', join(workDir, 'not-a-model.json'), { analysis: 'fba' }, 'is not a COBRA model');
  await refused('gene-deletion-without-genes', join(workDir, 'no-genes.json'), { analysis: 'gene-deletion' },
    'lists no gene products');
  await refused('unsupported-format', join(data, 'mini.mat'), { analysis: 'fba' }, 'must use one of these formats');

  // 6. Nothing was written outside the run: not into the payload, not into the user's home.
  assert.deepEqual(await readdir(home), [], 'COBRApy wrote into the home directory');
  if (releasePath) await verifyExtractedPayload(releasePath, { publicPath, root: runtimeDir });
  cases.push({ id: 'nothing-written-outside-the-run', homeEmpty: true, signedPayloadReverified: Boolean(releasePath) });

  const validation = { schemaVersion: 1, kind: 'liatir.metabolic-modeling-scientific-validation',
    createdAt: new Date().toISOString(), status: 'passed', modelId: COMPONENT_ID, sourceRevision: SOURCE_REVISION,
    targetId, productRunnerSha256: sha256(productRunner), cases, hardwareSamples: samples, runtimeEvidence,
    reference: { documentedTextbookGrowth: DOCUMENTED_TEXTBOOK_GROWTH, textbookGrowth: fba.summary.objective.value,
      fvaReference: FVA_REFERENCE, fvaMaxAbsoluteDifference: fvaWorst, essentialGenes: ESSENTIAL_GENES,
      essentialReactions: ESSENTIAL_REACTIONS, geneDeletionGrowth: GENE_DELETION_GROWTH,
      reactionDeletionGrowth: REACTION_DELETION_GROWTH, iJO1366Growth: large.summary.objective.value,
      iJO1366SettledByExactArithmetic: settled },
    measurementHost: { platform: platform(), arch: arch(), osRelease: osRelease(),
      cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem() },
    validatorSource: {
      gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      sourceTreeDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
      scriptSha256: sha256(await readFile(import.meta.filename)),
      measurementScriptSha256: sha256(await readFile(measurementPath)),
      fixturePreparationSha256: sha256(PREPARE_FIXTURES),
      recipeSha256: sha256(await readFile(recipePath)),
    },
    provenance: { recipeId: authoringId, recipeVersion: authoringVersion, pythonVersion: recipe.runtime.version,
      ...builderVersionFields(recipe), dependencyLockSha256 },
    evidence: {
      fixture: { id: 'cobrapy-0.32.1-textbook', sha256: sha256(await readFile(textbook)) },
      framework: { name: 'cobrapy', version: '0.32.1', backend: 'cpu' },
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
  if (keep) console.error(`Preserved metabolic validation workspace: ${workDir}`);
  else await rm(workDir, { recursive: true, force: true });
}
