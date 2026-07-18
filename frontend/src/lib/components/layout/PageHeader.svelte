<!--
	The header every page sits under.

	Its height is pinned to the shared HEADER_HEIGHT constant — both min and max — because other things
	position themselves against it (the floating Quenta button, scroll containers). Letting it grow with
	its content would silently shift those.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import { HEADER_HEIGHT } from '$lib/_constants';

  interface Props {
    title: string;
    /** Explains what this page is for — the same "i" affordance the form fields use. */
    info?: string;
    description?: string;
    descriptionOnTop?: boolean;
    /** Rendered beside the title (e.g. a back button). */
    titleActions?: Snippet;
    /** Rendered on the right (e.g. Run, Save). */
    actions?: Snippet;
  }

  let { title, info, description, descriptionOnTop, titleActions, actions }: Props = $props();
</script>

<div class="flex items-center justify-between border-b border-border px-6 py-4" style="max-height: {HEADER_HEIGHT}px; min-height: {HEADER_HEIGHT}px;">
  <div class="flex min-w-0 items-center gap-3">
    {#if titleActions}
      <div class="flex shrink-0 flex-col items-center gap-1">
        {@render titleActions()}
      </div>
    {/if}
    <div class="min-w-0 space-y-1">
      {#if description && descriptionOnTop}
        <div class="mt-0.5 text-[11px] text-text-muted max-md:hidden">{@html description}</div>
      {/if}
      <h1 class="flex items-center text-[15px] font-semibold text-text">
        {title}
        {#if info}
          <InfoPopup text={info} />
        {/if}
      </h1>
      {#if description && !descriptionOnTop}
        <div class="mt-0.5 text-[11px] text-text-muted max-md:hidden">{@html description}</div>
      {/if}
    </div>
  </div>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>