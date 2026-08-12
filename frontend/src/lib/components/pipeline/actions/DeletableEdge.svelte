<script lang="ts">
	import NodeWrapper from '../layout/NodeContentWrapper.svelte';
  // Custom edge with a delete button at its midpoint, so connections are easy
  // to remove (the default thin line is hard to select). EdgeLabelRenderer is
  // not exported in this @xyflow/svelte version, so we render a foreignObject.
  import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/svelte';
  import { getContext } from 'svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
	import Icon from '@iconify/svelte';

  let {
    id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd,
  }: EdgeProps = $props();

  // Removal is owned by the pipeline page (single source of truth, deferred to
  // avoid xyflow's bind:edges revert race). See setContext('pipelineEdge', …).
  const edgeActions = getContext('pipelineEdge') as { removeEdgeById: (id: string) => void } | undefined;
  const disabled = $derived(pipelineStore.running);

  // [path, labelX, labelY, offsetX, offsetY]
  const bezier = $derived(getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }));

  function remove(e: MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    edgeActions?.removeEdgeById(id);
  }
</script>

<BaseEdge {id} path={bezier[0]} {style} {markerEnd} />

<foreignObject x={bezier[1] - 11} y={bezier[2] - 11} width="22" height="22" style="overflow: visible; pointer-events: all;">
  <div class="flex items-center justify-center w-full h-full nodrag nopan">
    <button
      type="button"
      onclick={remove}
      onpointerdown={(e) => e.stopPropagation()}
      {disabled}
      title="Remove connection"
      aria-label="Remove connection"
      class="edge-del h-5 w-5 rounded-full bg-surface border border-border-2 shadow-sm flex items-center justify-center
             text-text-subtle hover:text-red-700 hover:border-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
    X
    </button>
  </div>
</foreignObject>

<style>
  /* Discreet by default, fully visible on hover of the button or its edge. */
  .edge-del { opacity: 0.3; transition: opacity 0.15s; }
  .edge-del:hover { opacity: 1; }
  :global(.svelte-flow__edge:hover) .edge-del { opacity: 1; }
</style>