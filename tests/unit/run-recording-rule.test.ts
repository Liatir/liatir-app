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

describe('transcript retention', () => {
  it('keeps a run’s log for as long as the run itself', () => {
    // Logs used to be deleted after seven days while the run stayed, leaving old Results openable
    // and mute — and old runs are exactly the ones someone is trying to explain.
    expect(analysisRuns).not.toContain('LOG_TTL_MS');
  });

  it('deletes both files when a run goes away, so unbounded age is not unbounded disk', () => {
    expect(analysisRuns).toContain('discardRunFiles');
    expect(analysisRuns).toContain('retained.slice(MAX_RUNS)');
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
  it('separates results from by-products rather than listing seven of each as one', () => {
    const view = read('frontend/src/lib/components/ui/ToolResultView.svelte');
    expect(view).toContain('resultFiles');
    expect(view).toContain('byproductFiles');
    // A file with no role predates roles, and back then everything shown was a result.
    expect(view).toContain("(file.role ?? 'final') === 'final'");
  });
});
