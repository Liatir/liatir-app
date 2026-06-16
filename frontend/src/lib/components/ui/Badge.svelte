<script lang="ts">
  interface Props {
    variant?: 'running' | 'done' | 'failed' | 'killed' | 'neutral' | 'available' | 'missing';
    pulse?: boolean;
    children?: import('svelte').Snippet;
  }

  let { variant = 'neutral', pulse = false, children }: Props = $props();

  const styles: Record<string, string> = {
    running:   'bg-sky-500/12 text-sky-700 border border-sky-500/30',
    done:      'bg-emerald-500/12 text-emerald-700 border border-emerald-500/30',
    failed:    'bg-red-500/12 text-red-700 border border-red-500/30',
    killed:    'bg-amber-500/12 text-amber-700 border border-amber-500/30',
    neutral:   'bg-zinc-100 text-zinc-600 border border-zinc-300',
    available: 'bg-emerald-500/12 text-emerald-700 border border-emerald-500/30',
    missing:   'bg-red-500/12 text-red-700 border border-red-500/30',
  };

  const dots: Record<string, string> = {
    running:   'bg-sky-500',
    done:      'bg-emerald-500',
    failed:    'bg-red-500',
    killed:    'bg-amber-500',
    neutral:   'bg-zinc-400',
    available: 'bg-emerald-500',
    missing:   'bg-red-500',
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
