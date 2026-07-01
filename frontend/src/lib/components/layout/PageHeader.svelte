<script lang="ts">
  import type { Snippet } from 'svelte';
  import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import { HEADER_HEIGHT } from '$lib/_constants';

  interface Props {
    title: string;
    info?: string;
    description?: string;
    actions?: Snippet;
  }

  let { title, info, description, actions }: Props = $props();
</script>

<div class="flex items-center justify-between border-b border-border px-6 py-4" style="max-height: {HEADER_HEIGHT}px; min-height: {HEADER_HEIGHT}px;">
  <div>
    <h1 class="text-base font-semibold text-zinc-900 flex items-center">
      {title}
      {#if info}
        <InfoPopup text={info} />
      {/if}
    </h1>
    {#if description}
      <p class="mt-0.5 text-[11px] text-zinc-500 max-md:hidden">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
