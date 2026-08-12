<!--
	The pipeline's entry point.

	Purely structural: it holds no data and does no work. It exists so the graph has an unambiguous
	beginning — a visible anchor to drag the first step from, and a fixed root for the executor to walk
	from. Hence the single source Handle and no target: nothing can feed *into* the start.
-->
<script lang="ts">
	import NodeWrapper from './layout/NodeContentWrapper.svelte';
  import { Handle, Position } from '@xyflow/svelte';
  import type { Node, NodeProps } from '@xyflow/svelte';

  let {}: NodeProps<Node<Record<string, unknown>>> = $props();
</script>

<NodeWrapper>

<div class="flex items-center gap-2 px-4 py-2.5 rounded-full border-2 border-brand bg-brand/10 shadow-sm">
  <div class="h-2.5 w-2.5 rounded-full bg-brand"></div>
  <span class="text-sm font-semibold text-brand">Start</span>
</div>

<Handle type="source" position={Position.Right} id="out" />

</NodeWrapper>