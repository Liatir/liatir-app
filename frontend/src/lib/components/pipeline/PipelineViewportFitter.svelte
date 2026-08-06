<!--
	Frames the whole pipeline in the canvas when one is loaded.

	Renders nothing — it exists only to reach into the canvas from inside it, since the svelte-flow hooks
	are only available to a component within the flow's context.

	The timing is the entire problem here. `fitView` measures node geometry, and nodes have no size until
	the browser has laid them out, so calling it too early frames an empty or wrongly-sized graph. Three
	guards handle that: wait for svelte-flow to report the nodes as initialised, then wait a tick *and* a
	frame for the browser to actually paint them, and refuse to run when there are no nodes to fit.

	`request` is a counter, not a boolean: incrementing it is what asks for a fit. That makes "fit again"
	expressible (loading a second pipeline), while `lastHandledRequest` ensures each request is honoured
	exactly once — otherwise the effect would refit the view on every unrelated canvas change and fight
	the user for control of the viewport.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';

  let { request }: { request: number } = $props();

  const nodesInitialized = useNodesInitialized();
  const { fitView, getNodes } = useSvelteFlow();

  let lastHandledRequest = $state(0);

  async function fitLoadedPipeline() {
    // tick: Svelte has applied the DOM changes. rAF: the browser has laid them out and can be measured.
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await fitView({
      padding: 0.18,
      minZoom: 0.1,
      // Never zoom *in* past 1: a two-node pipeline should not fill the screen at 400%.
      maxZoom: 1,
      // Instant, not animated — this is the initial framing, not a transition the user should watch.
      duration: 0,
    });
  }

  $effect(() => {
    const currentRequest = request;
    const ready = nodesInitialized.current;

    if (!ready || currentRequest <= lastHandledRequest || getNodes().length === 0) return;

    // Marked as handled *before* the async fit, so a re-run of the effect cannot start a second one.
    lastHandledRequest = currentRequest;
    void fitLoadedPipeline();
  });
</script>
