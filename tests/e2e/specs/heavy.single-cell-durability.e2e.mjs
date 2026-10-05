/** Verify real signed scGPT persistence before starting another full dataset. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSandboxWorkspace, hardNavigateInApp, waitForLiatirBridge } from '../support/liatir-app.mjs';
import { runtimeBoxTargetForNativeTest } from '../support/runtime-box.mjs';
import { loadProductPythonScript } from '../../../scripts/runtime-box/product-script.mjs';
import { LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION, LIATIR_SINGLE_CELL_STUDY_PC_LIMITS } from '../../../packages/liatir-core/dist/single-cell-showcase.js';

const runtimeId = 'single-cell-foundation-scgpt-whole-human';
const pc = process.env.LIATIR_STUDY_PC_GPU === '1';
const fixtureScript = String.raw`
import json, sys, hashlib
from pathlib import Path
import anndata, numpy as np, pandas as pd
from scipy import sparse
p=json.loads(sys.stdin.read())
if p.get('pc'):
    source=Path(p['sourceRoot'])
    manifest=json.loads((source/'datasets/pancreas/manifest.json').read_text())
    original=anndata.read_h5ad(source/'datasets/pancreas/counts.h5ad',backed='r')
    data=original[:128,:].to_memory()
    np.testing.assert_array_equal(data.X.toarray(),original.X[:128,:].toarray())
    original.file.close()
    file=Path(p['outputDir'])/'input.h5ad';file.parent.mkdir(parents=True,exist_ok=True)
    data.write_h5ad(file)
    provenance={**manifest['source_count_provenance'],'prepared_sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
    print(json.dumps({'inputFile':str(file),'sourceCountProvenance':provenance,'cells':data.n_obs,
                      'sourcePreparedSha256':manifest['prepared_sha256'],'scope':'Exact first 128 original pancreas cells, diagnostic only'}))
    sys.exit(0)
genes=sorted(g for g in json.loads((Path(p['runtimeDir'])/'model-cache/scgpt-whole-human/vocab.json').read_text()) if not g.startswith('<'))[:1536]
counts=np.asarray([[((j*19+i*31)%101)+1 for j in range(len(genes))] for i in range(16)], dtype=np.int32)
file=Path(p['outputDir'])/'input.h5ad'
file.parent.mkdir(parents=True,exist_ok=True)
anndata.AnnData(sparse.csr_matrix(counts),obs=pd.DataFrame(index=[f'cell-{i}' for i in range(16)]),var=pd.DataFrame({'gene_name':genes},index=genes)).write_h5ad(file)
print(json.dumps({'inputFile':str(file)}))
`;

async function completedJob(browser, jobId) {
  return browser.execute(async (id) => {
    let unlisten;
    const result = await new Promise((resolve, reject) => {
      window.Liatir.desktop.events.on(`jobs:exit:${id}`, () => {
        window.Liatir.invoke('lia_jobs_status', { jobId: id }).then(resolve, reject);
      }).then((stop) => {
        unlisten = stop;
        return window.Liatir.invoke('lia_jobs_status', { jobId: id });
      }).then((job) => { if (job.status.type !== 'running') resolve(job); }).catch(reject);
    });
    unlisten?.();
    return result;
  }, jobId);
}

export const tests = [{
  name: 'signed scGPT survives interruption with exact embeddings and strict checkpoint identity',
  heavy: true,
  requiredEnv: ['LIATIR_STUDY_DURABILITY'],
  async run({ browser, expect, rootDir }) {
    await waitForLiatirBridge(browser);
    if (process.env.LIATIR_STUDY_DEV_FRONTEND === '1') await hardNavigateInApp(browser, 'http://localhost:5173/');
    await openSandboxWorkspace(browser);
    const installed = pc ? JSON.parse(fs.readFileSync(path.join(rootDir, 'showcases/single-cell-foundation-benchmark/validation/scgpt-cuda-native-install.json'), 'utf8')).result
      : await browser.execute((request) => window.Liatir.invoke('lia_ai_runtime_box_install', request), {
      modelId: 'bowang-scgpt-whole-human', boxId: 'scgpt-whole-human', channel: 'beta',
      registryBaseUrl: 'https://models.liatir.com/v1',
      targetCandidates: runtimeBoxTargetForNativeTest('bowang-scgpt-whole-human', pc ? 'linux-x86_64-cuda12.9' : 'linux-x86_64-cpu'),
      downloadId: `scgpt-durability-${crypto.randomUUID()}`,
    });
    expect(installed.version).toBe('0.2.5-beta.2');
    if (pc) {
      const activation = JSON.parse(fs.readFileSync(path.join(installed.runtimeDir, 'runtime-box-activation.json'), 'utf8'));
      expect(activation.release.target).toMatchObject({ accelerator: 'cuda', cudaVersion: '12.9' });
      expect(activation.release.archive.sha256).toBe('3da31f6ef9c6ca48e55af52190451e4ca8ce293cd9421fc88e997c8cfceed932');
    }
    const { data } = await browser.execute(() => window.Liatir.invoke('lia_fs_paths'));
    const directory = path.join(data, 'showcases', 'scgpt-durability', crypto.randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    const fixture = await browser.execute((input) => window.Liatir.invoke('lia_ai_python_run', input), {
      runtimeId, script: fixtureScript, args: [], inputJson: { runtimeDir: installed.runtimeDir, outputDir: directory, pc,
        sourceRoot: path.join(rootDir, 'showcases/single-cell-foundation-benchmark/transfer/mac-handoff-2026-10-05/runs/6071da5e-c592-4ee3-8544-7bbe5b12be8f/output') }, timeoutSeconds: 120,
    });
    expect(fixture).toMatchObject({ ok: true });
    const fixtureInfo = JSON.parse(fixture.stdout.trim());
    const inputFile = fixtureInfo.inputFile;
    const current = await loadProductPythonScript(path.join(rootDir, 'frontend/src/lib/tools/ai/python-scripts/scgpt-embedding.ts'), 'SCGPT_EMBEDDING_SCRIPT');
    const base = path.join(rootDir, 'showcases/single-cell-foundation-benchmark');
    const monitor = fs.readFileSync(path.join(base, 'src/model_monitor.py'), 'utf8');
    const payload = (modelScript, outputDir, randomSeed = 23) => ({
      modelScript, runtimePath: installed.runtimeDir, modelCacheDir: `${installed.runtimeDir}/model-cache/scgpt-whole-human`,
      inputFile, outputDir, species: 'human', batchSize: pc ? LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION.batchSize : 1, accelerator: pc ? 'cuda' : 'cpu',
      threads: pc ? LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION.threads : 1, maxCsvRows: 3, randomSeed,
      ...(fixtureInfo.sourceCountProvenance ? { sourceCountProvenance: fixtureInfo.sourceCountProvenance } : {}),
      resourceGuard: fs.readFileSync(path.join(base, 'src/resource_guard.py'), 'utf8'),
      resourceLimits: pc ? { ...LIATIR_SINGLE_CELL_STUDY_PC_LIMITS, maxGpuUsedBytes: LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION.maxGpuUsedBytes }
        : { maxRssBytes: 2147483648, minAvailableBytes: 2147483648, minDiskBytes: 4294967296, maxSwapGrowthBytes: 268435456 },
    });
    const resumed = path.join(directory, 'resumed');
    fs.mkdirSync(resumed);
    // Observe actual database commits; this never infers a checkpoint from a progress log.
    let watcher;
    let checkpointTimeout;
    const firstBatch = new Promise((resolve, reject) => {
      checkpointTimeout = setTimeout(() => { watcher.close(); reject(new Error('No durable model batch was observed')); }, 180000);
      watcher = fs.watch(resumed, (_event, file) => {
        if (!file?.startsWith('scgpt-checkpoint.sqlite3')) return;
        const query = spawnSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True,timeout=0); print(c.execute("SELECT COALESCE(MAX(stop),0) FROM batches").fetchone()[0])', path.join(resumed, 'scgpt-checkpoint.sqlite3')], { encoding: 'utf8' });
        if (query.status === 0 && Number(query.stdout) > 0) {
          clearTimeout(checkpointTimeout);
          watcher.close();
          resolve(Number(query.stdout));
        }
      });
    });
    const { jobId } = await browser.execute((input) => window.Liatir.invoke('lia_ai_python_spawn', input), {
      runtimeId, script: monitor, args: [], inputJson: payload(current, resumed), workspaceId: '__test__',
      label: 'scGPT durability diagnostic: intentional interruption', metadata: { diagnostic: true },
    });
    const firstJobFinished = completedJob(browser, jobId);
    const committedBeforeKill = await Promise.race([firstBatch, firstJobFinished.then((job) => {
      clearTimeout(checkpointTimeout);
      watcher.close();
      throw new Error(`Model exited before its first observed checkpoint: ${JSON.stringify(job.status)}`);
    })]);
    await browser.execute((id) => window.Liatir.invoke('lia_jobs_kill', { jobId: id }), jobId);
    const interrupted = await firstJobFinished;
    expect(interrupted.status.type).not.toBe('done');
    const run = (inputJson, timeoutSeconds = 180) => browser.execute((input) => window.Liatir.invoke('lia_ai_python_run', input), {
      runtimeId, script: monitor, args: [], inputJson, timeoutSeconds,
    });
    let gpuGuardEvidence;
    if (pc) {
      const guardedDirectory = path.join(directory, 'gpu-refusal');
      const safe = payload(current, guardedDirectory);
      const refused = await run({ ...safe, resourceLimits: { ...safe.resourceLimits, maxGpuUsedBytes: 1 } });
      expect(refused.ok).toBe(false);
      const recorded = JSON.parse(fs.readFileSync(path.join(guardedDirectory, 'resource-monitor.json'), 'utf8'));
      expect(recorded.status).toBe('refused');
      expect(recorded.reason).toContain('gpu_used_bytes');
      gpuGuardEvidence = recorded;
    }
    const rejected = await run(payload(current, resumed, 24));
    expect(rejected.ok).toBe(false);
    expect(rejected.stderr).toContain('identity changed');
    const finished = await run(payload(current, resumed));
    expect(finished).toMatchObject({ ok: true });
    const referenceDirectory = path.join(directory, 'reference');
    const original = fs.readFileSync(path.join(base, 'transfer/mac-handoff-2026-10-05/runs/7afd5cd1-2911-45c7-be7f-28cb212734ca/output/code/scgpt-inference.py'), 'utf8');
    // The frozen runner's quadratic vocabulary loader is retained exactly.
    const reference = await run(payload(pc ? current : original, referenceDirectory), pc ? 180 : 1200);
    expect(reference).toMatchObject({ ok: true });
    const benchmarks = [];
    if (pc) {
      const measured = (dir) => ({ directory: dir,
        inference: JSON.parse(fs.readFileSync(path.join(dir, 'scgpt-inference-timing.json'), 'utf8')),
        resources: JSON.parse(fs.readFileSync(path.join(dir, 'resource-monitor.json'), 'utf8')) });
      benchmarks.push(measured(referenceDirectory));
      const largerDirectory = path.join(directory, 'batch-32');
      const larger = await run({ ...payload(current, largerDirectory), batchSize: 32 });
      benchmarks.push(larger.ok ? measured(largerDirectory) : { directory: largerDirectory, status: 'failed', error: larger.stderr,
        resources: JSON.parse(fs.readFileSync(path.join(largerDirectory, 'resource-monitor.json'), 'utf8')) });
    }
    const comparisonScript = String.raw`
import json, sys, hashlib
from pathlib import Path
import anndata, numpy as np
p=json.loads(sys.stdin.read())
a=anndata.read_h5ad(Path(p['resumed'])/'input_scgpt_adata.h5ad')
b=anndata.read_h5ad(Path(p['reference'])/'input_scgpt_adata.h5ad')
np.testing.assert_array_equal(a.obs_names,b.obs_names)
np.testing.assert_array_equal(a.obsm['X_scGPT'],b.obsm['X_scGPT'])
result={'status':'passed','cells':a.n_obs,'dimensions':a.obsm['X_scGPT'].shape[1], 'values_sha256':hashlib.sha256(a.obsm['X_scGPT'].tobytes()).hexdigest()}
if p.get('cpuCheckpoint'):
    import sqlite3
    c=sqlite3.connect('file:'+p['cpuCheckpoint']+'?mode=ro',uri=True)
    cpu=np.concatenate([np.frombuffer(row[0],dtype='<f4').reshape(-1,512) for row in c.execute('SELECT data FROM batches ORDER BY start')])[:a.n_obs]
    c.close()
    gpu=a.obsm['X_scGPT']
    np.testing.assert_allclose(gpu,cpu,atol=2e-5,rtol=2e-4)
    result['cpu_gpu_max_abs_difference']=float(np.max(np.abs(gpu-cpu)))
    result['cpu_gpu_min_cosine']=float(np.min(np.sum(gpu*cpu,axis=1)))
    result['cpu_gpu_comparison']='Numerical compatibility diagnostic only; CPU cells are not merged into the GPU checkpoint.'
print(json.dumps(result))
`;
    const compared = await browser.execute((input) => window.Liatir.invoke('lia_ai_python_run', input), {
      runtimeId, script: comparisonScript, args: [], inputJson: { resumed, reference: referenceDirectory,
        ...(pc ? { cpuCheckpoint: path.join(base, 'transfer/pancreas-cpu-before-resource-upgrade/scgpt/scgpt-checkpoint.sqlite3') } : {}) }, timeoutSeconds: 120,
    });
    expect(compared).toMatchObject({ ok: true });
    const accounting = JSON.parse(fs.readFileSync(path.join(resumed, 'scgpt-checkpoint-accounting.json'), 'utf8'));
    expect(accounting.attempts.map((a) => a.status)).toEqual(['interrupted', 'completed']);
    const evidence = {
      status: 'passed', host: process.platform, runtime: installed.activation, runtimeDir: installed.runtimeDir,
      directory, interruptedJobId: jobId, interruptedStatus: interrupted.status, committedBeforeKill,
      rejectedSeedChange: true, comparison: JSON.parse(compared.stdout.trim()), accounting,
      fixture: fixtureInfo,
      gpuGuardEvidence, benchmarks,
      scope: pc ? '128 original pancreas cells through native signed CUDA runtime; resumed and uninterrupted GPU results must match exactly. CPU comparison is numerical only. All completed Mac stages remain reused.'
        : '16-cell diagnostic; exact resumed values compared with the frozen Mac inference runner on the same signed Linux CPU runtime. No full-dataset inference is repeated.',
    };
    fs.writeFileSync(path.join(base, pc ? 'validation/scgpt-durability-cuda-wsl2.json' : 'validation/scgpt-durability-wsl2.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  },
}];
