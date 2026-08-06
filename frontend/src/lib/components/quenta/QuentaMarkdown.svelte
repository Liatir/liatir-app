<!--
	Renders a Quenta answer.

	The `{@html}` here is injecting *model-generated* text into the page, which would normally be exactly
	the thing not to do. It is safe only because `renderQuentaMarkdown` sanitises the output — that
	function, not this component, is what makes this sound. Rendering the content any other way (a raw
	{@html}, a different markdown parser) would reintroduce the hole.
-->
<script lang="ts">
  import { renderQuentaMarkdown } from '$lib/quenta/markdown';

  let { content }: { content: string } = $props();
  const rendered = $derived(renderQuentaMarkdown(content));
</script>

<div class="markdown-body text-sm leading-relaxed text-text" data-selectable>
  {@html rendered}
</div>
