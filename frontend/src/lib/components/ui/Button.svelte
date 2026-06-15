<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    size = 'md',
    disabled = false,
    loading = false,
    type = 'button',
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
      'bg-[var(--color-surface-3)] hover:bg-[var(--color-border-2)] text-zinc-200 border border-[var(--color-border)]',
    ghost:
      'hover:bg-[var(--color-surface-2)] text-zinc-400 hover:text-zinc-100',
    danger:
      'bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/40',
  };
</script>

<button
  {type}
  class="{base} {sizes[size]} {variants[variant]}"
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
