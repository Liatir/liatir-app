<script lang="ts">
  // Small "remove node" button placed in each pipeline node header.
  // Uses xyflow's deleteElements so deletion works with the mouse on every
  // platform (the keyboard Delete/Backspace path is unreliable on macOS).
  import { useSvelteFlow } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';

  let { id, class: klass = '' }: { id: string; class?: string } = $props();

  const { deleteElements } = useSvelteFlow();
  const disabled = $derived(pipelineStore.running);

  function remove(e: MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    deleteElements({ nodes: [{ id }] });
  }
</script>

<button
  type="button"
  onclick={remove}
  {disabled}
  title="Remove node"
  aria-label="Remove node"
  class="nodrag nopan shrink-0 h-5 w-5 rounded flex items-center justify-center text-zinc-300
         hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed {klass}"
>
  <Icon icon="lucide:x" width="12" height="12" />
</button>
