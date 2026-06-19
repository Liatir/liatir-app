<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    lines: string[];
    running: boolean;
  }

  let { lines, running }: Props = $props();
  let el = $state<HTMLElement | null>(null);

  $effect(() => {
    lines.length;
    running;
    tick().then(() => {
      if (el) el.scrollTop = el.scrollHeight;
    });
  });
</script>

{#if lines.length > 0 || running}
  <div
    bind:this={el}
    class="rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] leading-[1.6]
           px-3 py-2.5 max-h-40 overflow-y-auto select-text"
  >
    {#each lines as line}
      {#if line.startsWith('$ ')}
        <p class="text-zinc-500">{line}</p>
      {:else if line.startsWith('✓')}
        <p class="text-emerald-400">{line}</p>
      {:else if line.startsWith('✗') || /error/i.test(line)}
        <p class="text-red-400">{line}</p>
      {:else if line.startsWith('→')}
        <p class="text-zinc-500">{line}</p>
      {:else}
        <p class="text-zinc-300">{line}</p>
      {/if}
    {/each}
    {#if running}
      <span class="text-brand animate-pulse select-none">▌</span>
    {/if}
  </div>
{/if}
