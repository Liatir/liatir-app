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

  $effect(() => {
    if (!el) return;
    const merged = {
      ...baseLayout,
      ...layout,
      xaxis: { ...baseLayout.xaxis, ...(layout as any)?.xaxis },
      yaxis: { ...baseLayout.yaxis, ...(layout as any)?.yaxis },
    };
    Plotly.newPlot(el, data as any, merged as any, { responsive: true, displayModeBar: false });
  });

  onDestroy(() => {
    if (el) Plotly.purge(el);
  });
</script>

<div bind:this={el} class="w-full h-52"></div>
