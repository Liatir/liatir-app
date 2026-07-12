<!--
	The standard surface for a panel or a list item.

	`role="button"` is applied only when an `onclick` is given, so a decorative card is not announced to a
	screen reader as something clickable.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    class?: string;
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
    /** Adds the hover affordance. Separate from `onclick` so a card can react without being a button. */
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
