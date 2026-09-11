#!/usr/bin/env node

/** Runs the official pVACseq fixture offline and compares locked MHCflurry output with upstream. */
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { builderVersionFields } from 'scrollcase/build';
import { loadRuntimeBoxValidatorContext } from './runtime-box/validator-context.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_ID = 'griffithlab-pvactools-pvacseq';
const SOURCE_REVISION = 'v7.1.2+mhcflurry-v2.0.6';
const ABSOLUTE_TOLERANCE = 0.001;
const RELATIVE_TOLERANCE = 0.001;
const VALIDATION_ALLELES = ['HLA-A*29:02', 'HLA-B*45:01', 'HLA-B*82:02'];
const {
  recipe: RECIPE,
  authoringId: AUTHORING_ID,
  authoringVersion: AUTHORING_VERSION,
  targetId: TARGET_ID,
  runtimeDir: RUNTIME_DIR,
  python: PYTHON,
  dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
} = await loadRuntimeBoxValidatorContext({
  root: ROOT,
  defaultRecipeId: 'pvactools-pvacseq-macos-aarch64-cpu',
  runtimeDirectoryEnvironment: 'LIATIR_PVACTOOLS_RUNTIME_DIR',
});
if (RECIPE.labels.model !== MODEL_ID || RECIPE.sourceRevision !== SOURCE_REVISION) {
  throw new Error('pVACseq validation provenance differs from the pinned Tool Runtime contract.');
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 128 * 1024 * 1024,
    timeout: options.timeoutMs ?? 4 * 60 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with status ${result.status}\n${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), durationMs: Date.now() - startedAt };
}

function extractEmbeddedScript(source) {
  const prefix = 'export const PVACSEQ_SCRIPT = String.raw`';
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('`;');
  if (start < 0 || end <= start) throw new Error('Cannot extract the product pVACseq runner.');
  return source.slice(start + prefix.length, end);
}

function parseLastJson(stdout) {
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try { return JSON.parse(lines[index]); } catch { /* continue */ }
  }
  throw new Error('pVACseq runner did not emit its structured result.');
}

async function readTsv(path) {
  const lines = (await readFile(path, 'utf8')).trim().split(/\r?\n/u);
  const columns = lines[0].split('\t');
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const values = line.split('\t');
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']));
  });
  return { columns, rows };
}

const REDUCE_FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import pysam
import sys

payload = json.load(sys.stdin)
source = pysam.VariantFile(payload["source"])
plain = Path(payload["plain"])
with pysam.VariantFile(str(plain), "w", header=source.header) as output:
    count = 0
    for record in source:
        output.write(record)
        count += 1
        if count == 25:
            break
if count != 25:
    raise SystemExit("Official pVACseq fixture has fewer than 25 variants.")
pysam.tabix_compress(str(plain), payload["compressed"], force=True)
pysam.tabix_index(payload["compressed"], preset="vcf", force=True)
plain.unlink()
print(json.dumps({"variantCount": count, "path": payload["compressed"]}))
`;

const workDir = await mkdtemp(join(tmpdir(), 'liatir-pvacseq-validation-'));
try {
  const officialRoot = join(
    RUNTIME_DIR,
    'source/pvactools-wheel/pvactools/tools/pvacseq/example_data',
  );
  const officialVcf = join(officialRoot, 'annotated.expression.vcf.gz');
  const goldenAll = join(
    officialRoot,
    'results/MHC_Class_I/HCC1395_TUMOR_DNA.MHC_I.all_epitopes.tsv',
  );
  await access(officialVcf);
  await access(`${officialVcf}.tbi`);
  await access(goldenAll);

  const productSource = await readFile(
    join(ROOT, 'frontend/src/lib/tools/oncology/python-scripts/pvacseq.ts'),
    'utf8',
  );
  const productRunner = extractEmbeddedScript(productSource);
  const productRunnerSha256 = createHash('sha256').update(productRunner).digest('hex');
  const productScript = join(workDir, 'liatir-pvacseq.py');
  const reduceScript = join(workDir, 'reduce-fixture.py');
  const reducedVcf = join(workDir, 'official-reduced.vcf.gz');
  await writeFile(productScript, productRunner);
  await writeFile(reduceScript, REDUCE_FIXTURE_SCRIPT);
  const fixture = JSON.parse(run(PYTHON, [reduceScript], {
    input: JSON.stringify({
      source: officialVcf,
      plain: join(workDir, 'official-reduced.vcf'),
      compressed: reducedVcf,
    }),
  }).stdout);

  const execution = run(PYTHON, [productScript], {
    input: JSON.stringify({
      runtimePath: RUNTIME_DIR,
      inputVcf: reducedVcf,
      tumorSample: 'HCC1395_TUMOR_DNA',
      normalSample: 'HCC1395_NORMAL_DNA',
      proximalVcf: '',
      alleles: VALIDATION_ALLELES,
      peptideLengths: [9],
      predictors: ['MHCflurry', 'MHCflurryEL'],
      passOnly: false,
      topCount: 50,
      threads: 1,
      outputDir: join(workDir, 'output'),
    }),
  });
  const result = parseLastJson(execution.stdout);
  if (
    result.summary.pvactoolsVersion !== '7.1.2'
    || result.summary.mhcflurryVersion !== '2.0.6'
    || JSON.stringify(result.summary.predictors) !== JSON.stringify(['MHCflurry', 'MHCflurryEL'])
    || result.summary.networkAccess !== false
  ) {
    throw new Error('pVACseq version, predictor, or offline contract differs.');
  }
  if (result.summary.inputInspection.variantCount !== 25 || result.summary.allEpitopeCount <= 0) {
    throw new Error('The reduced official pVACseq fixture produced no epitope rows.');
  }
  if (!result.summary.finiteScores) throw new Error('pVACseq produced a non-finite score.');

  for (const path of [
    result.allPath,
    result.filteredPath,
    result.aggregatePath,
    result.metricsPath,
    result.candidatesPath,
    result.summaryPath,
  ]) await access(path);

  const actual = await readTsv(result.allPath);
  const golden = await readTsv(goldenAll);
  for (const column of [
    'Index',
    'HLA Allele',
    'MT Epitope Seq',
    'MHCflurry MT IC50 Score',
    'MHCflurry MT Percentile',
    'MHCflurryEL Presentation MT Score',
    'MHCflurryEL Presentation MT Percentile',
  ]) {
    if (!actual.columns.includes(column) || !golden.columns.includes(column)) {
      throw new Error(`Required pVACseq comparison column is missing: ${column}`);
    }
  }
  const key = (row) => [row.Index, row['HLA Allele'], row['MT Epitope Seq']].join('|');
  const goldenRows = new Map(golden.rows.map((row) => [key(row), row]));
  const actualIndexes = new Set(actual.rows.map((row) => row.Index));
  const expectedRows = golden.rows.filter((row) =>
    actualIndexes.has(row.Index)
    && VALIDATION_ALLELES.includes(row['HLA Allele'])
    && row['MT Epitope Seq'].length === 9
  );
  if (actual.rows.length !== expectedRows.length || result.summary.allEpitopeCount !== expectedRows.length) {
    throw new Error(
      `Reduced pVACseq count differs from the official result: ${actual.rows.length} vs ${expectedRows.length}.`,
    );
  }
  const actualOrder = actual.rows.map(key);
  const expectedOrder = expectedRows.map(key);
  if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error('Reduced pVACseq row order differs from the official result.');
  }
  let comparedScores = 0;
  let maximumAbsoluteDifference = 0;
  let firstScoreMismatch = null;
  const scoreColumns = [
    'MHCflurry MT IC50 Score',
    'MHCflurry MT Percentile',
    'MHCflurryEL Presentation MT Score',
    'MHCflurryEL Presentation MT Percentile',
  ];
  for (const row of actual.rows) {
    const expected = goldenRows.get(key(row));
    if (!expected) throw new Error(`Reduced pVACseq row is absent from the official upstream result: ${key(row)}`);
    for (const column of scoreColumns) {
      const left = Number(row[column]);
      const right = Number(expected[column]);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        throw new Error(`pVACseq comparison score is non-finite: ${column}`);
      }
      const difference = Math.abs(left - right);
      maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, difference);
      comparedScores += 1;
      const tolerance = ABSOLUTE_TOLERANCE + RELATIVE_TOLERANCE * Math.abs(right);
      if (difference > tolerance && firstScoreMismatch === null) {
        firstScoreMismatch = { row: key(row), column, actual: left, expected: right, difference };
      }
    }
  }
  if (firstScoreMismatch !== null) {
    throw new Error(
      `pVACseq score parity exceeded the ${ABSOLUTE_TOLERANCE} absolute and ${RELATIVE_TOLERANCE} relative tolerances: ${JSON.stringify({
        ...firstScoreMismatch,
        maximumAbsoluteDifference,
      })}`,
    );
  }

  const framework = JSON.parse(run(PYTHON, ['-c', [
    'import json, tensorflow as tf',
    'print(json.dumps({"name":"tensorflow","version":tf.__version__,"reportedCudaCompatibility":None}))',
  ].join(';')]).stdout);
  const fixtureSha256 = createHash('sha256').update(await readFile(reducedVcf)).digest('hex');
  console.log(JSON.stringify({
    status: 'passed',
    modelId: MODEL_ID,
    sourceRevision: SOURCE_REVISION,
    targetId: TARGET_ID,
    productRunnerSha256,
    outputCounts: {
      all: result.summary.allEpitopeCount,
      filtered: result.summary.filteredCount,
      aggregate: result.summary.aggregateCount,
      candidates: result.summary.candidateCount,
    },
    comparison: { comparedScores, maximumAbsoluteDifference },
    durationMs: execution.durationMs,
    provenance: {
      recipeId: AUTHORING_ID,
      recipeVersion: AUTHORING_VERSION,
      pythonVersion: RECIPE.runtime.version,
      ...builderVersionFields(RECIPE),
      dependencyLockSha256: DEPENDENCY_LOCK_SHA256,
    },
    evidence: {
      fixture: {
        id: 'pvactools-7.1.2-official-example-first-25-variants-v1',
        sha256: fixtureSha256,
        inputShapes: { variants: [fixture.variantCount], alleles: [3], peptideLengths: [1] },
      },
      framework,
      accelerator: {
        kind: 'cpu',
        gpuModel: null,
        gpuMemoryBytes: null,
        computeCapability: null,
        driverVersion: null,
        reportedCudaCompatibility: null,
      },
      outputShapes: {
        allEpitopes: [result.summary.allEpitopeCount],
        filteredEpitopes: [result.summary.filteredCount],
        aggregateCandidates: [result.summary.aggregateCount],
      },
      finiteValues: true,
      tolerances: { absolute: ABSOLUTE_TOLERANCE, relative: RELATIVE_TOLERANCE },
      parity: {
        reference: 'pvactools-7.1.2-official-example-output',
        passed: true,
        cpuBaselinePassed: true,
        acceleratorPassed: null,
        maximumAbsoluteDifference,
        meanAbsoluteDifference: null,
        minimumCosineSimilarity: null,
      },
      peakRamBytes: null,
      peakVramBytes: null,
      outputContract: 'passed',
      provenanceContract: 'passed',
    },
  }, null, 2));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
