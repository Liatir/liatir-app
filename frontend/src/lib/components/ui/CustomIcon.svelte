<!--
	Inlines an SVG file from the app's own static assets.

	Used for the marks the icon set does not provide (the `.lia` plugin icon). Fetching and inlining the
	SVG — rather than pointing an `<img>` at it — is what lets it inherit the surrounding text colour and
	respond to hover, the same way an icon-font glyph would.

	The `{@html}` is safe here because `src` always resolves to a file this app ships; it is never a
	user-supplied or remote URL.
-->
<script lang="ts">
	import { onMount } from "svelte";

  let { src, ...rest } = $props();
  let svg = $state('');

  $effect(() => {
    // `alive` guards the async write: if `src` changes or the component unmounts mid-fetch, the arriving
    // SVG must not overwrite what is current. A failed fetch clears rather than leaves a stale icon.
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