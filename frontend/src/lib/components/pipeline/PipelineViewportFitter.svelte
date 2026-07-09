<script lang="ts">
  import { tick } from 'svelte';
  import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';

  let { request }: { request: number } = $props();

  const nodesInitialized = useNodesInitialized();
  const { fitView, getNodes } = useSvelteFlow();

  let lastHandledRequest = $state(0);

  async function fitLoadedPipeline() {
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await fitView({
      padding: 0.18,
      minZoom: 0.1,
      maxZoom: 1,
      duration: 0,
    });
  }

  $effect(() => {
    const currentRequest = request;
    const ready = nodesInitialized.current;

    if (!ready || currentRequest <= lastHandledRequest || getNodes().length === 0) return;

    lastHandledRequest = currentRequest;
    void fitLoadedPipeline();
  });
</script>
