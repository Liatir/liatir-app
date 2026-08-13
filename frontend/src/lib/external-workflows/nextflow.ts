import type {
  JsonValue,
  LiatirExternalWorkflowDefinition,
  LiatirExternalWorkflowRunProvenance,
  LiatirExternalWorkflowTaskSummary,
  LiatirExecutionIdentity,
} from '@liatir/core';
import { assertLiatirExternalWorkflowDefinition } from '@liatir/core';
import { liatir } from '$lib/api';
import { isRunCancelled, throwIfRunCancelled } from '$lib/pipeline/cancellation';
import type { RunOutputFile } from '$lib/types/pipeline';
import type { ToolOutput } from '$lib/types/tool-output';
import { runNativeTool } from '$lib/utils/native-tool';

export interface ExternalWorkflowResumeSource {
  runId: string;
  sessionId: string;
  workDirectory: string;
}

export interface ExternalWorkflowRunContext {
  execution: LiatirExecutionIdentity;
  label: string;
  startedAt: number;
  signal?: AbortSignal;
  onJobId?: (jobId: string) => void;
  resume?: ExternalWorkflowResumeSource;
  metadata?: Record<string, JsonValue>;
}

export interface ExternalWorkflowStepResult {
  outputFiles: RunOutputFile[];
  output: ToolOutput;
  metrics: Record<string, number>;
  values: Record<string, JsonValue>;
  provenance: LiatirExternalWorkflowRunProvenance;
  executionEvidence: Record<string, JsonValue>;
}

export class ExternalWorkflowRunError extends Error {
  readonly result: ExternalWorkflowStepResult;

  constructor(message: string, result: ExternalWorkflowStepResult) {
    super(message);
    this.name = 'ExternalWorkflowRunError';
    this.result = result;
  }
}

interface PreparedRunLayout {
  runDirectory: string;
  launchDirectory: string;
  workDirectory: string;
  outputDirectory: string;
  sourceSnapshot?: string | null;
  sourceMainScript?: string | null;
  sourceSnapshotSha256?: string | null;
  stagedConfigFile?: string | null;
  configSha256?: string | null;
  stagedInputs: Array<{
    key: string;
    originalPath: string;
    stagedPath: string;
    sizeBytes: number;
    sha256: string;
  }>;
  paramsFile: string;
  logFile: string;
  traceFile: string;
  reportFile: string;
  timelineFile: string;
  dagFile: string;
}

interface CollectedOutput {
  key: string;
  path: string;
  sizeBytes: number;
  sha256: string;
}

interface DependencyCheck {
  available: boolean;
  binary: string;
  path: string | null;
  version: string | null;
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function booleanValue(value: unknown, key: string): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  throw new Error(`${key} must be true or false.`);
}

/** Convert UI/pipeline strings into the one JSON params contract sent to Nextflow. */
export function resolveExternalWorkflowParameters(
  definition: LiatirExternalWorkflowDefinition,
  values: Record<string, unknown>,
): { scalars: Record<string, JsonValue>; inputFiles: Array<{ key: string; path: string }> } {
  assertLiatirExternalWorkflowDefinition(definition);
  const scalars: Record<string, JsonValue> = {};
  const inputFiles: Array<{ key: string; path: string }> = [];

  for (const input of definition.inputs) {
    const value = values[input.key];
    if (missing(value)) {
      if (input.required) throw new Error(`${input.label} is required.`);
      continue;
    }
    inputFiles.push({ key: input.key, path: String(value) });
  }

  for (const parameter of definition.parameters) {
    const candidate = missing(values[parameter.key]) ? parameter.default : values[parameter.key];
    if (missing(candidate)) {
      if (parameter.required) throw new Error(`${parameter.label} is required.`);
      continue;
    }
    if (parameter.type === 'number') {
      const parsed = typeof candidate === 'number' ? candidate : Number(String(candidate));
      if (!Number.isFinite(parsed)) throw new Error(`${parameter.label} must be a finite number.`);
      scalars[parameter.key] = parsed;
    } else if (parameter.type === 'boolean') {
      scalars[parameter.key] = booleanValue(candidate, parameter.label);
    } else {
      scalars[parameter.key] = String(candidate);
    }
  }

  return { scalars, inputFiles };
}

export interface BuildNextflowArgsInput {
  definition: LiatirExternalWorkflowDefinition;
  layout: PreparedRunLayout;
  workDirectory?: string;
  resumeSessionId?: string;
}

/** Pure command builder kept separate so option ordering is regression-tested. */
export function buildNextflowArgs(input: BuildNextflowArgsInput): string[] {
  const { definition, layout } = input;
  const args = ['-log', layout.logFile];
  if (layout.stagedConfigFile) args.push('-c', layout.stagedConfigFile);
  args.push('run');

  if (definition.source.kind === 'local') {
    if (!layout.sourceMainScript) throw new Error('Local workflow staging did not return a main script.');
    args.push(layout.sourceMainScript);
  } else {
    args.push(definition.source.repository, '-r', definition.source.revision);
    if (definition.source.mainScript) args.push('-main-script', definition.source.mainScript);
  }

  args.push(
    '-work-dir', input.workDirectory ?? layout.workDirectory,
    '-output-dir', layout.outputDirectory,
    '-params-file', layout.paramsFile,
    '-with-trace', layout.traceFile,
    '-with-report', layout.reportFile,
    '-with-timeline', layout.timelineFile,
    '-with-dag', layout.dagFile,
  );
  if (definition.nextflow?.profile?.trim()) {
    args.push('-profile', definition.nextflow.profile.trim());
  }
  if (definition.nextflow?.entryWorkflow?.trim()) {
    args.push('-entry', definition.nextflow.entryWorkflow.trim());
  }
  if (input.resumeSessionId) args.push('-resume', input.resumeSessionId);
  return args;
}

export function parseNextflowTrace(text: string): LiatirExternalWorkflowTaskSummary[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((header) => header.trim().toLowerCase());
  const index = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((value) => value >= 0) ?? -1;
  const processIndex = index('process', 'name');
  const nameIndex = index('name');
  const statusIndex = index('status');
  const exitIndex = index('exit');
  const durationIndex = index('duration', 'realtime');
  const workDirectoryIndex = index('workdir', 'work_dir');

  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const process = cells[processIndex] || cells[nameIndex] || 'Nextflow process';
    const parsedExit = exitIndex >= 0 && cells[exitIndex] !== '' ? Number(cells[exitIndex]) : null;
    return {
      process,
      status: statusIndex >= 0 ? (cells[statusIndex] || 'UNKNOWN') : 'UNKNOWN',
      ...(parsedExit !== null && Number.isFinite(parsedExit) ? { exitCode: parsedExit } : {}),
      ...(durationIndex >= 0 && cells[durationIndex] ? { duration: cells[durationIndex] } : {}),
      ...(workDirectoryIndex >= 0 && cells[workDirectoryIndex]
        ? { workDirectory: cells[workDirectoryIndex] }
        : {}),
    };
  });
}

export function parseNextflowSessionId(history: string): string | undefined {
  const matches = history.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi);
  return matches?.at(-1);
}

function commandForDisplay(command: string[]): string {
  return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function workflowOutput(
  definition: LiatirExternalWorkflowDefinition,
  provenance: LiatirExternalWorkflowRunProvenance,
): ToolOutput {
  const completedTasks = provenance.tasks.filter((task) => task.status.toUpperCase() === 'COMPLETED').length;
  const failedTasks = provenance.tasks.filter((task) => task.status.toUpperCase() === 'FAILED').length;
  const sections: ToolOutput['sections'] = [
    {
      type: 'stats',
      cols: 4,
      items: [
        { label: 'Engine status', value: provenance.finalStatus },
        { label: 'Processes', value: provenance.tasks.length },
        { label: 'Completed', value: completedTasks },
        { label: 'Failed', value: failedTasks },
      ],
    },
    {
      type: 'table',
      label: 'Run provenance',
      headers: ['Field', 'Value'],
      rows: [
        ['Definition', definition.name],
        ['Definition ID', definition.id],
        ['Engine', `Nextflow${provenance.engineVersion ? ` · ${provenance.engineVersion}` : ''}`],
        ['Java', provenance.javaVersion ?? 'Unknown'],
        ['Source', definition.source.kind === 'local' ? (provenance.locations.sourceSnapshot ?? 'Local snapshot') : definition.source.repository],
        ['Revision', definition.source.kind === 'repository' ? definition.source.revision : (provenance.sourceSnapshotSha256 ?? 'Unknown')],
        ['Profile', provenance.profile ?? 'Default'],
        ['Config digest', provenance.configSha256 ?? 'Default configuration'],
        ['Platform', `${provenance.platform} · ${provenance.architecture}`],
        ['Nextflow log', provenance.locations.logFile],
        ['Trace', provenance.locations.traceFile],
        ['Report', provenance.locations.reportFile],
        ['Timeline', provenance.locations.timelineFile],
        ['Work directory', provenance.locations.workDirectory],
        ['Command', commandForDisplay(provenance.command)],
      ],
    },
  ];

  if (provenance.outputs.length > 0) {
    sections.push({
      type: 'table',
      label: 'Declared outputs',
      headers: ['Output', 'Size', 'SHA-256', 'Path'],
      rows: provenance.outputs.map((output) => [
        definition.outputs.find((candidate) => candidate.key === output.key)?.label ?? output.key,
        output.sizeBytes,
        output.sha256,
        output.path,
      ]),
    });
  }
  if (provenance.tasks.length > 0) {
    sections.push({
      type: 'table',
      label: 'Nextflow processes',
      headers: ['Process', 'Status', 'Exit', 'Duration'],
      rows: provenance.tasks.map((task) => [
        task.process,
        task.status,
        task.exitCode ?? '',
        task.duration ?? '',
      ]),
    });
  }
  return { sections };
}

async function readTextIfPresent(path: string): Promise<string> {
  const api = liatir();
  if (!api) return '';
  try {
    return await api.invoke('lia_read_file_text', { path }) as string;
  } catch {
    return '';
  }
}

function resultFromProvenance(
  definition: LiatirExternalWorkflowDefinition,
  provenance: LiatirExternalWorkflowRunProvenance,
): ExternalWorkflowStepResult {
  const byKey = new Map(provenance.outputs.map((output) => [output.key, output]));
  const outputFiles: RunOutputFile[] = definition.outputs.flatMap((declaration) => {
    const output = byKey.get(declaration.key);
    return output ? [{
      label: declaration.label,
      path: output.path,
      ext: declaration.ext.replace(/^\./, ''),
      size: output.sizeBytes,
      fieldKey: declaration.key,
      mediaType: declaration.mediaType,
    }] : [];
  });
  const completedTasks = provenance.tasks.filter((task) => task.status.toUpperCase() === 'COMPLETED').length;
  const failedTasks = provenance.tasks.filter((task) => task.status.toUpperCase() === 'FAILED').length;
  return {
    outputFiles,
    output: workflowOutput(definition, provenance),
    metrics: {
      processes: provenance.tasks.length,
      completedProcesses: completedTasks,
      failedProcesses: failedTasks,
    },
    values: Object.fromEntries(provenance.outputs.map((output) => [output.key, output.path])),
    provenance,
    executionEvidence: {
      externalWorkflow: provenance as unknown as JsonValue,
    },
  };
}

/**
 * Shared Nextflow adapter used unchanged by standalone runs and pipeline nodes.
 * It creates one workflow-level Job; engine processes remain nested trace rows.
 */
export async function runExternalWorkflowDefinition(
  definition: LiatirExternalWorkflowDefinition,
  values: Record<string, unknown>,
  onLog: (line: string) => void,
  context: ExternalWorkflowRunContext,
): Promise<ExternalWorkflowStepResult> {
  assertLiatirExternalWorkflowDefinition(definition);
  const api = liatir();
  if (!api) throw new Error('Liatir API not available.');
  if (context.execution.runKind !== 'external-workflow') {
    throw new Error('External Workflow adapter requires an External Workflow Run identity.');
  }
  throwIfRunCancelled(context.signal);

  const dependencyChecks = await api.deps.checkMany(['nextflow', 'java']) as DependencyCheck[];
  const nextflow = dependencyChecks.find((item) => item.binary === 'nextflow');
  const java = dependencyChecks.find((item) => item.binary === 'java');
  const missingDependencies = dependencyChecks.filter((item) => !item.available).map((item) => item.binary);
  if (missingDependencies.length > 0) {
    throw new Error(`Install ${missingDependencies.join(' and ')} and make it available on PATH before running this External Workflow.`);
  }

  const resolved = resolveExternalWorkflowParameters(definition, values);
  const sourceMainScript = definition.source.kind === 'local'
    ? definition.source.mainScriptPath
    : undefined;
  const layout = await api.externalWorkflows.prepareRun({
    workspaceId: context.execution.workspaceId,
    definitionId: definition.id,
    runId: context.execution.runId,
    sourceMainScript,
    inputFiles: resolved.inputFiles,
    configFile: definition.nextflow?.configFilePath,
  }) as PreparedRunLayout;
  throwIfRunCancelled(context.signal);

  const parameters: Record<string, JsonValue> = { ...resolved.scalars };
  for (const input of layout.stagedInputs) parameters[input.key] = input.stagedPath;
  parameters[definition.outputDirectoryParameter] = layout.outputDirectory;
  await api.invoke('lia_write_file_path', {
    path: layout.paramsFile,
    content: JSON.stringify(parameters, null, 2),
  });

  const actualWorkDirectory = context.resume?.workDirectory ?? layout.workDirectory;
  const args = buildNextflowArgs({
    definition,
    layout,
    workDirectory: actualWorkDirectory,
    resumeSessionId: context.resume?.sessionId,
  });
  const command = ['nextflow', ...args];
  onLog(`$ ${commandForDisplay(command)}`);

  let jobId = '';
  let exitCode: number | null = null;
  let engineSucceeded = false;
  let engineMessage = '';
  let cancelled = false;
  try {
    const result = await runNativeTool(
      'nextflow',
      args,
      (line) => { if (line.trim()) onLog(line); },
      (line) => { if (line.trim()) onLog(line); },
      {
        cwd: layout.launchDirectory,
        label: context.label,
        kind: 'external-workflow',
        metadata: {
          ...context.metadata,
          externalWorkflowDefinitionId: definition.id,
          sourceKind: definition.source.kind,
          ...(definition.source.kind === 'repository' ? { sourceRevision: definition.source.revision } : {}),
        },
        execution: context.execution,
        signal: context.signal,
        onSpawn: (id) => {
          jobId = id;
          context.onJobId?.(id);
        },
      },
    );
    jobId = result.jobId;
    exitCode = result.exitCode;
    engineSucceeded = result.ok;
    engineMessage = result.stderr.trim() || `Nextflow exited with code ${result.exitCode ?? 'unknown'}.`;
  } catch (error) {
    cancelled = isRunCancelled(error, context.signal);
    engineMessage = cancelled
      ? 'External Workflow run was cancelled.'
      : (error instanceof Error ? error.message : String(error));
  }

  let collected: CollectedOutput[] = [];
  let collectionError = '';
  if (engineSucceeded) {
    try {
      collected = await api.externalWorkflows.collectOutputs({
        workspaceId: context.execution.workspaceId,
        definitionId: definition.id,
        runId: context.execution.runId,
        outputs: definition.outputs.map((output) => ({
          key: output.key,
          relativePath: output.relativePath,
        })),
      }) as CollectedOutput[];
    } catch (error) {
      collectionError = error instanceof Error ? error.message : String(error);
    }
  }

  const [trace, history, appInfo] = await Promise.all([
    readTextIfPresent(layout.traceFile),
    readTextIfPresent(`${layout.launchDirectory}/.nextflow/history`),
    api.desktop.app.info(),
  ]);
  const endedAt = Date.now();
  const finalStatus: LiatirExternalWorkflowRunProvenance['finalStatus'] = cancelled
    ? 'cancelled'
    : engineSucceeded && !collectionError ? 'done' : 'error';
  const sessionId = parseNextflowSessionId(history);
  const provenance: LiatirExternalWorkflowRunProvenance = {
    schemaVersion: 1,
    definitionId: definition.id,
    definitionUpdatedAt: definition.updatedAt,
    engine: 'nextflow',
    engineVersion: nextflow?.version ?? null,
    javaVersion: java?.version ?? null,
    source: definition.source,
    ...(layout.sourceSnapshotSha256 ? { sourceSnapshotSha256: layout.sourceSnapshotSha256 } : {}),
    ...(layout.configSha256 ? { configSha256: layout.configSha256 } : {}),
    ...(definition.nextflow?.profile ? { profile: definition.nextflow.profile } : {}),
    ...(definition.nextflow?.entryWorkflow ? { entryWorkflow: definition.nextflow.entryWorkflow } : {}),
    platform: appInfo.os,
    architecture: appInfo.arch,
    command,
    parameters,
    inputs: layout.stagedInputs,
    locations: {
      runDirectory: layout.runDirectory,
      launchDirectory: layout.launchDirectory,
      workDirectory: actualWorkDirectory,
      outputDirectory: layout.outputDirectory,
      ...(layout.sourceSnapshot ? { sourceSnapshot: layout.sourceSnapshot } : {}),
      paramsFile: layout.paramsFile,
      logFile: layout.logFile,
      traceFile: layout.traceFile,
      reportFile: layout.reportFile,
      timelineFile: layout.timelineFile,
      dagFile: layout.dagFile,
    },
    jobId,
    ...(sessionId ? { sessionId } : {}),
    exitCode,
    finalStatus,
    ...(context.resume ? { resumedFromRunId: context.resume.runId } : {}),
    tasks: parseNextflowTrace(trace),
    outputs: collected,
    startedAt: context.startedAt,
    endedAt,
  };
  const stepResult = resultFromProvenance(definition, provenance);
  if (finalStatus !== 'done') {
    onLog(`Nextflow ${finalStatus}. Engine log: ${layout.logFile}`);
    onLog(`Trace: ${layout.traceFile} · Report: ${layout.reportFile} · Timeline: ${layout.timelineFile}`);
    throw new ExternalWorkflowRunError(
      collectionError || engineMessage || 'External Workflow run failed.',
      stepResult,
    );
  }
  return stepResult;
}

export function externalWorkflowProvenanceFromParams(
  params: Record<string, unknown> | undefined,
): LiatirExternalWorkflowRunProvenance | null {
  const candidate = params?.externalWorkflow;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const provenance = candidate as Partial<LiatirExternalWorkflowRunProvenance>;
  if (
    provenance.schemaVersion !== 1 ||
    provenance.engine !== 'nextflow' ||
    typeof provenance.definitionId !== 'string' ||
    !provenance.locations || typeof provenance.locations.workDirectory !== 'string'
  ) return null;
  return provenance as LiatirExternalWorkflowRunProvenance;
}
