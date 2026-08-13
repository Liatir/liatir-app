import { describe, expect, it, vi } from 'vitest';
import {
  LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
  type LiatirExternalWorkflowDefinition,
} from '@liatir/core';
vi.stubGlobal('$state', <T>(value: T) => value);

const {
  buildNextflowArgs,
  parseNextflowSessionId,
  parseNextflowTrace,
  resolveExternalWorkflowParameters,
} = await import('../../frontend/src/lib/external-workflows/nextflow');

function definition(
  source: LiatirExternalWorkflowDefinition['source'] = {
    kind: 'local',
    mainScriptPath: '/original/main.nf',
  },
): LiatirExternalWorkflowDefinition {
  return {
    schemaVersion: LIATIR_EXTERNAL_WORKFLOW_SCHEMA_VERSION,
    id: 'workflow-1',
    name: 'Fixture',
    description: '',
    engine: 'nextflow',
    source,
    inputs: [{ key: 'sample', label: 'Sample', required: true }],
    parameters: [
      { key: 'threshold', label: 'Threshold', type: 'number', default: 2 },
      { key: 'strict', label: 'Strict', type: 'boolean', default: false },
    ],
    outputs: [{ key: 'result', label: 'Result', relativePath: 'result.txt', ext: 'txt' }],
    outputDirectoryParameter: 'outdir',
    nextflow: { profile: 'standard', entryWorkflow: 'ANALYZE' },
    createdAt: 1,
    updatedAt: 1,
  };
}

const layout = {
  runDirectory: '/run',
  launchDirectory: '/run/launch',
  workDirectory: '/run/work',
  outputDirectory: '/run/outputs',
  sourceSnapshot: '/run/source',
  sourceMainScript: '/run/source/main.nf',
  sourceSnapshotSha256: 'a'.repeat(64),
  stagedConfigFile: '/run/config/nextflow.config',
  configSha256: 'b'.repeat(64),
  stagedInputs: [],
  paramsFile: '/run/engine/params.json',
  logFile: '/run/engine/nextflow.log',
  traceFile: '/run/engine/trace.txt',
  reportFile: '/run/engine/report.html',
  timelineFile: '/run/engine/timeline.html',
  dagFile: '/run/engine/dag.html',
};

describe('Nextflow External Workflow adapter', () => {
  it('coerces scalar params and keeps file inputs separate for native staging', () => {
    expect(resolveExternalWorkflowParameters(definition(), {
      sample: '/data/sample.txt',
      threshold: '4.5',
      strict: 'true',
    })).toEqual({
      scalars: { threshold: 4.5, strict: true },
      inputFiles: [{ key: 'sample', path: '/data/sample.txt' }],
    });
  });

  it('builds a local run with global config before the run command and explicit evidence paths', () => {
    const args = buildNextflowArgs({ definition: definition(), layout });
    expect(args.slice(0, 6)).toEqual([
      '-log', '/run/engine/nextflow.log',
      '-c', '/run/config/nextflow.config',
      'run', '/run/source/main.nf',
    ]);
    expect(args).toContain('-params-file');
    expect(args).toContain('-with-trace');
    expect(args).toContain('-with-report');
    expect(args).toContain('-with-timeline');
    expect(args).toContain('-with-dag');
    expect(args.slice(-4)).toEqual(['-profile', 'standard', '-entry', 'ANALYZE']);
  });

  it('pins a repository run and makes resume an explicit prior-session choice', () => {
    const args = buildNextflowArgs({
      definition: definition({
        kind: 'repository',
        repository: 'nf-core/rnaseq',
        revision: '3.21.0',
        mainScript: 'workflow/main.nf',
      }),
      layout: { ...layout, sourceMainScript: null, sourceSnapshot: null },
      workDirectory: '/prior/work',
      resumeSessionId: '55ea9d8c-1c3b-4cf2-9138-7fb37aeb0001',
    });
    expect(args).toEqual(expect.arrayContaining([
      'nf-core/rnaseq', '-r', '3.21.0', '-main-script', 'workflow/main.nf',
      '-work-dir', '/prior/work',
      '-resume', '55ea9d8c-1c3b-4cf2-9138-7fb37aeb0001',
    ]));
  });

  it('turns trace rows into nested process summaries and recovers the latest session id', () => {
    const trace = [
      'task_id\tprocess\tname\tstatus\texit\tduration\tworkdir',
      '1\tPREPARE\tPREPARE (sample)\tCOMPLETED\t0\t1.2s\t/work/aa',
      '2\tANALYZE\tANALYZE (sample)\tFAILED\t1\t2.3s\t/work/bb',
    ].join('\n');
    expect(parseNextflowTrace(trace)).toEqual([
      { process: 'PREPARE', status: 'COMPLETED', exitCode: 0, duration: '1.2s', workDirectory: '/work/aa' },
      { process: 'ANALYZE', status: 'FAILED', exitCode: 1, duration: '2.3s', workDirectory: '/work/bb' },
    ]);
    expect(parseNextflowSessionId([
      '2026-01-01\told\t11111111-1111-4111-8111-111111111111',
      '2026-01-02\tnew\t22222222-2222-4222-8222-222222222222',
    ].join('\n'))).toBe('22222222-2222-4222-8222-222222222222');
  });
});
