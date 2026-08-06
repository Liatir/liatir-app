

<!--
	The status dot. Shares its variant names with Badge, so the two always agree on a colour.

	Only `running` pulses (see the class binding at the bottom): the animation means "this is still
	happening", so applying it to a finished state would be a lie the user would have to learn to ignore.
-->
<script lang="ts">

  export type DotVariant = 'running' | 'done' | 'failed' | 'killed' | 'neutral' | 'available' | 'missing' | 'brand';
  type DotSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

  interface Props {
    variant?: DotVariant;
    pulse?: boolean;
    size?: DotSize;
    classes?: string;
  }

  let { variant = 'neutral', pulse = false, size = 'md', classes }: Props = $props();

  const dotSizes: Record<DotSize, string> = {
    xs: 'h-0.5 w-0.5',
    sm: 'h-1 w-1', 
    md: 'h-1.5 w-1.5',
    lg: 'h-2.5 w-2.5',
    xl: 'h-3.5 w-3.5',
  }

  const dots: Record<DotVariant, string> = {
    running:   'bg-sky-500',
    done:      'bg-emerald-500',
    failed:    'bg-red-500',
    killed:    'bg-amber-500',
    neutral:   'bg-text-subtle',
    brand:     'bg-brand',
    available: 'bg-emerald-500',
    missing:   'bg-red-500',
  };
</script>


<span class="{dotSizes[size]} rounded-full {dots[variant]} {pulse && variant === 'running' ? 'animate-pulse' : ''} {classes??""}"></span>