<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    actions?: Snippet;
  }

  let { title, description, actions }: Props = $props();
</script>

<div class="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
  <div>
    <h1 class="text-base font-semibold text-zinc-100">{title}</h1>
    {#if description}
      <p class="mt-0.5 text-xs text-zinc-500">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
