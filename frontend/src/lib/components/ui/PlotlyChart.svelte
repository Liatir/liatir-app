<script lang="ts">
  import { onDestroy } from 'svelte';
  import Plotly from 'plotly.js-dist-min';

  let { data, layout = {} }: { data: object[]; layout?: object } = $props();

  let el: HTMLDivElement;

  const baseLayout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 44, r: 12, t: 12, b: 40 },
    xaxis: {
      gridcolor: '#e2e2e8',
      color: '#6b7280',
      tickfont: { size: 10 },
      linecolor: '#e2e2e8',
    },
    yaxis: {
      gridcolor: '#e2e2e8',
      color: '#6b7280',
      tickfont: { size: 10 },
      linecolor: '#e2e2e8',
    },
    showlegend: false,
  };

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

  $effect(() => {
    if (!el) return;
    const merged = {
      ...baseLayout,
      ...layout,
      xaxis: { ...baseLayout.xaxis, ...(layout as any)?.xaxis },
      yaxis: { ...baseLayout.yaxis, ...(layout as any)?.yaxis },
    };
    const { traces, truncated: tr, originalCount: oc } = prepareTraces(data);
    truncated = tr;
    originalCount = oc;
    Plotly.newPlot(el, traces as any, merged as any, {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtons: [['toImage', 'zoom2d', 'pan2d', 'resetScale2d']] as any,
    });
  });

  onDestroy(() => {
    if (el) Plotly.purge(el);
  });
</script>

<div bind:this={el} class="w-full h-52"></div>
{#if truncated}
  <p class="text-[10px] text-zinc-400 mt-1">
    Showing {(10_000).toLocaleString()} of {originalCount.toLocaleString()} points (downsampled for performance)
  </p>
{/if}
