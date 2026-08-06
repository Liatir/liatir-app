<!--
	Lightweight single-cell preview: a bar chart of how many cells carry each label.

	The full Vitessce runtime is not installable yet (see `runtime-registry`), so this is what Liatir shows
	in the meantime. It is deliberately honest about that — when an `.h5ad` has no label summary, the empty
	state says the artifact *is* Vitessce-ready and that this is only the lightweight preview, rather than
	implying the data is unusable.

	The `as*` helpers exist because the viewer config is loosely-typed JSON produced by a tool, so every
	field is treated as untrusted and coerced rather than asserted.
-->
<script lang="ts">
  import VisualizationShell from '$lib/components/viewers/VisualizationShell.svelte';
  import { getLastSegmentsStringFromPath } from '$lib/utils';
  import type { JsonValue } from '@liatir/core';
  import type { SingleCellViewerSection } from '$lib/types/tool-output';

  let { section }: { section: SingleCellViewerSection } = $props();

  type JsonRecord = Record<string, JsonValue>;

  function isRecord(value: JsonValue): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function asRecord(value: JsonValue | undefined): JsonRecord {
    return value && isRecord(value) ? value : {};
  }

  function asString(value: JsonValue | undefined): string {
    return typeof value === 'string' ? value : '';
  }

  /**
   * Normalises the label counts, sorted largest first — so the dominant cell types are at the top of the
   * chart, where they are what the user sees. Counts that do not parse as finite numbers are dropped
   * rather than plotted as NaN bars.
   */
  function asCountEntries(value: JsonValue | undefined): Array<[string, number]> {
    const record = asRecord(value);
    return Object.entries(record)
      .map(([label, count]) => [label, typeof count === 'number' ? count : Number(count)] as [string, number])
      .filter(([, count]) => Number.isFinite(count))
      .sort((a, b) => b[1] - a[1]);
  }

  const config = $derived(asRecord(section.config));
  const title = $derived(asString(config.title) || section.label);
  const source = $derived(asString(config.source));
  const sourceLabel = $derived(source ? getLastSegmentsStringFromPath(source, 2) : '');
  // Two spellings accepted, because different tools emit different key names.
  const labelCounts = $derived(asCountEntries(config.labelCounts ?? config.counts));
  // The largest count sets the bar scale. `Math.max(1, …)` guards against a division by zero when the
  // list is empty (the spread would otherwise yield -Infinity).
  const maxCount = $derived(Math.max(1, ...labelCounts.map(([, count]) => count)));
  // Distinguishes "a real single-cell file we simply cannot chart" from "a file that is not one at all",
  // which lets the empty state below say something accurate rather than generic.
  const sourceIsH5ad = $derived(source.toLowerCase().endsWith('.h5ad'));
</script>

<VisualizationShell
  {title}
  description={section.description ?? sourceLabel}
  badge="single-cell"
  height={section.height ?? 300}
  openHref={source ? `/tools/visualization/single-cell?file=${encodeURIComponent(source)}` : undefined}
>
  <div class="h-full overflow-auto bg-white">
    {#if labelCounts.length === 0}
      <div class="flex min-h-56 items-center justify-center px-4 text-center text-xs text-zinc-400">
        {#if sourceIsH5ad}
          This h5ad artifact is registered for Vitessce-compatible viewing, but no label summary is available for the lightweight preview.
        {:else}
          No label distribution available in this single-cell viewer config.
        {/if}
      </div>
    {:else}
      <!-- Capped at 30 rows: an annotated dataset can carry hundreds of labels, and a list that long
           stops being a summary. They are sorted by count, so these are the 30 that matter. -->
      <div class="divide-y divide-border/70">
        {#each labelCounts.slice(0, 30) as [label, count]}
          <div class="grid grid-cols-[minmax(120px,0.45fr)_minmax(0,1fr)_70px] items-center gap-3 px-3 py-2">
            <p class="truncate text-xs text-zinc-700" title={label}>{label}</p>
            <div class="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div class="h-full rounded-full bg-emerald-500" style={`width: ${(count / maxCount) * 100}%`}></div>
            </div>
            <p class="text-right font-mono text-[10px] text-zinc-500">{count.toLocaleString()}</p>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</VisualizationShell>
