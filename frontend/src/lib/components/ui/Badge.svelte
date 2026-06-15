<script lang="ts">
  interface Props {
    variant?: 'running' | 'done' | 'failed' | 'killed' | 'neutral' | 'available' | 'missing';
    pulse?: boolean;
    children?: import('svelte').Snippet;
  }

  let { variant = 'neutral', pulse = false, children }: Props = $props();

  const styles: Record<string, string> = {
    running:   'bg-sky-500/15 text-sky-400 border border-sky-500/25',
    done:      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
    failed:    'bg-red-500/15 text-red-400 border border-red-500/25',
    killed:    'bg-amber-500/15 text-amber-400 border border-amber-500/25',
    neutral:   'bg-zinc-700/40 text-zinc-400 border border-zinc-600/30',
    available: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
    missing:   'bg-red-500/15 text-red-400 border border-red-500/25',
  };

  const dots: Record<string, string> = {
    running:   'bg-sky-400',
    done:      'bg-emerald-400',
    failed:    'bg-red-400',
    killed:    'bg-amber-400',
    neutral:   'bg-zinc-500',
    available: 'bg-emerald-400',
    missing:   'bg-red-400',
  };
</script>

<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium {styles[variant]}">
  <span class="h-1.5 w-1.5 rounded-full {dots[variant]} {pulse && variant === 'running' ? 'animate-pulse' : ''}"></span>
  {#if children}
    {@render children()}
  {:else}
    {variant}
  {/if}
</span>
