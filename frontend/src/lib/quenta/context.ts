import { LIATIR_QUENTA_KNOWLEDGE } from './knowledge';
import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
import { apiConnections } from '$lib/stores/apiConnections.svelte';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
import { pipelineStore, type SavedPipeline } from '$lib/stores/pipeline.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { compact, jsonSummary, summarizeToolOutput } from './output-summary';
import type { LiatirQuentaContextDocument, LiatirQuentaFocus } from '@liatir/core';

const MAX_LOG_LINES = 80;
const MAX_RECENT_RUNS = 24;
const MAX_RECENT_JOBS = 30;

function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return `${label}: ${String(value)}`;
}

function doc(input: LiatirQuentaContextDocument): LiatirQuentaContextDocument {
  return {
    ...input,
    excerpt: input.excerpt ?? compact(input.content, 260),
  };
}

function formatFiles(files: AnalysisRunMeta['outputFiles']): string {
  if (!files?.length) return 'No output files recorded.';
  return files
    .map((file) => {
      const fields = [
        file.label,
        file.ext ? `.${file.ext}` : null,
        file.size != null ? `${file.size} bytes` : null,
        file.path ? `path=${file.path}` : null,
      ].filter(Boolean);
      return `- ${fields.join(' · ')}`;
    })
    .join('\n');
}

function pipelineNodeSummary(pipeline: SavedPipeline): string {
  const nodes = pipeline.nodes.map((node) => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const labelValue = typeof data.label === 'string' && data.label.trim() ? data.label : node.type ?? 'node';
    const stepId = typeof data.stepId === 'string' ? data.stepId : undefined;
    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    const pipelineId = typeof data.pipelineId === 'string' ? data.pipelineId : undefined;
    const inputs = data.inputs && typeof data.inputs === 'object'
      ? Object.keys(data.inputs as Record<string, unknown>)
      : [];
    return `- ${node.id}: ${labelValue}${stepId ? ` (${stepId})` : ''}${requestId ? ` request=${requestId}` : ''}${pipelineId ? ` subPipeline=${pipelineId}` : ''}${inputs.length ? ` inputs=${inputs.join(',')}` : ''}`;
  });
  const edges = pipeline.edges.map((edge) => `- ${edge.source} -> ${edge.target}`);
  return [
    `Pipeline ID: ${pipeline.id}`,
    `Updated: ${new Date(pipeline.updatedAt).toISOString()}`,
    `Nodes (${pipeline.nodes.length}):`,
    nodes.join('\n') || 'No nodes.',
    `Edges (${pipeline.edges.length}):`,
    edges.join('\n') || 'No edges.',
  ].join('\n');
}

async function resultDocument(run: AnalysisRunMeta, focused: boolean): Promise<LiatirQuentaContextDocument> {
  const [output, log] = await Promise.all([
    analysisRuns.loadOutput(run.id),
    analysisRuns.loadLog(run.id),
  ]);
  const logLines = (log ?? []).slice(-MAX_LOG_LINES);
  const content = [
    line('Run ID', run.id),
    line('Tool', run.tool),
    line('Label', run.label),
    line('Status', run.status),
    line('Started', new Date(run.startedAt).toISOString()),
    line('Ended', new Date(run.endedAt).toISOString()),
    line('Duration ms', run.durationMs),
    line('Error', run.error),
    '',
    'Inputs:',
    run.inputs.length ? run.inputs.map((input) => `- ${input}`).join('\n') : 'No inputs recorded.',
    '',
    'Parameters:',
    jsonSummary(run.params, focused ? 8_000 : 2_000),
    '',
    'Output files:',
    formatFiles(run.outputFiles),
    '',
    'Structured output:',
    summarizeToolOutput(output, focused ? 14_000 : 4_000),
    '',
    'Recent log lines:',
    logLines.length ? compact(logLines.join('\n'), focused ? 10_000 : 3_000) : 'No run log recorded.',
  ].filter((part): part is string => part !== null).join('\n');

  return doc({
    id: `result:${run.id}`,
    sourceKind: 'result',
    title: `${run.label} (${run.status})`,
    locator: `Results / ${run.tool} / ${run.id}`,
    content,
    updatedAt: run.endedAt,
  });
}

async function jobDocument(job: JobEntry, focused: boolean): Promise<LiatirQuentaContextDocument> {
  let output: JobBufferedOutput | null = null;
  if (focused || job.status.type !== 'running') {
    try {
      output = await jobsStore.getOutput(job.id);
    } catch {
      output = null;
    }
  }
  const content = [
    line('Job ID', job.id),
    line('Kind', job.kind),
    line('Label', job.label),
    line('Command', [job.cmd, ...job.args].join(' ')),
    line('Status', job.status.type),
    line('Exit code', 'exitCode' in job.status ? job.status.exitCode : null),
    line('Started', new Date(job.startedAtMs).toISOString()),
    line('Ended', job.endedAtMs ? new Date(job.endedAtMs).toISOString() : null),
    '',
    'Metadata:',
    jsonSummary(job.metadata ?? {}, focused ? 8_000 : 2_000),
    '',
    'Buffered stdout:',
    output?.stdout?.length ? compact(output.stdout.slice(-MAX_LOG_LINES).join('\n'), focused ? 8_000 : 2_000) : 'No stdout available.',
    '',
    'Buffered stderr:',
    output?.stderr?.length ? compact(output.stderr.slice(-MAX_LOG_LINES).join('\n'), focused ? 8_000 : 2_000) : 'No stderr available.',
  ].filter((part): part is string => part !== null).join('\n');

  return doc({
    id: `job:${job.id}`,
    sourceKind: 'job',
    title: job.label?.trim() || job.cmd,
    locator: `Jobs / ${job.id}`,
    content,
    updatedAt: job.endedAtMs ?? job.startedAtMs,
  });
}

function workspaceDocument(): LiatirQuentaContextDocument {
  const workspace = workspaceStore.active;
  return doc({
    id: `workspace:${workspaceStore.activeId ?? 'none'}`,
    sourceKind: 'workspace',
    title: workspace?.name ?? 'No active workspace',
    locator: 'Workspace',
    content: [
      line('Workspace ID', workspaceStore.activeId),
      line('Workspace name', workspace?.name),
      line('Sandbox mode', workspaceStore.isSandboxMode),
      line('Known workspaces', workspaceStore.workspaces.map((item) => item.name).join(', ')),
    ].filter((part): part is string => part !== null).join('\n'),
  });
}

function apiDocuments(): LiatirQuentaContextDocument[] {
  return [
    ...apiConnections.collections.map((collection) => doc({
      id: `api-connector:collection:${collection.id}`,
      sourceKind: 'api-connector',
      title: collection.name,
      locator: `API Connector / Collection / ${collection.id}`,
      content: [
        line('Collection ID', collection.id),
        line('Name', collection.name),
        line('Auth type', collection.auth.type),
        line('Requests', apiConnections.requestsInCollection(collection.id).map((request) => request.name).join(', ')),
      ].filter((part): part is string => part !== null).join('\n'),
      updatedAt: collection.createdAt,
    })),
    ...apiConnections.requests.map((request) => doc({
      id: `api-connector:request:${request.id}`,
      sourceKind: 'api-connector',
      title: request.name,
      locator: `API Connector / Request / ${request.id}`,
      content: [
        line('Request ID', request.id),
        line('Name', request.name),
        line('Method', request.method),
        line('URL', request.url),
        line('Use as', request.useAs),
        line('Last status', request.lastResponse ? `${request.lastResponse.status} ${request.lastResponse.statusText}` : null),
        line('Last response at', request.lastResponse ? new Date(request.lastResponse.timestamp).toISOString() : null),
        '',
        'Output schema:',
        jsonSummary(request.outputSchema ?? {}, 2_000),
        '',
        'Last response body:',
        request.lastResponse?.body ? compact(request.lastResponse.body, 3_000) : 'No response body recorded.',
      ].filter((part): part is string => part !== null).join('\n'),
      updatedAt: request.updatedAt,
    })),
  ];
}

function aiModelDocuments(): LiatirQuentaContextDocument[] {
  return aiModelsStore.models.map((model) => doc({
    id: `ai-model:${model.id}`,
    sourceKind: 'ai-model',
    title: model.name,
    locator: `AI Models / ${model.id}`,
    content: [
      line('Model ID', model.id),
      line('Name', model.name),
      line('Status', model.status),
      line('Runtime', model.runtime?.kind),
      line('Release stage', model.releaseStage),
      line('Description', model.description),
      line('Enabled', model.enabled !== false),
      line('Updated', model.updatedAt ? new Date(model.updatedAt).toISOString() : null),
      line('Error', model.error),
    ].filter((part): part is string => part !== null).join('\n'),
    updatedAt: model.updatedAt,
  }));
}

export async function buildQuentaContextDocuments(
  focus?: LiatirQuentaFocus,
): Promise<LiatirQuentaContextDocument[]> {
  await workspaceStore.init();
  await Promise.allSettled([
    analysisRuns.init(),
    pipelineStore.init(),
    apiConnections.init(),
    aiModelsStore.init(),
    jobsStore.refresh(),
  ]);

  const documents: LiatirQuentaContextDocument[] = [
    ...LIATIR_QUENTA_KNOWLEDGE,
    workspaceDocument(),
  ];

  if (pipelineStore.currentNodes.length || pipelineStore.currentEdges.length) {
    documents.push(doc({
      id: 'pipeline:current',
      sourceKind: 'pipeline',
      title: pipelineStore.pipelineName || 'Current pipeline draft',
      locator: 'Pipelines / Current draft',
      content: pipelineNodeSummary({
        id: pipelineStore.pipelineId ?? '__draft__',
        name: pipelineStore.pipelineName || 'Current pipeline draft',
        nodes: pipelineStore.currentNodes,
        edges: pipelineStore.currentEdges,
        updatedAt: Date.now(),
      }),
      updatedAt: Date.now(),
    }));
  }

  for (const pipeline of pipelineStore.savedPipelines) {
    documents.push(doc({
      id: `pipeline:${pipeline.id}`,
      sourceKind: 'pipeline',
      title: pipeline.name,
      locator: `Pipelines / ${pipeline.id}`,
      content: pipelineNodeSummary(pipeline),
      updatedAt: pipeline.updatedAt,
    }));
  }

  const focusedRunId = focus?.kind === 'result' ? focus.entityId : null;
  const recentRuns = analysisRuns.runs.slice(0, MAX_RECENT_RUNS);
  const runs = focusedRunId && !recentRuns.some((run) => run.id === focusedRunId)
    ? [
        ...analysisRuns.runs.filter((run) => run.id === focusedRunId),
        ...recentRuns,
      ]
    : recentRuns;
  documents.push(...await Promise.all(runs.map((run) => resultDocument(run, run.id === focusedRunId))));

  const focusedJobId = focus?.kind === 'job' ? focus.entityId : null;
  const recentJobs = [...jobsStore.jobs].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, MAX_RECENT_JOBS);
  const jobs = focusedJobId && !recentJobs.some((job) => job.id === focusedJobId)
    ? [
        ...jobsStore.jobs.filter((job) => job.id === focusedJobId),
        ...recentJobs,
      ]
    : recentJobs;
  documents.push(...await Promise.all(jobs.map((job) => jobDocument(job, job.id === focusedJobId))));

  documents.push(...apiDocuments());
  documents.push(...aiModelDocuments());

  return documents;
}

export function requiredContextIdsForFocus(focus?: LiatirQuentaFocus): string[] {
  if (!focus) return [];
  return [`${focus.kind}:${focus.entityId}`];
}
