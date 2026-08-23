<script lang="ts">
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import InfoPopup from './InfoPopup.svelte';
  import PlotlyChart from './PlotlyChart.svelte';
  import StructureViewer from '$lib/components/viewers/StructureViewer.svelte';
  import GenomeViewer from '$lib/components/viewers/GenomeViewer.svelte';
  import SingleCellViewer from '$lib/components/viewers/SingleCellViewer.svelte';
  import type {
    ToolOutput,
    StatsSection,
    NumberSection,
    PlotlySection,
    TextSection,
    TableSection,
    StructureViewerSection,
    GenomeViewerSection,
    SingleCellViewerSection,
  } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { liatir } from '$lib/api';
  import { runDirPath } from '$lib/execution/run-storage';
  import { page } from '$app/state';
  import { getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';

  let { output, outputFiles, resultFolder, runId }: {
    output: ToolOutput;
    outputFiles?: RunOutputFile[];
    resultFolder?: string;
    /** Lets the panel offer the run's own directory, where its by-products actually are. */
    runId?: string | null;
  } = $props();

  // Result files land in the locked Results/<tool>/ folder. Tool name is taken
  // from the route (e.g. /tools/alignment/bwa → "bwa") unless `resultFolder` is given.
  const toolName = $derived(resultFolder ?? page.url.pathname.split('/').filter(Boolean).pop() ?? 'tool');

  const TEXT_PREVIEW_LINES = 300;
  let expandedSections = $state(new Set<number>());

  let addingToData = $state<Set<string>>(new Set());
  let savingAs = $state<Set<string>>(new Set());

  function fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }

  async function addToData(file: RunOutputFile) {
    const next = new Set(addingToData);
    next.add(file.path);
    addingToData = next;
    try {
      await dataFiles.addToResults(file.path, toolName, file.scientific);
    } finally {
      const s = new Set(addingToData);
      s.delete(file.path);
      addingToData = s;
    }
  }

  async function saveAs(file: RunOutputFile) {
    const api = liatir();
    if (!api) return;
    const next = new Set(savingAs);
    next.add(file.path);
    savingAs = next;
    try {
      const destPath = await api.invoke('lia_file_save', { defaultName: file.label + '.' + file.ext }) as string;
      if (!destPath) return;
      await api.invoke('lia_fs_copy', { src: file.path, dest: destPath });
    } finally {
      const s = new Set(savingAs);
      s.delete(file.path);
      savingAs = s;
    }
  }

  function fmtNumber(value: number, format?: string): string {
    if (format === 'integer') return value.toLocaleString();
    if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
    if (format === 'bytes') {
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
      if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
      return `${value.toLocaleString()} B`;
    }
    return value.toFixed(2);
  }

  function displayText(value: string): string {
    return sanitizeLocalPathsForDisplay(value, 2);
  }

  function displayCell(value: string | number): string | number {
    return typeof value === 'string' ? displayText(value) : value;
  }

  /**
   * Results and by-products are shown apart because they answer different questions. A run that
   * produced one alignment and six index files reads, in one flat list, as though it produced seven
   * results — and the user has to know the tool to tell which is which. Splitting them keeps the
   * by-products reachable, which is the whole point of recording them, without letting them bury
   * the thing that was asked for.
   *
   * A file with no role is `final`: that was the only meaning before roles existed.
   */
  const resultFiles = $derived((outputFiles ?? []).filter((file) => (file.role ?? 'final') === 'final'));
  const byproductCount = $derived((outputFiles ?? []).length - resultFiles.length);

  async function openRunFolder() {
    if (!runId) return;
    const api = liatir();
    if (!api?.openPath) return;
    await api.openPath(await runDirPath(runId));
  }
</script>

<div class="space-y-4">

  {#snippet fileRow(file: RunOutputFile)}
          <div
            class="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
            data-testid="result-output-file"
            data-output-field={file.fieldKey ?? ''}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0A948B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-text truncate">{file.label}</p>
              <p class="text-[10px] text-text-subtle font-mono truncate" title={getLastSegmentsStringFromPath(file.path, 2)}>
                {getLastSegmentsStringFromPath(file.path, 2)}
              </p>
              {#if file.size != null}
                <p class="text-[10px] text-text-subtle font-mono">{fmtBytes(file.size)}</p>
              {/if}
              {#if file.scientific}
                <div class="mt-1 flex flex-wrap items-center gap-1.5" title={file.scientific.validation.diagnostics.map((item) => item.message).join(' ')}>
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-medium border
                    {file.scientific.validation.status === 'valid'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : file.scientific.validation.status === 'invalid'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'}">
                    {file.scientific.validation.status}
                  </span>
                  <span class="text-[10px] text-text-subtle">
                    {file.scientific.profile.id.split('.').pop()} {file.scientific.profile.version} · {file.scientific.scientificType}
                  </span>
                  {#if file.scientific.lineage?.transformation}
                    <span class="text-[10px] text-text-subtle">· from {file.scientific.lineage.sources.length} source{file.scientific.lineage.sources.length === 1 ? '' : 's'} via {file.scientific.lineage.transformation.label}</span>
                  {/if}
                </div>
                <p class="mt-0.5 text-[10px] text-text-subtle font-mono" title={file.scientific.physical.digest.value}>
                  sha256:{file.scientific.physical.digest.value.slice(0, 12)}…
                </p>
              {/if}
            </div>
            <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-2 text-text-secondary border border-border">
              {file.ext}
            </span>
            <Button
              variant="secondary"
              size="sm"
              class="shrink-0"
              loading={addingToData.has(file.path)}
              testId={`add-output-to-data-${file.fieldKey ?? file.ext}`}
              onclick={() => addToData(file)}
            >
              Add to Data
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="shrink-0"
              loading={savingAs.has(file.path)}
              onclick={() => saveAs(file)}
            >
              Save as…
            </Button>
          </div>
  {/snippet}

  {#if resultFiles.length > 0}
    <Card class="p-4">
      <p class="text-xs font-medium text-text-muted mb-3">Output files</p>
      <div class="space-y-2">
        {#each resultFiles as file (file.path)}{@render fileRow(file)}{/each}
      </div>
    </Card>
  {/if}

  {#if runId && byproductCount > 0}
    <Card class="p-4">
      <div class="flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium text-text-muted">
            This run also produced {byproductCount} other {byproductCount === 1 ? 'file' : 'files'}
          </p>
          <p class="text-[10px] text-text-subtle mt-0.5">
            Reports, indexes and working files the tool wrote along the way. They are kept with the run.
          </p>
        </div>
        <Button variant="secondary" size="sm" class="shrink-0" onclick={openRunFolder}>
          Open run folder
        </Button>
      </div>
    </Card>
  {/if}

  {#each output.sections as section, sectionIdx}

    {#if section.type === 'stats'}
      {@const s = section as StatsSection}
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat({s.cols ?? 4}, minmax(0, 1fr))"
      >
        {#each s.items as item}
          {@const itemValue = displayText(String(item.value))}
          <Card class="p-4 min-w-0">
            <p class="text-xs text-text-muted mb-1 flex items-center gap-1 min-w-0">
              <span class="truncate">{item.label}</span>
              {#if item.description}
                <InfoPopup text={item.description} />
              {/if}
            </p>
            <p
              class="font-semibold text-text break-all leading-snug {itemValue.length > 16 ? 'text-sm' : 'text-lg'}"
              style={item.color ? `color: ${item.color}` : ''}
            >
              {itemValue}
            </p>
          </Card>
        {/each}
      </div>

    {:else if section.type === 'number'}
      {@const s = section as NumberSection}
      <Card class="p-4 min-w-0">
        <p class="text-xs text-text-muted mb-1 flex items-center gap-1 min-w-0">
          <span class="truncate">{s.label}</span>
          {#if s.description}
            <InfoPopup text={s.description} />
          {/if}
        </p>
        <p
          class="text-2xl font-semibold break-all"
          style={s.color ? `color: ${s.color}` : ''}
        >
          {fmtNumber(s.value, s.format)}{s.unit ? ` ${s.unit}` : ''}
        </p>
      </Card>

    {:else if section.type === 'plotly'}
      {@const s = section as PlotlySection}
      <Card class="p-4">
        {#if s.title}
          <p class="text-xs text-text-muted mb-1 flex items-center">
            {s.title}
            {#if s.description}
              <InfoPopup text={s.description} />
            {/if}
          </p>
        {/if}
        {#if s.subtitle}
          <p class="text-[10px] text-text-subtle mb-3">{s.subtitle}</p>
        {/if}
        <PlotlyChart data={s.data} layout={s.layout} />
      </Card>

    {:else if section.type === 'text'}
      {@const s = section as TextSection}
      {@const lines = s.content.split('\n')}
      {@const isLong = lines.length > TEXT_PREVIEW_LINES}
      {@const expanded = expandedSections.has(sectionIdx)}
      {@const displayed = displayText(isLong && !expanded ? lines.slice(0, TEXT_PREVIEW_LINES).join('\n') : s.content)}
      <Card class="p-4">
        <p class="text-xs text-text-muted mb-2 flex items-center">
          {s.label}
          {#if s.description}
            <InfoPopup text={s.description} />
          {/if}
          {#if isLong}
            <span class="ml-auto text-[10px] text-text-subtle font-normal">
              {lines.length.toLocaleString()} lines
            </span>
          {/if}
        </p>
        <pre class="text-xs text-text-secondary whitespace-pre-wrap break-all leading-relaxed max-h-96 overflow-y-auto
          {s.mono ? 'font-mono' : ''}">{displayed}</pre>
        {#if isLong}
          <button
            onclick={() => {
              const next = new Set(expandedSections);
              if (expanded) next.delete(sectionIdx); else next.add(sectionIdx);
              expandedSections = next;
            }}
            class="mt-2 text-xs text-brand hover:underline"
          >
            {expanded ? 'Show less' : `Show all ${lines.length.toLocaleString()} lines`}
          </button>
        {/if}
      </Card>
    {:else if section.type === 'table'}
      {@const s = section as TableSection}
      <Card class="p-4">
        <p class="text-xs text-text-muted mb-3">{s.label}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left border-collapse">
            <thead>
              <tr>
                {#each s.headers as header}
                  <th class="px-3 py-2 font-medium text-text-muted bg-surface-2 border-b border-border whitespace-nowrap">{header}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each s.rows as row, i}
                <tr class="{i % 2 === 0 ? '' : 'bg-surface-2/50'} hover:bg-brand/5 transition-colors">
                  {#each row as cell}
                    <td class="px-3 py-2 text-text-secondary border-b border-border/50 font-mono whitespace-nowrap">{displayCell(cell)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if s.rows.length === 0}
          <p class="text-xs text-text-subtle text-center py-4">No rows</p>
        {/if}
      </Card>
    {:else if section.type === 'structure-viewer'}
      <StructureViewer section={section as StructureViewerSection} />
    {:else if section.type === 'genome-viewer'}
      <GenomeViewer section={section as GenomeViewerSection} />
    {:else if section.type === 'single-cell-viewer'}
      <SingleCellViewer section={section as SingleCellViewerSection} />
    {/if}

  {/each}
</div>
