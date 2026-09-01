import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MHCFLURRY_EPITOPE_SCRIPT } from '../../frontend/src/lib/tools/ai/python-scripts/mhcflurry-epitope';
import { PVACSEQ_SCRIPT } from '../../frontend/src/lib/tools/oncology/python-scripts/pvacseq';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';

function minimalPvacRuntime(root: string): void {
  for (const file of [
    'source/pvactools-wheel/pvactools/tools/pvacseq/run.py',
    'source/mhcflurry-wheel/mhcflurry/__init__.py',
    'source/mhcgnomes-wheel/mhcgnomes/__init__.py',
    'source/vcfpy-sdist/vcfpy/__init__.py',
    'source/np-utils-sdist/np_utils/__init__.py',
    'source/vaxrank-sdist/vaxrank/manufacturability.py',
    'model-cache/pvactools-mhcflurry-downloads/models_class1_presentation/models/weights.csv',
  ]) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
  }
}

function runPvacPreflight(vcf: string, tumorSample = 'TUMOR') {
  const root = mkdtempSync(join(tmpdir(), 'liatir-pvac-preflight-'));
  minimalPvacRuntime(root);
  const input = join(root, 'input.vcf');
  writeFileSync(input, vcf);
  return spawnSync(PYTHON, ['-c', PVACSEQ_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify({
      runtimePath: root,
      inputVcf: input,
      tumorSample,
      normalSample: '',
      proximalVcf: '',
      alleles: ['HLA-A*02:01'],
      peptideLengths: [9],
      predictors: ['MHCflurry', 'MHCflurryEL'],
      outputDir: join(root, 'output'),
    }),
  });
}

function runnablePvacStub(root: string, invokeGuardedPredictor = false): void {
  minimalPvacRuntime(root);
  const predictor = join(root, 'source/pvactools-wheel/pvactools/lib/prediction_class.py');
  mkdirSync(join(predictor, '..'), { recursive: true });
  writeFileSync(predictor, [
    'class MHCflurry:',
    '    def valid_allele_names(self):',
    '        return ["HLA-A*02:01"]',
    '',
  ].join('\n'));
  const runner = join(root, 'source/pvactools-wheel/pvactools/tools/pvacseq/run.py');
  writeFileSync(runner, [
    'import json',
    ...(invokeGuardedPredictor ? ['import subprocess'] : []),
    'from pathlib import Path',
    '',
    'def main(args):',
    ...(invokeGuardedPredictor ? ['    subprocess.run(["mhcflurry-predict"], check=True)'] : []),
    '    tumor = args[1]',
    '    root = Path(args[5]) / "MHC_Class_I"',
    '    root.mkdir(parents=True, exist_ok=True)',
    '    prefix = root / (tumor + ".MHC_I")',
    '    Path(str(prefix) + ".all_epitopes.tsv").write_text("MHCflurry MT IC50 Score\\tMHCflurry MT Percentile\\tMHCflurryEL Presentation MT Score\\n")',
    '    Path(str(prefix) + ".filtered.tsv").write_text("Best MT IC50 Score\\n")',
    '    Path(str(prefix) + ".all_epitopes.aggregated.tsv").write_text("Index\\tGene\\tBest Peptide\\tAllele\\tIC50 MT\\tTier\\t%ile MT\\tPres %ile MT\\n")',
    '    Path(str(prefix) + ".all_epitopes.aggregated.metrics.json").write_text(json.dumps({"rows": 0}))',
    '',
  ].join('\n'));

  if (invokeGuardedPredictor) {
    const command = join(root, 'source/mhcflurry-wheel/mhcflurry/predict_command.py');
    writeFileSync(command, 'def run():\n    print("guarded predictor started")\n');
  }
}

function annotatedVcf(): string {
  return [
    '##fileformat=VCFv4.2',
    '##INFO=<ID=CSQ,Number=.,Type=String,Description="VEP. Format: Allele|WildtypeProtein|FrameshiftSequence">',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tTUMOR',
    '1\t1\t.\tA\tT\t.\tPASS\tCSQ=T|AAAA|TTTT\tGT\t0/1',
    '',
  ].join('\n');
}

function runPvacStub(allele: string) {
  const root = mkdtempSync(join(tmpdir(), 'liatir-pvac-stub-'));
  runnablePvacStub(root);
  const input = join(root, 'annotated.vcf');
  const output = join(root, 'output');
  writeFileSync(input, annotatedVcf());
  const result = spawnSync(PYTHON, ['-c', PVACSEQ_SCRIPT], {
    encoding: 'utf8',
    input: JSON.stringify({
      runtimePath: root,
      inputVcf: input,
      tumorSample: 'TUMOR',
      normalSample: '',
      proximalVcf: '',
      alleles: [allele],
      peptideLengths: [9],
      predictors: ['MHCflurry', 'MHCflurryEL'],
      topCount: 50,
      threads: 1,
      outputDir: output,
    }),
  });
  return { root, output, result };
}

function runPvacStubWithSpawnedImport() {
  const root = mkdtempSync(join(tmpdir(), 'liatir-pvac-spawn-'));
  runnablePvacStub(root);
  const predictor = join(root, 'source/pvactools-wheel/pvactools/lib/prediction_class.py');
  writeFileSync(predictor, [
    'import multiprocessing',
    'multiprocessing.set_start_method("spawn", force=True)',
    '_manager = multiprocessing.Manager()',
    '_queue = _manager.Queue()',
    '',
    'class MHCflurry:',
    '    def valid_allele_names(self):',
    '        return ["HLA-A*02:01"]',
    '',
  ].join('\n'));
  const input = join(root, 'annotated.vcf');
  const output = join(root, 'output');
  const script = join(root, 'pvacseq.py');
  writeFileSync(input, annotatedVcf());
  writeFileSync(script, PVACSEQ_SCRIPT);
  const result = spawnSync(PYTHON, [script], {
    encoding: 'utf8',
    input: JSON.stringify({
      runtimePath: root,
      inputVcf: input,
      tumorSample: 'TUMOR',
      normalSample: '',
      proximalVcf: '',
      alleles: ['HLA-A*02:01'],
      peptideLengths: [9],
      predictors: ['MHCflurry', 'MHCflurryEL'],
      topCount: 50,
      threads: 1,
      outputDir: output,
    }),
  });
  return result;
}

function runPvacStubWithLongPythonPath() {
  const root = mkdtempSync(join(tmpdir(), 'liatir-pvac-long-python-'));
  runnablePvacStub(root, true);
  const input = join(root, 'annotated.vcf');
  const output = join(root, 'output');
  const script = join(root, 'pvacseq.py');
  writeFileSync(input, annotatedVcf());
  writeFileSync(script, PVACSEQ_SCRIPT);

  const probe = spawnSync(PYTHON, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(probe.stderr || 'Python probe failed');
  const longBin = join(root, 'a'.repeat(120), 'b'.repeat(120));
  mkdirSync(longBin, { recursive: true });
  const longPython = join(longBin, 'python3');
  symlinkSync(probe.stdout.trim(), longPython);

  const result = spawnSync(longPython, [script], {
    encoding: 'utf8',
    input: JSON.stringify({
      runtimePath: root,
      inputVcf: input,
      tumorSample: 'TUMOR',
      normalSample: '',
      proximalVcf: '',
      alleles: ['HLA-A*02:01'],
      peptideLengths: [9],
      predictors: ['MHCflurry', 'MHCflurryEL'],
      topCount: 50,
      threads: 1,
      outputDir: output,
    }),
  });
  return { longPython, result };
}

describe('oncology product Python scripts', () => {
  it('finishes all bounded pVACseq input checks before importing its scientific stack', () => {
    const inspection = PVACSEQ_SCRIPT.indexOf('inspection = inspect_vcf(');
    const pvacImport = PVACSEQ_SCRIPT.indexOf('from pvactools.lib.prediction_class import MHCflurry');
    expect(inspection).toBeGreaterThan(0);
    expect(pvacImport).toBeGreaterThan(inspection);
    expect(PVACSEQ_SCRIPT).toContain('variant_count > 2_000_000');
    expect(PVACSEQ_SCRIPT).toContain('A gzipped VCF requires its .tbi tabix index beside it.');
  });

  it('rejects an unannotated VCF and a missing tumor sample without importing pVACtools', () => {
    const unannotated = runPvacPreflight([
      '##fileformat=VCFv4.2',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tTUMOR',
      '1\t1\t.\tA\tT\t.\tPASS\t.\tGT\t0/1',
      '',
    ].join('\n'));
    expect(unannotated.status).not.toBe(0);
    expect(unannotated.stderr).toContain('no readable VEP CSQ annotation header');
    expect(unannotated.stderr).not.toContain('ModuleNotFoundError');

    const annotated = [
      '##fileformat=VCFv4.2',
      '##INFO=<ID=CSQ,Number=.,Type=String,Description="VEP. Format: Allele|WildtypeProtein|FrameshiftSequence">',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tOTHER',
      '1\t1\t.\tA\tT\t.\tPASS\tCSQ=T|AAAA|TTTT\tGT\t0/1',
      '',
    ].join('\n');
    const missingSample = runPvacPreflight(annotated);
    expect(missingSample.status).not.toBe(0);
    expect(missingSample.stderr).toContain('Tumor sample TUMOR is not present in the VCF');
    expect(missingSample.stderr).not.toContain('ModuleNotFoundError');
  });

  it('locks pVACseq to local MHCflurry predictors and guards parent and child sockets', () => {
    expect(PVACSEQ_SCRIPT).toContain('ALLOWED_PREDICTORS = ["MHCflurry", "MHCflurryEL"]');
    expect(PVACSEQ_SCRIPT).toContain('"MHCflurry",\n        "MHCflurryEL",');
    expect(PVACSEQ_SCRIPT).toContain('socket.socket.connect = deny_network');
    expect(PVACSEQ_SCRIPT).toContain('sock.family == socket.AF_UNIX');
    expect(PVACSEQ_SCRIPT).toContain("socket.socket.connect = deny");
    expect(PVACSEQ_SCRIPT).toContain('MHCFLURRY_DOWNLOADS_DIR');
    expect(PVACSEQ_SCRIPT).not.toContain('mhcflurry-downloads fetch');
    expect(PVACSEQ_SCRIPT).not.toContain('IEDB');
    expect(PVACSEQ_SCRIPT).toContain('"proximalInputInspection": proximal_inspection');
    expect(PVACSEQ_SCRIPT).toContain('"passOnly": bool(payload.get("passOnly"))');
    expect(PVACSEQ_SCRIPT).toContain('"requestedTopCount": top_count');
  });

  it('runs from a file when a scientific import starts a spawned child process', () => {
    const result = runPvacStubWithSpawnedImport();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Running pVACseq locally');
  });

  it('starts the guarded predictor without placing a long runtime path in its shebang', () => {
    if (process.platform === 'win32') return;
    const { longPython, result } = runPvacStubWithLongPythonPath();
    expect(longPython.length).toBeGreaterThan(255);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('guarded predictor started');
    expect(PVACSEQ_SCRIPT).toContain('"#!/bin/sh\\n"');
    expect(PVACSEQ_SCRIPT).not.toContain('"#!%s\\n" % sys.executable');
  });

  it('accepts the distinct upstream contract for a single-sample proximal VCF', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-pvac-proximal-'));
    runnablePvacStub(root);
    const input = join(root, 'annotated.vcf.gz');
    const proximal = join(root, 'proximal.vcf.gz');
    writeFileSync(input, gzipSync(annotatedVcf()));
    writeFileSync(`${input}.tbi`, 'fixture');
    writeFileSync(proximal, gzipSync([
      '##fileformat=VCFv4.2',
      '##INFO=<ID=CSQ,Number=.,Type=String,Description="VEP. Format: Allele|Feature|Consequence|Amino_acids|Codons|Protein_position">',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tPHASED',
      '1\t1\t.\tA\tT\t.\tPASS\tCSQ=T|ENST1|missense_variant|K/N|aAa/aTa|1\tGT:HP\t0/1:1-1',
      '',
    ].join('\n')));
    writeFileSync(`${proximal}.tbi`, 'fixture');
    const result = spawnSync(PYTHON, ['-c', PVACSEQ_SCRIPT], {
      encoding: 'utf8',
      input: JSON.stringify({
        runtimePath: root,
        inputVcf: input,
        tumorSample: 'TUMOR',
        normalSample: '',
        proximalVcf: proximal,
        alleles: ['HLA-A*02:01'],
        peptideLengths: [9],
        predictors: ['MHCflurry', 'MHCflurryEL'],
        outputDir: join(root, 'output'),
      }),
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a syntactically valid but unsupported allele before starting pVACseq', () => {
    const { result } = runPvacStub('HLA-B*99:99');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsupported MHCflurry allele(s): HLA-B*99:99');
    expect(result.stdout).not.toContain('Running pVACseq locally');
  });

  it('records an honest zero-candidate result instead of inventing output rows', () => {
    const { output, result } = runPvacStub('HLA-A*02:01');
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1)!);
    expect(payload.summary).toMatchObject({
      allEpitopeCount: 0,
      filteredCount: 0,
      aggregateCount: 0,
      candidateCount: 0,
      finiteScores: true,
      networkAccess: false,
    });
    expect(payload.preview).toEqual([]);
    expect(payload.candidatesPath).toBe(join(output, 'MHC_Class_I/TUMOR.MHC_I.candidates.fasta'));
    expect(spawnSync(PYTHON, ['-c', `from pathlib import Path; assert Path(${JSON.stringify(payload.candidatesPath)}).read_text() == ""`]).status).toBe(0);
  });

  it('keeps MHCflurry inputs bounded and uses only explicit bundled models', () => {
    const inputValidation = MHCFLURRY_EPITOPE_SCRIPT.indexOf('prediction_count > 2_000_000');
    const scientificImport = MHCFLURRY_EPITOPE_SCRIPT.indexOf('import pandas');
    expect(inputValidation).toBeGreaterThan(0);
    expect(scientificImport).toBeGreaterThan(inputValidation);
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('len(rows) >= max_rows');
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('not 1 <= top_count <= 5_000');
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('Class1PresentationPredictor.load(str(models_dir))');
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('configure_pytorch(');
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('socket.socket.connect = deny_network');
    expect(MHCFLURRY_EPITOPE_SCRIPT).toContain('"requestedTopCount": top_count');
    expect(MHCFLURRY_EPITOPE_SCRIPT).not.toContain('mhcflurry-downloads');
    expect(MHCFLURRY_EPITOPE_SCRIPT).not.toMatch(/https?:\/\//u);
  });
});
