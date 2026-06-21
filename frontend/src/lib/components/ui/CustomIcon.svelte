<script lang="ts">
	import { onMount } from "svelte";

  let { src, ...rest } = $props();
  let svg = $state('');

  $effect(() => {
    let alive = true;
    fetch(src)
      .then(r => r.text())
      .then(t => { if (alive) svg = t; })
      .catch(() => { if (alive) svg = ''; });
    return () => { alive = false; };
  });

</script>

<span id="custom-icon-wrapper">
    <span {...rest}>{@html svg}</span>
</span>

<style>
    #custom-icon-wrapper span { display: inline-flex; line-height: 0; }
    #custom-icon-wrapper span :global(svg) { width: 100%; height: 100%; }
</style>