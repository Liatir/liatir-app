<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import ToolResultView from '$lib/components/ui/ToolResultView.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import type { ToolOutput } from '$lib/types/tool-output';
  import {
    runGenomeViewerStep,
    runSingleCellViewerStep,
    runStructureViewerStep,
  } from '$lib/tools/viewers/scientific-viewers';

  type ViewerMode = 'structure' | 'genome' | 'single-cell';
  type StructureStyle = 'cartoon' | 'stick' | 'line' | 'sphere';

  interface Props {
    mode: ViewerMode;
  }

  let { mode }: Props = $props();

  let structureFile = $state('');
  let structureStyle = $state<StructureStyle>('cartoon');
  let referenceFile = $state('');
  let trackFile = $state('');
  let refName = $state('');
  let singleCellFile = $state('');
  let labelColumn = $state('');
  let running = $state(false);
  let error = $state<string | null>(null);
  let output = $state<ToolOutput | null>(null);
  let logLines = $state<string[]>([]);

  const structureFiles = $derived(dataFiles.byExt('pdb', 'cif', 'mmcif', 'sdf', 'mol2', 'xyz'));
  const referenceFiles = $derived(dataFiles.byExt('fasta', 'fasta.gz'));
  const trackFiles = $derived(dataFiles.byExt('gff', 'gff3', 'bed', 'vcf', 'vcf.gz', 'bam'));
  const singleCellFiles = $derived(dataFiles.byExt('h5ad', 'csv', 'json'));
  const structureStyleOptions = [
    { value: 'cartoon', label: 'Cartoon' },
    { value: 'stick', label: 'Stick' },
    { value: 'line', label: 'Line' },
    { value: 'sphere', label: 'Sphere' },
  ];
  const canRun = $derived(
    mode === 'structure'
      ? !!structureFile
      : mode === 'genome'
        ? !!trackFile
        : !!singleCellFile,
  );

  const title = $derived(
    mode === 'structure'
      ? '3D Structure Viewer'
      : mode === 'genome'
        ? 'Genome Track Viewer'
        : 'Single-cell Viewer',
  );

  const description = $derived(
    mode === 'structure'
      ? 'Inspect molecular structure artifacts with the optional 3Dmol.js runtime.'
      : mode === 'genome'
        ? 'Preview genomic tracks and use the optional JBrowse 2 runtime when installed.'
        : 'Inspect single-cell label summaries and Vitessce-ready artifacts.',
  );

  function appendLog(line: string) {
    if (!line.trim()) return;
    logLines = [...logLines, line];
  }

  async function runViewer() {
    if (!canRun || running) return;
    running = true;
    error = null;
    output = null;
    logLines = [];

    try {
      const result = mode === 'structure'
        ? await runStructureViewerStep(
            { structureFile, style: structureStyle },
            '',
            appendLog,
          )
        : mode === 'genome'
          ? await runGenomeViewerStep(
              { referenceFile, trackFile, refName },
              '',
              appendLog,
            )
          : await runSingleCellViewerStep(
              { inputFile: singleCellFile, labelColumn },
              '',
              appendLog,
            );
      output = result.output;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      running = false;
    }
  }

  onMount(() => {
    void dataFiles.init();
    const params = page.url.searchParams;
    let shouldAutoRun = false;
    if (mode === 'structure') {
      structureFile = params.get('file') ?? '';
      shouldAutoRun = !!structureFile;
    } else if (mode === 'genome') {
      trackFile = params.get('track') ?? '';
      referenceFile = params.get('reference') ?? '';
      refName = params.get('ref') ?? '';
      shouldAutoRun = !!trackFile;
    } else {
      singleCellFile = params.get('file') ?? '';
      shouldAutoRun = !!singleCellFile;
    }
    if (shouldAutoRun) queueMicrotask(() => void runViewer());
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader {title} {description}>
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={() => goto('/tools')}>
        Back
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    <div class="mx-auto flex max-w-5xl flex-col gap-5">
      <Card class="p-5">
        <div class="grid gap-4">
          {#if mode === 'structure'}
            <FilePickerPopup
              files={structureFiles}
              value={structureFile}
              label="Structure file"
              emptyText="No structure files in Data yet."
              disabled={running}
              onchange={(path) => structureFile = path}
            />
            <label class="grid gap-1.5">
              <span class="text-xs font-medium text-zinc-500">Style</span>
              <Select
                value={structureStyle}
                options={structureStyleOptions}
                disabled={running}
                onchange={(value) => structureStyle = value as StructureStyle}
              />
            </label>
          {:else if mode === 'genome'}
            <FilePickerPopup
              files={trackFiles}
              value={trackFile}
              label="Track file"
              emptyText="No GFF/BED/VCF/BAM files in Data yet."
              disabled={running}
              onchange={(path) => trackFile = path}
            />
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <FilePickerPopup
                files={referenceFiles}
                value={referenceFile}
                label="Reference FASTA"
                emptyText="No FASTA files in Data yet."
                disabled={running}
                onchange={(path) => referenceFile = path}
              />
              <Button size="sm" variant="ghost" disabled={running || !referenceFile} onclick={() => referenceFile = ''}>
                Clear
              </Button>
            </div>
            <label class="grid gap-1.5">
              <span class="text-xs font-medium text-zinc-500">Reference name</span>
              <input
                bind:value={refName}
                disabled={running}
                placeholder="chr1"
                class="h-9 rounded-lg border border-border bg-white px-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-brand"
              />
            </label>
          {:else}
            <FilePickerPopup
              files={singleCellFiles}
              value={singleCellFile}
              label="Single-cell artifact"
              emptyText="No h5ad/CSV/JSON files in Data yet."
              disabled={running}
              onchange={(path) => singleCellFile = path}
            />
            <label class="grid gap-1.5">
              <span class="text-xs font-medium text-zinc-500">Label column</span>
              <input
                bind:value={labelColumn}
                disabled={running}
                placeholder="predicted_labels"
                class="h-9 rounded-lg border border-border bg-white px-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-brand"
              />
            </label>
          {/if}

          <div class="flex items-center gap-3">
            <Button variant="primary" loading={running} disabled={!canRun || running} onclick={runViewer}>
              Open viewer
            </Button>
            {#if logLines.length > 0}
              <p class="text-xs text-zinc-400">{logLines.at(-1)}</p>
            {/if}
          </div>
        </div>
      </Card>

      {#if error}
        <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-selectable>
          {error}
        </div>
      {/if}

      {#if output}
        <ToolResultView {output} resultFolder="viewers" />
      {/if}
    </div>
  </div>
</div>
