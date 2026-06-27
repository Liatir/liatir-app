<script lang="ts">
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import InfoPopup from './InfoPopup.svelte';
  import PlotlyChart from './PlotlyChart.svelte';
  import type { ToolOutput, StatsSection, NumberSection, PlotlySection, TextSection, TableSection } from '$lib/types/tool-output';
  import type { RunOutputFile } from '$lib/types/pipeline';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { liatir } from '$lib/api';
  import { page } from '$app/state';

  let { output, outputFiles, resultFolder }: { output: ToolOutput; outputFiles?: RunOutputFile[]; resultFolder?: string } = $props();

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
      await dataFiles.addToResults(file.path, toolName);
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
</script>

<div class="space-y-4">

  {#if outputFiles && outputFiles.length > 0}
    <Card class="p-4">
      <p class="text-xs font-medium text-zinc-500 mb-3">Output files</p>
      <div class="space-y-2">
        {#each outputFiles as file (file.path)}
          <div class="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f39f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-zinc-800 truncate">{file.label}</p>
              {#if file.size != null}
                <p class="text-[10px] text-zinc-400 font-mono">{fmtBytes(file.size)}</p>
              {/if}
            </div>
            <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-600 border border-zinc-200">
              {file.ext}
            </span>
            <Button
              variant="secondary"
              size="sm"
              class="shrink-0"
              loading={addingToData.has(file.path)}
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
        {/each}
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
          {@const itemValue = String(item.value)}
          <Card class="p-4 min-w-0">
            <p class="text-xs text-zinc-500 mb-1 flex items-center gap-1 min-w-0">
              <span class="truncate">{item.label}</span>
              {#if item.description}
                <InfoPopup text={item.description} />
              {/if}
            </p>
            <p
              class="font-semibold text-zinc-900 break-all leading-snug {itemValue.length > 16 ? 'text-sm' : 'text-lg'}"
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
        <p class="text-xs text-zinc-500 mb-1 flex items-center gap-1 min-w-0">
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
          <p class="text-xs text-zinc-500 mb-1 flex items-center">
            {s.title}
            {#if s.description}
              <InfoPopup text={s.description} />
            {/if}
          </p>
        {/if}
        {#if s.subtitle}
          <p class="text-[10px] text-zinc-400 mb-3">{s.subtitle}</p>
        {/if}
        <PlotlyChart data={s.data} layout={s.layout} />
      </Card>

    {:else if section.type === 'text'}
      {@const s = section as TextSection}
      {@const lines = s.content.split('\n')}
      {@const isLong = lines.length > TEXT_PREVIEW_LINES}
      {@const expanded = expandedSections.has(sectionIdx)}
      {@const displayed = isLong && !expanded ? lines.slice(0, TEXT_PREVIEW_LINES).join('\n') : s.content}
      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-2 flex items-center">
          {s.label}
          {#if s.description}
            <InfoPopup text={s.description} />
          {/if}
          {#if isLong}
            <span class="ml-auto text-[10px] text-zinc-400 font-normal">
              {lines.length.toLocaleString()} lines
            </span>
          {/if}
        </p>
        <pre class="text-xs text-zinc-700 whitespace-pre-wrap break-all leading-relaxed max-h-96 overflow-y-auto
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
        <p class="text-xs text-zinc-500 mb-3">{s.label}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs text-left border-collapse">
            <thead>
              <tr>
                {#each s.headers as header}
                  <th class="px-3 py-2 font-medium text-zinc-500 bg-zinc-50 border-b border-border whitespace-nowrap">{header}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each s.rows as row, i}
                <tr class="{i % 2 === 0 ? '' : 'bg-zinc-50/50'} hover:bg-brand/5 transition-colors">
                  {#each row as cell}
                    <td class="px-3 py-2 text-zinc-700 border-b border-border/50 font-mono whitespace-nowrap">{cell}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if s.rows.length === 0}
          <p class="text-xs text-zinc-400 text-center py-4">No rows</p>
        {/if}
      </Card>
    {/if}

  {/each}
</div>
