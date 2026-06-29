<script lang="ts">
	import type { ButtonSizes, ButtonTypes, ButtonVariants } from '$lib/types/componentes';
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: ButtonVariants;
    size?: ButtonSizes;
    disabled?: boolean;
    loading?: boolean;
    type?: ButtonTypes;
    title?: string;
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
