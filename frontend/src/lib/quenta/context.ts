/**
 * Turns the app's live state into the documents Quenta (the assistant) can retrieve over.
 *
 * Every part of the app the user might ask about — the workspace, their pipelines, their results,
 * running jobs, API connections, installed AI Models — is flattened into a uniform document with a
 * title, a locator (where to find it in the UI) and plain-text content. Retrieval then ranks these;
 * this file's job is only to produce them.
 *
 * The central idea is **focus**. When the user asks about one specific thing ("why did this run
 * fail?"), passing that entity as the focus does two things at once: everything unrelated is left
 * out, and the focused entity is included at roughly double the detail budget. Breadth is what you
 * want for an open question; depth is what you want for a pointed one, and the context window will
 * not accommodate both.
 *
 * Hence the size caps threaded through this file: they are not arbitrary tidiness, they are what
 * keeps a single 400 MB tool output from consuming the entire prompt.
 */
import { LIATIR_QUENTA_KNOWLEDGE } from './knowledge';
import { syncedReferenceDocuments } from './knowledge-sync';
import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
import { apiConnections } from '$lib/stores/apiConnections.svelte';
import { aiModelsStore } from '$lib/stores/aiModels.svelte';
import { jobsStore, type JobBufferedOutput, type JobEntry } from '$lib/stores/jobs.svelte';
import { pipelineStore, type SavedPipeline } from '$lib/stores/pipeline.svelte';
import { workspaceStore } from '$lib/stores/workspace.svelte';
import { compact, jsonSummary, summarizeToolOutput } from './output-summary';
import type { LiatirQuentaContextDocument, LiatirQuentaFocus } from '@liatir/core';

/** Logs are read from the tail: the end of a failed run is what explains it. */
const MAX_LOG_LINES = 80;
const MAX_RECENT_RUNS = 12;
const MAX_RECENT_JOBS = 15;

/** Renders one `Label: value` line, or nothing at all when the value is absent. */
function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return `${label}: ${String(value)}`;
}

/**
 * Finishes a document by deriving its excerpt.
 *
 * The excerpt is what retrieval matches and ranks against, so every document must have one —
 * generating it here rather than at each call site means none can be built without it.
 */
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

/**
 * Describes a pipeline as text: its nodes, and the edges between them.
 *
 * The edge list is what makes this useful — it is the graph's actual structure, so the assistant
 * can reason about what feeds what, rather than just seeing an unordered bag of steps.
 */
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

/**
 * One finished analysis run, as a document: what was run, on what, with what result.
 *
 * `focused` roughly doubles every size budget below. A run the user is actively asking about
 * deserves its full parameters, output and log; a run merely included for background does not, and
 * would crowd out everything else.
 */
async function resultDocument(run: AnalysisRunMeta, focused: boolean): Promise<LiatirQuentaContextDocument> {
  // Output and log live in separate files; fetch them together rather than in sequence.
  const [output, log] = await Promise.all([
    analysisRuns.loadOutput(run.id),
    analysisRuns.loadLog(run.id),
  ]);
  // The tail, not the head: errors surface at the end of a log.
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
    jsonSummary(run.params, focused ? 4_000 : 2_000),
    '',
    'Output files:',
    formatFiles(run.outputFiles),
    '',
    'Structured output:',
    summarizeToolOutput(output, focused ? 8_000 : 4_000),
    '',
    'Recent log lines:',
    logLines.length ? compact(logLines.join('\n'), focused ? 4_000 : 3_000) : 'No run log recorded.',
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

/**
 * One job (a process Liatir started), as a document.
 *
 * The output of a *running* job is deliberately not fetched unless it is the focus: it is still
 * growing, reading it costs work on every context build, and a snapshot of a half-finished stream
 * is rarely what answers the question. If the user is asking about that specific job, of course, it
 * is exactly what they want.
 */
async function jobDocument(job: JobEntry, focused: boolean): Promise<LiatirQuentaContextDocument> {
  let output: JobBufferedOutput | null = null;
  if (focused || job.status.type !== 'running') {
    try {
      output = await jobsStore.getOutput(job.id);
    } catch {
      // A job whose output cannot be read is still worth describing from its metadata alone.
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
      line('Description', model.description),
      line('Enabled', model.enabled !== false),
      line('Updated', model.updatedAt ? new Date(model.updatedAt).toISOString() : null),
      line('Error', model.error),
    ].filter((part): part is string => part !== null).join('\n'),
    updatedAt: model.updatedAt,
  }));
}

/**
 * Assembles everything Quenta may retrieve over for this question.
 *
 * Without a focus, this is a wide sweep of the app's state: knowledge base, workspace, pipelines,
 * recent results, recent jobs, API connections and AI Models. With a focus, it narrows hard to the
 * one entity in question (plus the always-present knowledge and workspace), at greater depth.
 *
 * The stores are initialised first, since a store that has not loaded yet reports nothing and would
 * silently yield an empty context. Only what the focus actually needs is initialised — no point
 * loading every pipeline to answer a question about one job.
 */
export async function buildQuentaContextDocuments(
  focus?: LiatirQuentaFocus,
): Promise<LiatirQuentaContextDocument[]> {
  await workspaceStore.init();
  if (focus?.kind === 'result') {
    await analysisRuns.init();
  } else if (focus?.kind === 'job') {
    await jobsStore.refresh();
  } else {
    // allSettled, not all: one store failing to load must degrade the context, not abort the whole
    // build and leave the assistant with nothing.
    await Promise.allSettled([
      analysisRuns.init(),
      pipelineStore.init(),
      apiConnections.init(),
      aiModelsStore.init(),
      jobsStore.refresh(),
    ]);
  }

  // Always present, regardless of focus: the native knowledge base (how Liatir works), the synced
  // reference corpora (curated bioinformatics knowledge + the Liatir docs), and the current
  // workspace. Together they are what lets the assistant interpret anything else.
  const documents: LiatirQuentaContextDocument[] = [
    ...LIATIR_QUENTA_KNOWLEDGE,
    ...syncedReferenceDocuments(),
    workspaceDocument(),
  ];

  // The unsaved draft the user is editing right now. Included even though it has no saved ID,
  // because "the pipeline I am looking at" is usually what a question is about.
  if (!focus && (pipelineStore.currentNodes.length || pipelineStore.currentEdges.length)) {
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

  if (!focus) {
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
  }

  // Three cases, and the middle one is the point: focused on *this* result -> only it (in full
  // detail); focused on something else entirely -> no results at all; no focus -> the recent ones.
  const focusedRunId = focus?.kind === 'result' ? focus.entityId : null;
  const recentRuns = analysisRuns.runs.slice(0, MAX_RECENT_RUNS);
  const runs = focusedRunId
    ? analysisRuns.runs.filter((run) => run.id === focusedRunId)
    : focus
      ? []
      : recentRuns;
  documents.push(...await Promise.all(runs.map((run) => resultDocument(run, run.id === focusedRunId))));

  // Same three cases for jobs. Sorted newest-first before truncating, so "recent" really is recent.
  const focusedJobId = focus?.kind === 'job' ? focus.entityId : null;
  const recentJobs = [...jobsStore.jobs].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, MAX_RECENT_JOBS);
  const jobs = focusedJobId
    ? jobsStore.jobs.filter((job) => job.id === focusedJobId)
    : focus
      ? []
      : recentJobs;
  documents.push(...await Promise.all(jobs.map((job) => jobDocument(job, job.id === focusedJobId))));

  // Background material: useful for an open question, pure noise when the user is asking about one
  // specific run or job.
  if (!focus) {
    documents.push(...apiDocuments());
    documents.push(...aiModelDocuments());
  }

  return documents;
}

/**
 * The document IDs that must survive retrieval ranking.
 *
 * When the user asks about a specific entity, that entity's document has to reach the prompt even
 * if its text happens to score poorly against the question — being asked about *is* its relevance.
 * The IDs match the `${kind}:${id}` scheme the builders above use.
 */
export function requiredContextIdsForFocus(focus?: LiatirQuentaFocus): string[] {
  if (!focus) return [];
  return [`${focus.kind}:${focus.entityId}`];
}
