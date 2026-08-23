/**
 * The rule every run in Liatir is recorded by.
 *
 * A user must be able to open any run — a tool, a pipeline, a plugin, an AI Tool, an External
 * Workflow — and read what it actually did: the whole transcript, and every file it left on disk.
 * That was already the design (`LiatirFileArtifactRole` has had `intermediate` since artifacts were
 * introduced) and it was implemented in exactly one tool. Runs recorded only their declared outputs
 * and a display copy of their log, so a `fastp` report and five `bwa` index files sat on the user's
 * disk with nothing in the app admitting they existed.
 *
 * The rule now lives in `finalizeExecutionResult`, the single place a Result is committed, so it is
 * enforced rather than repeated. This file pins the two halves that are easy to quietly undo: the
 * transcript must come from the execution spine, and the declaration must stay mandatory.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const finalization = read('frontend/src/lib/execution/finalization.ts');
const analysisRuns = read('frontend/src/lib/stores/analysisRuns.svelte.ts');
const nativeTool = read('frontend/src/lib/utils/native-tool.ts');

/** Every path that commits a Result. Adding one without a `sideEffects` decision must not compile. */
const RUN_RECORDERS = [
  'frontend/src/routes/tools/qc/fastp/+page.svelte',
  'frontend/src/routes/tools/qc/fastqc/+page.svelte',
  'frontend/src/routes/tools/qc/seqkit/+page.svelte',
  'frontend/src/routes/tools/alignment/bwa/+page.svelte',
  'frontend/src/routes/tools/alignment/minimap2/+page.svelte',
  'frontend/src/routes/tools/alignment/samtools/+page.svelte',
  'frontend/src/routes/tools/alignment/samtools-faidx/+page.svelte',
  'frontend/src/routes/tools/variants/bcftools/+page.svelte',
  'frontend/src/routes/tools/variants/bcftools-filter/+page.svelte',
  'frontend/src/routes/tools/variants/snpeff/+page.svelte',
  'frontend/src/routes/tools/external-workflows/[id]/+page.svelte',
  'frontend/src/routes/plugins/[id]/+page.svelte',
  'frontend/src/routes/ai/[id]/+page.svelte',
  'frontend/src/lib/stores/pipeline.svelte.ts',
  'frontend/src/lib/api/direct-run.ts',
  'frontend/src/lib/ai/direct-run-finalizer.ts',
];

const runStorage = read('frontend/src/lib/execution/run-storage.ts');

/** Every screen that displays a past run, and so must let the user open it. */
const RUN_VIEWERS = [
  'frontend/src/routes/results/+page.svelte',
  'frontend/src/routes/tools/qc/fastp/+page.svelte',
  'frontend/src/routes/tools/qc/fastqc/+page.svelte',
  'frontend/src/routes/tools/qc/seqkit/+page.svelte',
  'frontend/src/routes/tools/alignment/bwa/+page.svelte',
  'frontend/src/routes/tools/alignment/minimap2/+page.svelte',
  'frontend/src/routes/tools/alignment/samtools/+page.svelte',
  'frontend/src/routes/tools/alignment/samtools-faidx/+page.svelte',
  'frontend/src/routes/tools/variants/bcftools/+page.svelte',
  'frontend/src/routes/tools/variants/bcftools-filter/+page.svelte',
  'frontend/src/routes/tools/variants/snpeff/+page.svelte',
  'frontend/src/routes/tools/external-workflows/[id]/+page.svelte',
  'frontend/src/routes/ai/[id]/+page.svelte',
];

describe('the recording rule', () => {
  it('makes the by-product declaration mandatory, with no default', () => {
    // `sideEffects?:` would defeat the whole thing — the field exists to be impossible to skip.
    expect(finalization).toContain('sideEffects: RunOutputFile[];');
    expect(finalization).not.toMatch(/sideEffects\?:/);
  });

  it('files by-products with an honest role instead of passing them off as results', () => {
    expect(finalization).toContain("role: file.role ?? 'intermediate' as const");
  });

  it('takes the transcript from the execution spine, not from the caller', () => {
    // The caller's array is a display transcript: filtered, capped, formatted for a terminal
    // widget. Preferring it — as `result.log ?? execution.logs` used to — keeps the prettier copy
    // and discards the complete one.
    expect(finalization).toContain('runTranscript(execution.logs');
    expect(finalization).not.toContain('result.log ?? execution.logs');
  });

  it('keeps stderr distinguishable once the streams are flattened into one list', () => {
    expect(finalization).toContain("entry.stream === 'stderr'");
  });

  it('records the command as spawned, so no caller has to narrate itself', () => {
    expect(nativeTool).toContain('`$ ${[cmd, ...args].join(\' \')}`');
  });
});

describe('an empty declaration is checked, not believed', () => {
  it('gives each run a directory of its own to be checked against', () => {
    // The old layout put every tool's files in one shared folder under run-prefixed names, and
    // pipeline steps in the user-facing Results folder shared by every run of that tool. Neither
    // could answer, by looking, what *this* run put there.
    expect(runStorage).toContain('export async function ensureRunOutputDir');
    expect(runStorage).toContain("const RUNS_DIR = 'runs'");
    // Scoped to the workspace, like the index that points into it: deleting a workspace has to
    // reclaim the files its runs produced.
    expect(runStorage).toContain('getDataPrefix()');
    expect(runStorage).toContain('`${runDirRel(runId)}/output`');
  });

  it('leaves no second way to place a run’s files', () => {
    // Liatir is unreleased, so the old layouts are deleted rather than kept for compatibility.
    const legacy = read('frontend/src/lib/utils/results.ts');
    expect(legacy).not.toContain('ensureResultsDir');
    expect(legacy).not.toContain('tool-outputs');
    for (const path of RUN_RECORDERS) {
      expect(read(path)).not.toContain('ensureResultsDir');
    }
  });

  it('writes the run’s own record before the index that points at it', () => {
    expect(finalization).toContain('await writeRunMetadata(');
    expect(finalization).toContain('await writeRunLog(run.id, execution.logs)');
  });

  it('keeps a pipeline’s steps in their own file, apart from its metadata', () => {
    const pipeline = read('frontend/src/lib/stores/pipeline.svelte.ts');
    expect(pipeline).toContain('writeRunSteps(pipelineRunId, pipelineStepsRecord(');
    // Flat, not nested: a step is an ordinary run, referenced by id.
    // What that file contains — order and connections — is covered in pipeline-steps-record.test.ts.
    expect(read('frontend/src/lib/execution/pipeline-steps.ts')).toContain('runId: state.executionRunId');
  });

  it('gives utility nodes an identity but no directory', () => {
    const pipeline = read('frontend/src/lib/stores/pipeline.svelte.ts');
    expect(read('frontend/src/lib/execution/pipeline-steps.ts')).toContain("kind === 'utility' && value");
    // Only a node that runs something asks for an output directory.
    expect(pipeline).toContain('ensureRunOutputDir(childIdentity.runId)');
  });

  it('records what is in that directory whether or not the caller mentioned it', () => {
    expect(finalization).toContain('undeclaredRunOutputs(await listRunOutputs(run.id)');
  });

  it('matches by filename, because path separators differ by platform', () => {
    // Declared paths are built with forward slashes; the enumeration returns the platform's own.
    // Comparing them directly would report every declared file as undeclared on Windows.
    expect(finalization).toContain("file.path.split(/[\\\\/]/).pop()");
  });

  it('treats a missing directory as a run that wrote nothing, not as a failure', () => {
    expect(runStorage).toContain('return [];');
  });

  it('has every file-writing tool write into its run directory', () => {
    for (const path of [
      'frontend/src/routes/tools/qc/fastp/+page.svelte',
      'frontend/src/routes/tools/alignment/bwa/+page.svelte',
      'frontend/src/routes/tools/alignment/minimap2/+page.svelte',
      'frontend/src/routes/tools/variants/bcftools-filter/+page.svelte',
      'frontend/src/routes/tools/variants/snpeff/+page.svelte',
    ]) {
      expect(read(path)).toContain('ensureRunOutputDir(runId)');
    }
  });
});

describe('nothing is deleted on Liatir’s own initiative', () => {
  it('keeps a run’s log for as long as the run itself', () => {
    // Logs used to be deleted after seven days while the run stayed, leaving old Results openable
    // and mute — and old runs are exactly the ones someone is trying to explain.
    expect(analysisRuns).not.toContain('LOG_TTL_MS');
  });

  it('no longer drops runs once the history grows long', () => {
    // A run now owns files the user made. A list growing is not a reason to destroy their work.
    expect(analysisRuns).not.toContain('MAX_RUNS');
  });

  it('offers the user an explicit prune instead', () => {
    expect(analysisRuns).toContain('async removeMany(');
    const resultsPage = read('frontend/src/routes/results/+page.svelte');
    expect(resultsPage).toContain('pruneOldRuns');
    // It must say what it is about to destroy, including what the Data library still points at.
    expect(resultsPage).toContain('dataFiles.countUnder(directories)');
    expect(resultsPage).toContain('dataFiles.removeUnder(directories)');
  });
});

describe('every run recorder', () => {
  it.each(RUN_RECORDERS)('%s states what it leaves behind', (path) => {
    expect(read(path)).toContain('sideEffects');
  });
});

describe('the tools that were dropping evidence', () => {
  it('keeps the fastp report instead of writing it to /dev/null', () => {
    const fastp = read('frontend/src/routes/tools/qc/fastp/+page.svelte');
    expect(fastp).not.toContain("'--html', '/dev/null'");
    expect(fastp).toContain("'--html', htmlPath");
  });

  it('declares the reference index bwa builds beside the user’s own FASTA', () => {
    const bwa = read('frontend/src/routes/tools/alignment/bwa/+page.svelte');
    expect(bwa).toContain("['amb', 'ann', 'bwt', 'pac', 'sa']");
    // `cache`, not `intermediate`: later runs against the same reference reuse these, which is why
    // this run skips indexing when they already exist.
    expect(bwa).toContain("role: 'cache' as const");
  });

  it('declares the engine reports an External Workflow leaves behind', () => {
    const nextflow = read('frontend/src/lib/external-workflows/nextflow.ts');
    expect(nextflow).toContain('externalWorkflowSideEffects');
    for (const location of ['logFile', 'traceFile', 'reportFile', 'timelineFile', 'dagFile']) {
      expect(nextflow).toContain(`locations.${location}`);
    }
  });
});

describe('the results view', () => {
  it('lists results only, and points at the run for everything else', () => {
    const view = read('frontend/src/lib/components/ui/ToolResultView.svelte');
    expect(view).toContain('resultFiles');
    // A file with no role predates roles, and back then everything shown was a result.
    expect(view).toContain("(file.role ?? 'final') === 'final'");
    expect(view).toContain('byproductCount');
  });

  it('offers the run folder on every screen that shows a run, not only where files were listed', () => {
    // It used to live in the result view, gated on there being by-products — so it was absent from
    // the Results screen, from failures, and from any run with no structured output: exactly the
    // runs someone opens a folder to understand.
    const record = read('frontend/src/lib/components/ui/RunRecord.svelte');
    expect(record).toContain('revealRunDir');
    expect(record).toContain('Open run folder');
    for (const path of RUN_VIEWERS) {
      expect(read(path)).toContain('<RunRecord ');
    }
  });

  it('offers it for a failed run too, which is when it is most wanted', () => {
    // These pages render a selected failure as a red box and stopped there: no transcript, no
    // folder, on the one run someone is actually trying to explain.
    for (const path of RUN_VIEWERS) {
      const source = read(path);
      const start = source.indexOf('{#if displayError}');
      if (start === -1) continue;
      const failureBranch = source.slice(start, source.indexOf('{:else', start));
      expect(failureBranch, `${path} hides the run record on failure`).toContain('<RunRecord ');
    }
  });

  it('reveals a directory through a command of its own, not by widening the shell scope', () => {
    // `shell.open` validates its argument against a URL regex, so a path silently fails; relaxing
    // that regex would admit any path on the machine, an executable included.
    expect(runStorage).toContain("api.invoke('lia_fs_reveal', { rel: runDirRel(runId) })");
    const rust = read('src-tauri/src/bridge/fs.rs');
    expect(rust).toContain('pub fn lia_fs_reveal');
    expect(rust).toContain('lia_fs_safe_join_data(&app, &rel)');
    expect(read('src-tauri/src/main.rs')).toContain('lia_fs_reveal,');
    // The bridge must not keep a second, broken way to do it.
    expect(read('src-ts/bridge.ts')).not.toContain('openPath:');
  });

  it('registers only results in the Data library, in one place', () => {
    expect(finalization).toContain("files.filter((file) => (file.role ?? 'final') === 'final')");
    // The pipeline goes through the same rule rather than keeping its own.
    const pipeline = read('frontend/src/lib/stores/pipeline.svelte.ts');
    expect(pipeline).toContain('registerResultsInDataLibrary(files, toolLabel)');
  });
});
