<!--
	The shared button.

	Every button in the app goes through here, so the visual language stays consistent and a change to
	(say) what "danger" looks like happens in one place. The variants are semantic — `danger`, `warn`,
	`sandbox` — not colour names, so a call site declares *what the action means* and this component
	decides how that looks.
-->
<script lang="ts">
	import type { ButtonSizes, ButtonTypes, ButtonVariants } from '$lib/types/componentes';
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: ButtonVariants;
    size?: ButtonSizes;
    disabled?: boolean;
    /**
     * Shows a spinner and, below, also disables the button (`disabled={disabled || loading}`) — so an
     * in-flight action cannot be fired a second time by an impatient click.
     */
    loading?: boolean;
    type?: ButtonTypes;
    title?: string;
    ariaLabel?: string;
    /** Hook for the end-to-end tests to find this button. */
    testId?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    disabled = false,
    loading = false,
    type = 'button',
    title,
    ariaLabel,
    testId,
    class: className = '',
    onclick,
    children,
  }: Props = $props();

  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed';

  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };

  // Semantic, not decorative: `danger` is for destructive actions, `warn` for reversible-but-notable
  // ones, and `sandbox` marks anything acting on the isolated plugin-dev workspace — a visual cue that
  // the user is not touching their real data.
  const variants: Record<string, string> = {
    primary:
      'bg-brand hover:bg-brand-hover text-white shadow-sm shadow-brand-shadow/30',
    secondary:
      'bg-[var(--color-surface-3)] hover:bg-[var(--color-border-2)] text-zinc-700 border border-[var(--color-border)]',
    ghost:
      'hover:bg-[var(--color-surface-2)] text-zinc-500 hover:text-zinc-800',
    danger:
      'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/40',
    warn:
      'bg-amber-50 hover:bg-amber-100 text-amber-500 border border-amber-400',
    sandbox:
      'bg-sandbox-50 hover:bg-sandbox-100 text-sandbox-500 border border-sandbox-400',
  };
</script>

<button
  {type}
  {title}
  aria-label={ariaLabel}
  data-testid={testId}
  class="{base} {sizes[size]} {variants[variant]} {className}"
  disabled={disabled || loading}
  {onclick}
>
  {#if loading}
    <svg class="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  {/if}
  {@render children()}
</button>
