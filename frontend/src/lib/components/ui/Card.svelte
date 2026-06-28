<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
    hoverable?: boolean;
  }


  let { class: cls = '', children, onclick, hoverable = false }: Props = $props();
</script>

<div
  class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] {hoverable
    ? 'cursor-pointer hover:border-[var(--color-border-2)] hover:bg-[var(--color-surface-2)] transition-colors duration-150'
    : ''} {cls}"
  {onclick}
  role={onclick ? 'button' : undefined}
>
  {@render children()}
</div>
