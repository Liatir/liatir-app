import {
  LIATIR_SINGLE_CELL_STUDY_ID,
  LIATIR_SINGLE_CELL_STUDY_DATASETS,
  LIATIR_SINGLE_CELL_STUDY_METHODS,
  LIATIR_SINGLE_CELL_STUDY_LIMITS,
  LIATIR_SINGLE_CELL_STUDY_PC_LIMITS,
  LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION,
  liatirExecutionMetadata,
  type JsonValue,
  type LiatirSingleCellStudyRequest,
  type RunOutputFile,
  type ToolOutput,
} from '@liatir/core';
import { liatir } from '$lib/api';
import { beginDirectNativeToolRun } from '$lib/execution/direct-native-tool';
import { ensureRunOutputDir } from '$lib/execution/run-storage';
import { runLiatirPlugin } from '$lib/utils/plugin-run';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { cachePathForModel, runAIPython } from '$lib/ai/runtime';
import { modelInstallBlock } from '$lib/ai/model-compatibility';
import { GENEFORMER_EMBEDDING_SCRIPT, SCGPT_EMBEDDING_SCRIPT, UCE_EMBEDDING_SCRIPT } from '$lib/tools/ai/python-scripts';
import monitor from '../../../../showcases/single-cell-foundation-benchmark/src/model_monitor.py?raw';
import protocol from '../../../../showcases/single-cell-foundation-benchmark/protocol.md?raw';
import requirements from '../../../../showcases/single-cell-foundation-benchmark/requirements.txt?raw';
import resourceGuard from '../../../../showcases/single-cell-foundation-benchmark/src/resource_guard.py?raw';
import transferManifest from '../../../../showcases/single-cell-foundation-benchmark/validation/windows-wsl2-handoff-manifest.json?raw';
import { executionRuns } from '$lib/stores/executionRuns.svelte';

const scripts: Record<string, string> = {
  geneformer: GENEFORMER_EMBEDDING_SCRIPT,
  scgpt: SCGPT_EMBEDDING_SCRIPT,
  uce: UCE_EMBEDDING_SCRIPT,
};

/** Each invocation owns a durable Liatir run; navigation never owns the in-flight promise. */
export async function launchSingleCellStudy(request: LiatirSingleCellStudyRequest): Promise<string> {
  if (request.executionProfile && !['cautious-cpu', 'pc-cuda'].includes(request.executionProfile)) throw new Error('Choose a supported execution profile.');
  const pc = request.executionProfile === 'pc-cuda';
  const limits = pc ? LIATIR_SINGLE_CELL_STUDY_PC_LIMITS : LIATIR_SINGLE_CELL_STUDY_LIMITS;
  const execution = pc ? LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION : { accelerator: 'cpu', threads: 1, batchSize: 1 };
  if (!LIATIR_SINGLE_CELL_STUDY_DATASETS.some((d) => d.id === request.dataset)) throw new Error('Select a study dataset.');
  if (!request.methods.length || new Set(request.methods).size !== request.methods.length
    || request.methods.some((id) => !LIATIR_SINGLE_CELL_STUDY_METHODS.some((m) => m.id === id))) {
    throw new Error('Select at least one distinct study method.');
  }
  const api = liatir();
  if (!api) throw new Error('Liatir is unavailable.');
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  if (request.resumeFromRunId && request.importStudyFile) throw new Error('Choose one saved study source.');
  if (request.resumeFromRunId) {
    const previous = executionRuns.byId(request.resumeFromRunId);
    if (!/^[a-f0-9-]{36}$/i.test(request.resumeFromRunId) || !previous
      || previous.identity.entityId !== LIATIR_SINGLE_CELL_STUDY_ID || !previous.finalizedAt) {
      throw new Error('Select a finished study from this workspace to resume.');
    }
  }
  const label = `${request.stabilityCheck ? 'Single-cell stability check' : 'Single-cell study'} · ${request.dataset === 'pbmc' ? 'PBMC 12k' : 'Pancreas'}`;
  const run = await beginDirectNativeToolRun({
    runId: id, toolId: LIATIR_SINGLE_CELL_STUDY_ID, label, inputs: [],
    params: request as unknown as JsonValue, startedAt,
  });
  const outputDir = await ensureRunOutputDir(id);
  const metadata = liatirExecutionMetadata(run.identity);

  async function execute() {
    let output: ToolOutput | null = null;
    let outputFiles: RunOutputFile[] = [];
    let error: string | null = null;
    try {
      await run.appendLog('Preparing the study environment. First use downloads the declared Python packages.');
      const response = await fetch('/showcases/single-cell-benchmark.lia');
      if (!response.ok) throw new Error('The bundled study Plugin is missing.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const rel = `showcases/${LIATIR_SINGLE_CELL_STUDY_ID}/${id}.lia`;
      await api!.invoke('lia_fs_write_bytes', { rel, dataBase64: btoa(binary), permanent: true, createDirs: true });
      const { data } = await api!.invoke('lia_fs_paths') as { data: string };
      const plugin = { path: `${data}/${rel}`, runtime: 'python' as const };
      const status = await api!.invoke('lia_liatir_python_runtime_status', { path: plugin.path }) as { installed: boolean };
      if (!status.installed) {
        const prepared = await api!.invoke('lia_liatir_python_runtime_prepare', { path: plugin.path }) as { stdout: string; stderr: string };
        await run.appendLog(prepared.stdout);
        if (prepared.stderr) await run.appendLog(prepared.stderr, 'stderr');
      }
      const stage = async (action: string, extra: Record<string, unknown> = {}) => {
        await run.appendLog(`${action}${extra.method ? `: ${extra.method}` : ''}`);
        const result = await runLiatirPlugin(plugin,
          { action, outputDir, dataset: request.dataset, cacheDir: `${data}/showcases/single-cell-datasets`,
            resourceLimits: limits, threads: execution.threads, ...extra },
          (stream, line) => { void run.appendLog(line, stream); },
          { workspaceId: run.identity.workspaceId, label: `${label} · ${action}${extra.method ? ` ${extra.method}` : ''}`,
            kind: 'lia-plugin', metadata, signal: run.signal, onSpawn: (jobId) => { void run.attachJob(jobId); } },
        );
        if (result.exitCode !== 0 || result.result == null) throw new Error(result.stderr.join('\n') || `Study stage ${action} failed.`);
        return result.result as Record<string, unknown>;
      };
      const prepared = await stage('prepare', { protocol, requirements, runId: id, modelScripts: scripts, methods: request.methods,
        executionProfile: request.executionProfile ?? 'cautious-cpu',
        stabilityCheck: Boolean(request.stabilityCheck),
        ...(request.importStudyFile ? { importStudyFile: request.importStudyFile, transferManifest: JSON.parse(transferManifest) } : {}),
        ...(request.resumeFromRunId ? { resumeRoot: `${data}/workspaces/${run.identity.workspaceId}/runs/${request.resumeFromRunId}/output` } : {}) });
      const completed = (prepared.completed_methods ?? []) as string[];
      const recordedBlocked = (prepared.recorded_blocked_methods ?? []) as string[];
      const sourceCountProvenance = prepared.source_count_provenance as JsonValue | undefined;
      await aiModelsStore.init();
      const hardware = await aiModelsStore.ensureHardwareInfo();
      for (const method of LIATIR_SINGLE_CELL_STUDY_METHODS.filter((m) => request.methods.includes(m.id))) {
        if (run.signal?.aborted) throw new Error('Study cancelled.');
        if (completed.includes(method.id)) {
          await run.appendLog(`Reusing verified ${method.label} results from the previous study.`);
          continue;
        }
        if (recordedBlocked.includes(method.id)) {
          await run.appendLog(`Reusing the verified ${method.label} failure record from the saved study.`);
          continue;
        }
        if (!method.modelId) {
          try { await stage('baseline', { method: method.id }); }
          catch (failure) {
            if (run.signal?.aborted) throw failure;
            await stage('collect', { method: method.id, config: { method: method.id, seed: 23 },
              runResult: { ok: false, stderr: String(failure) } });
          }
          continue;
        }
        const config = { method: method.id, modelId: method.modelId, seed: 23, zero_shot: true,
          sourceCountProvenance: sourceCountProvenance ?? null,
          ...execution, execution_profile: request.executionProfile ?? 'cautious-cpu', resource_limits: limits };
        let jobId: string | null = null;
        let result;
        try {
          await run.appendLog(`Running ${method.label}. Follow the model Job for details.`);
          await aiModelsStore.refreshRuntimeBoxStatus(method.modelId);
          const model = aiModelsStore.byId(method.modelId);
          if (!model || model.status !== 'installed') {
            const blocked = model && hardware ? modelInstallBlock(model, hardware) : null;
            if (blocked) throw new Error(`${method.label}: ${blocked.reason} ${blocked.details.join(' ')}`);
            throw new Error(`${method.label} is not installed. Install it from AI Models.`);
          }
          result = await runAIPython(model, monitor, {
            modelScript: scripts[method.id], runtimePath: model.runtimePath!, modelCacheDir: cachePathForModel(model)!,
            resourceGuard, resourceLimits: { ...limits, ...(pc ? { maxGpuUsedBytes: LIATIR_SINGLE_CELL_STUDY_PC_EXECUTION.maxGpuUsedBytes } : {}) },
            threads: execution.threads,
            uceCheckpointPreflight: method.id === 'uce',
            profileInference: method.id === 'scgpt' && Boolean(request.stabilityCheck),
            inputFile: prepared.prepared_path as string, outputDir: `${outputDir}/runs/${request.dataset}/${method.id}`,
            ...(sourceCountProvenance ? { sourceCountProvenance } : {}),
            species: 'human', batchSize: execution.batchSize, accelerator: execution.accelerator, maxCsvRows: 3, randomSeed: 23,
            verifyEncoderParity: method.id === 'geneformer' && Boolean(request.stabilityCheck),
          }, { jobLabel: `${label} · ${method.label}`, metadata, timeoutSeconds: 24 * 3600,
            workspaceId: run.identity.workspaceId,
            signal: run.signal, onJobId: (value) => { jobId = value; void run.attachJob(value); } });
        } catch (failure) {
          if (run.signal?.aborted) throw failure;
          result = { ok: false, stderr: String(failure), stdout: '', exitCode: null, durationMs: 0 };
        }
        await stage('collect', { method: method.id, config, jobId, runResult: result });
      }
      if (!prepared.evaluation_complete || request.methods.some((method) => !completed.includes(method) && !recordedBlocked.includes(method))) {
        await stage('evaluate', { methods: request.methods });
      } else {
        await run.appendLog('Reusing the saved common evaluation and plots; refreshing the result presentation.');
      }
      const report = await stage('report');
      output = report.output as ToolOutput;
      outputFiles = report.outputFiles as RunOutputFile[];
      if (Number(report.blockedCount) > 0) error = `${report.blockedCount} requested method(s) could not complete. See the exported diagnostics.`;
    } catch (failure) {
      error = String(failure);
      await run.appendLog(error, 'stderr', 'error');
    }
    await run.finalize(run.isCancelled() ? 'cancelled' : error ? 'error' : 'done', {
      id, tool: LIATIR_SINGLE_CELL_STUDY_ID, label, inputs: [], params: { ...request },
      startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt,
      output, outputFiles, sideEffects: [], error,
    });
  }
  // The run is owned by the execution store, not by the route's component lifetime.
  void execute().catch((failure) => { console.error('Study finalization failed', failure); });
  return id;
}
