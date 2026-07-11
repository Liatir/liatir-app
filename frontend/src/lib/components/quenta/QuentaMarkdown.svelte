<script lang="ts">
  import { renderQuentaMarkdown } from '$lib/quenta/markdown';

  let { content }: { content: string } = $props();
  const rendered = $derived(renderQuentaMarkdown(content));
</script>

<div class="markdown-body text-sm leading-relaxed text-zinc-800" data-selectable>
  {@html rendered}
</div>
