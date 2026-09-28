<!--
	Lightweight single-cell preview: a bounded PCA scatter for model embeddings, with label counts retained
	for legacy Result sections. The chart is deliberately explicit that it is neither a whole-dataset UMAP
	nor an annotation, so a convenient preview cannot be mistaken for a biological conclusion.

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

  function asNumber(value: JsonValue | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

  interface EmbeddingPoint {
    cellId: string;
    x: number;
    y: number;
  }

  function asEmbeddingPoints(value: JsonValue | undefined): EmbeddingPoint[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const x = asNumber(item.x);
      const y = asNumber(item.y);
      if (x === null || y === null) return [];
      return [{ cellId: asString(item.cellId) || `cell_${index + 1}`, x, y }];
    });
  }

  const config = $derived(asRecord(section.config));
  const title = $derived(asString(config.title) || section.label);
  const source = $derived(asString(config.source));
  const sourceLabel = $derived(source ? getLastSegmentsStringFromPath(source, 2) : '');
  const previewCsv = $derived(asString(config.previewCsv));
  const embeddingKey = $derived(asString(config.embeddingKey));
  const validationStatus = $derived(asString(config.validationStatus));
  const cellCount = $derived(asNumber(config.cellCount));
  const embeddingDim = $derived(asNumber(config.embeddingDim));
  const projection = $derived(asString(config.projection) || 'first-two-dimensions');
  const embeddingPoints = $derived(asEmbeddingPoints(config.embeddingPoints).slice(0, 1_000));
  const bounds = $derived.by(() => {
    if (embeddingPoints.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = embeddingPoints.map((point) => point.x);
    const ys = embeddingPoints.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });
  // Two spellings remain accepted for older annotation Result sections.
  const labelCounts = $derived(asCountEntries(config.labelCounts ?? config.counts));
  // The largest count sets the bar scale. `Math.max(1, …)` guards against a division by zero when the
  // list is empty (the spread would otherwise yield -Infinity).
  const maxCount = $derived(Math.max(1, ...labelCounts.map(([, count]) => count)));
  // Distinguishes "a real single-cell file we simply cannot chart" from "a file that is not one at all",
  // which lets the empty state below say something accurate rather than generic.
  const sourceIsH5ad = $derived(source.toLowerCase().endsWith('.h5ad'));
  // A raw-counts file has no embedding to draw; one that already carries an embedding only lacks the
  // preview CSV. The two need different next steps, so the empty state tells them apart.
  const fileHasEmbedding = $derived(
    Array.isArray(config.availableEmbeddingKeys) && config.availableEmbeddingKeys.length > 0,
  );

  function plotX(value: number): number {
    const span = bounds.maxX - bounds.minX;
    return span === 0 ? 360 : 30 + ((value - bounds.minX) / span) * 660;
  }

  function plotY(value: number): number {
    const span = bounds.maxY - bounds.minY;
    return span === 0 ? 135 : 245 - ((value - bounds.minY) / span) * 220;
  }
</script>

<VisualizationShell
  {title}
  description={section.description ?? sourceLabel}
  badge="single-cell"
  height={section.height ?? 300}
  openHref={source
    ? `/tools/visualization/single-cell?file=${encodeURIComponent(source)}${previewCsv ? `&preview=${encodeURIComponent(previewCsv)}` : ''}${embeddingKey ? `&embeddingKey=${encodeURIComponent(embeddingKey)}` : ''}`
    : undefined}
>
  <div class="flex h-full flex-col overflow-auto bg-white" data-testid="single-cell-viewer">
    {#if embeddingKey || cellCount !== null || validationStatus}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 bg-zinc-50 px-3 py-2 text-[10px] text-zinc-500">
        {#if embeddingKey}<span><strong class="font-medium text-zinc-700">Embedding</strong> {embeddingKey}</span>{/if}
        {#if cellCount !== null}<span><strong class="font-medium text-zinc-700">Cells</strong> {cellCount.toLocaleString()}</span>{/if}
        {#if embeddingDim !== null}<span><strong class="font-medium text-zinc-700">Dimensions</strong> {embeddingDim.toLocaleString()}</span>{/if}
        {#if validationStatus}
          <span class="rounded border px-1.5 py-0.5 {validationStatus === 'valid' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}">{validationStatus}</span>
        {/if}
      </div>
    {/if}

    {#if embeddingPoints.length > 0}
      <div class="min-h-0 flex-1 p-3" data-testid="single-cell-embedding-preview">
        <svg
          viewBox="0 0 720 270"
          class="h-full min-h-56 w-full rounded-md border border-zinc-100 bg-zinc-50"
          role="img"
          aria-label={`First two dimensions of ${embeddingPoints.length} preview cells`}
          data-testid="single-cell-scatter"
        >
          <line x1="30" y1="245" x2="690" y2="245" stroke="#d4d4d8" stroke-width="1" />
          <line x1="30" y1="25" x2="30" y2="245" stroke="#d4d4d8" stroke-width="1" />
          {#each embeddingPoints as point, index (index)}
            <circle
              cx={plotX(point.x)}
              cy={plotY(point.y)}
              r="3.2"
              fill="#0a948b"
              fill-opacity="0.68"
              data-testid="single-cell-point"
            >
              <title>{point.cellId}: {point.x.toPrecision(4)}, {point.y.toPrecision(4)}</title>
            </circle>
          {/each}
          <text x="360" y="264" text-anchor="middle" font-size="10" fill="#71717a">{projection === 'bounded-preview-pca' ? 'preview PC 1' : 'dimension 1'}</text>
          <text x="10" y="135" text-anchor="middle" font-size="10" fill="#71717a" transform="rotate(-90 10 135)">{projection === 'bounded-preview-pca' ? 'preview PC 2' : 'dimension 2'}</text>
        </svg>
        <p class="mt-1 text-center text-[10px] text-zinc-400">
          {projection === 'bounded-preview-pca'
            ? 'PCA is computed only on the bounded preview rows; it is not a whole-dataset UMAP, clustering, or cell-type annotation.'
            : 'Quick preview of the first two model dimensions; this is not a UMAP, clustering, or cell-type annotation.'}
        </p>
      </div>
    {:else if labelCounts.length === 0}
      <div class="flex min-h-56 items-center justify-center px-4 text-center text-xs text-zinc-400">
        {#if sourceIsH5ad && fileHasEmbedding}
          This file already contains a cell map (embedding), but no preview was connected. Connect the preview CSV
          produced by the AI Model that created it to see the cells here.
        {:else if sourceIsH5ad}
          This file contains only raw gene counts, so there is no cell map (embedding) to draw yet. Run a
          single-cell embedding AI Model (for example Geneformer) on it first, then connect its preview CSV here.
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
