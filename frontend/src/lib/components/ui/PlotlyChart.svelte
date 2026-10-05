<script lang="ts">
  import { onDestroy } from 'svelte';
  import { loadPlotly } from '$lib/utils/plotly-runtime';
  import { settingsStore } from '$lib/stores/settings.svelte';

  let { data, layout = {} }: { data: object[]; layout?: object } = $props();

  let el: HTMLDivElement;

  // Plotly draws to canvas/SVG with literal colours, so it cannot inherit the
  // theme tokens. Reading the computed variables keeps app.css the single
  // source of truth instead of duplicating hex values here.
  function themedLayout() {
    const styles = getComputedStyle(el);
    const line = styles.getPropertyValue('--color-border').trim();
    const tick = styles.getPropertyValue('--color-text-muted').trim();
    const axis = {
      gridcolor: line,
      color: tick,
      tickfont: { size: 10 },
      linecolor: line,
    };
    return {
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      margin: { l: 44, r: 12, t: 12, b: 40 },
      xaxis: { ...axis },
      yaxis: { ...axis },
      showlegend: false,
    };
  }

  const MAX_POINTS = 10_000;

  function prepareTraces(raw: object[]): { traces: object[]; truncated: boolean; originalCount: number } {
    let truncated = false;
    let originalCount = 0;
    const traces = raw.map((trace: any) => {
      const t = { ...trace };
      // Auto-switch to WebGL for large scatter datasets
      if ((t.type === 'scatter' || t.type === 'scattergl') && Array.isArray(t.x) && t.x.length > MAX_POINTS) {
        originalCount = Math.max(originalCount, t.x.length);
        // LTTB-lite: evenly sample MAX_POINTS indices
        const factor = t.x.length / MAX_POINTS;
        const idx = Array.from({ length: MAX_POINTS }, (_, i) => Math.round(i * factor));
        t.x = idx.map((i: number) => t.x[i]);
        t.y = idx.map((i: number) => t.y[i]);
        if (t.text) t.text = idx.map((i: number) => t.text[i]);
        t.type = 'scattergl';
        truncated = true;
      } else if (t.type === 'scatter' && Array.isArray(t.x) && t.x.length > 2_000) {
        t.type = 'scattergl';
      }
      return t;
    });
    return { traces, truncated, originalCount };
  }

  let truncated = $state(false);
  let originalCount = $state(0);
  let chartError = $state('');
  let plotly: Awaited<ReturnType<typeof loadPlotly>>;

  $effect(() => {
    if (!el) return;
    // Depend on the resolved theme so the chart is redrawn when it changes.
    settingsStore.resolvedTheme;
    const baseLayout = themedLayout();
    const merged = {
      ...baseLayout,
      ...layout,
      xaxis: { ...baseLayout.xaxis, ...(layout as any)?.xaxis },
      yaxis: { ...baseLayout.yaxis, ...(layout as any)?.yaxis },
    };
    const { traces, truncated: tr, originalCount: oc } = prepareTraces(data);
    truncated = tr;
    originalCount = oc;
    let disposed = false;
    chartError = '';
    void loadPlotly().then(async (runtime) => {
      if (disposed) return;
      plotly = runtime;
      await runtime.newPlot(el, traces as any, merged as any, {
        responsive: true,
        displayModeBar: false,
        displaylogo: false,
        modeBarButtons: [['zoom2d', 'pan2d', 'resetScale2d']] as any,
      });
    }).catch((error) => {
      if (!disposed) chartError = String(error);
    });
    return () => { disposed = true; };
  });

  onDestroy(() => {
    if (el && plotly) plotly.purge(el);
  });
</script>

<div bind:this={el} class="w-full h-52"></div>
{#if chartError}
  <p role="alert" class="text-sm text-error">{chartError}</p>
{/if}
{#if truncated}
  <p class="text-[10px] text-text-subtle mt-1">
    Showing {(10_000).toLocaleString()} of {originalCount.toLocaleString()} points (downsampled for performance)
  </p>
{/if}
