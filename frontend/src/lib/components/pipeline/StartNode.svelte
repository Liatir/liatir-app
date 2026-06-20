<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
</script>

<div class="flex items-center gap-2 px-4 py-2.5 rounded-full border-2 border-brand bg-brand/10 shadow-sm">
  <div class="h-2.5 w-2.5 rounded-full bg-brand"></div>
  <span class="text-sm font-semibold text-brand">Start</span>
</div>

<Handle type="source" position={Position.Right} id="out" />
