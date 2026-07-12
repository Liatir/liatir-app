<!--
	Status pill: a coloured dot plus a label.

	The variants are the app's *actual* states — a job is running/done/failed/killed, a dependency is
	available/missing — not abstract colours. So a status is rendered by naming it, and "what does failed
	look like" is answered once, here. The dot and the badge share the same variant names (see Dot.svelte)
	precisely so the two can never disagree about what red means.

	Falling back to rendering the variant name when no children are given is a small convenience: a badge
	that just says "running" needs no content.
-->
<script lang="ts">
	import Dot, { type DotVariant } from './Dot.svelte';


  export type BadgeVariants = 'running' | 'done' | 'failed' | 'killed' | 'neutral' | 'available' | 'missing' | 'brand';
  type BadgeSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

  interface Props {
    variant?: BadgeVariants;
    hideDot?: boolean;
    pulse?: boolean;
    size?: BadgeSize;
    classes?: string;
    children?: import('svelte').Snippet;
  }

  let { variant='neutral', pulse = false, children, hideDot, size='sm', classes }: Props = $props();

  let dotVariant: DotVariant = $derived(variant as DotVariant);
  
  const styles: Record<BadgeVariants, string> = {
    running:   'bg-sky-500/12 text-sky-700 border border-sky-500/30',
    done:      'bg-emerald-500/12 text-emerald-700 border border-emerald-500/30',
    failed:    'bg-red-500/12 text-red-700 border border-red-500/30',
    killed:    'bg-amber-500/12 text-amber-700 border border-amber-500/30',
    neutral:   'bg-zinc-100 text-zinc-600 border border-zinc-300',
    brand:     'bg-brand/12 text-brand border border-brand/30',
    available: 'bg-emerald-500/12 text-emerald-700 border border-emerald-500/30',
    missing:   'bg-red-500/12 text-red-700 border border-red-500/30',
  };

  const sizes: Record<BadgeSize, string> = {
    xs: 'gap-1 px-1.5 py-0.5 text-[10px]',
    sm: 'gap-1.5 px-2 py-0.5 text-xs', 
    md: 'gap-1.5 px-2 py-0.5 text-sm',
    lg: 'gap-1.5 px-2 py-0.5 text-md',
    xl: 'gap-1.5 px-2.5 py-0.5 text-lg',
  }
</script>

<span class="inline-flex items-center {sizes[size]} rounded-full font-medium {styles[variant]} {classes??''}">
  {#if !hideDot}<Dot variant={dotVariant} pulse />{/if}
  {#if children}
    {@render children()}
  {:else}
    {variant}
  {/if}
</span>
