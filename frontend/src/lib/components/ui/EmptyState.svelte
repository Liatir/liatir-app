<!--
	What a list shows when it has nothing in it.

	An empty screen is a dead end for a new user, so an empty state is treated as a first-class thing
	rather than an afterthought: it names what is missing (`title`), explains why that might be
	(`description`), and — through `action` — offers the way out. "No files in Data yet" plus an *Add
	files* button is the difference between a user getting started and a user getting stuck.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    icon?: Snippet;
    title: string;
    description?: string;
    /** The way forward — typically a button that creates the thing that is missing. */
    action?: Snippet;
  }

  let { icon, title, description, action }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
  {#if icon}
    <div class="text-text-subtle mb-1">
      {@render icon()}
    </div>
  {/if}
  <p class="text-sm font-medium text-text-secondary">{title}</p>
  {#if description}
    <p class="text-xs text-text-muted max-w-xs">{description}</p>
  {/if}
  {#if action}
    <div class="mt-2">
      {@render action()}
    </div>
  {/if}
</div>
