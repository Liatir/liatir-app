<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    icon?: Snippet;
    title: string;
    description?: string;
    action?: Snippet;
  }

  let { icon, title, description, action }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
  {#if icon}
    <div class="text-zinc-400 mb-1">
      {@render icon()}
    </div>
  {/if}
  <p class="text-sm font-medium text-zinc-700">{title}</p>
  {#if description}
    <p class="text-xs text-zinc-500 max-w-xs">{description}</p>
  {/if}
  {#if action}
    <div class="mt-2">
      {@render action()}
    </div>
  {/if}
</div>
