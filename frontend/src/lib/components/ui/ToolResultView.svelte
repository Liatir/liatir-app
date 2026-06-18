<script lang="ts">
  import Card from './Card.svelte';
  import InfoPopup from './InfoPopup.svelte';
  import PlotlyChart from './PlotlyChart.svelte';
  import type { ToolOutput, StatsSection, NumberSection, PlotlySection, TextSection } from '$lib/types/tool-output';

  let { output }: { output: ToolOutput } = $props();

  const TEXT_PREVIEW_LINES = 300;
  let expandedSections = $state(new Set<number>());

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
  {#each output.sections as section, sectionIdx}

    {#if section.type === 'stats'}
      {@const s = section as StatsSection}
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat({s.cols ?? 4}, minmax(0, 1fr))"
      >
        {#each s.items as item}
          <Card class="p-4">
            <p class="text-xs text-zinc-500 mb-1 flex items-center">
              {item.label}
              {#if item.description}
                <InfoPopup text={item.description} />
              {/if}
            </p>
            <p
              class="text-lg font-semibold text-zinc-900"
              style={item.color ? `color: ${item.color}` : ''}
            >
              {item.value}
            </p>
          </Card>
        {/each}
      </div>

    {:else if section.type === 'number'}
      {@const s = section as NumberSection}
      <Card class="p-4">
        <p class="text-xs text-zinc-500 mb-1 flex items-center">
          {s.label}
          {#if s.description}
            <InfoPopup text={s.description} />
          {/if}
        </p>
        <p
          class="text-2xl font-semibold"
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
    {/if}

  {/each}
</div>
