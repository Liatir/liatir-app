<!--
	Live command output, styled like a terminal.

	Two things make it usable rather than just a wall of text: it follows the output as it arrives (so
	the user watches the current line, not the first one), and it colours lines by what they *are* —
	commands, successes, errors — so a failure is visible at a glance in a long log.

	Absolute paths are shortened before display, so a `/Users/<name>/…` path does not blow out the
	layout or put the user's home directory on screen.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';

  interface Props {
    lines: string[];
    running: boolean;
  }

  let { lines, running }: Props = $props();
  let el = $state<HTMLElement | null>(null);

  // Auto-scroll to the bottom as output arrives.
  $effect(() => {
    // These two reads exist to register the dependency: the effect must re-run when a line is appended
    // or the running state flips. Without touching them, Svelte would never re-run it.
    lines.length;
    running;
    // After the tick, the new line is in the DOM and scrollHeight includes it.
    tick().then(() => {
      if (el) el.scrollTop = el.scrollHeight;
    });
  });

  function displayLine(line: string): string {
    return sanitizeLocalPathsForDisplay(line, 2);
  }
</script>

{#if lines.length > 0 || running}
  <div
    bind:this={el}
    class="rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-[11px] leading-[1.6]
           px-3 py-2.5 max-h-40 overflow-y-auto select-text"
  >
    <!--
      Lines are colour-coded by their leading marker, which the run helpers emit: `$ ` for the command,
      `✓` for success, `✗` for failure, `→` for a step. The `/error/i` test is the safety net that
      catches a tool's own error output, which carries no marker of ours.
    -->
    {#each lines as line}
      {@const visibleLine = displayLine(line)}
      {#if line.startsWith('$ ')}
        <p class="text-zinc-500">{visibleLine}</p>
      {:else if line.startsWith('✓')}
        <p class="text-emerald-400">{visibleLine}</p>
      {:else if line.startsWith('✗') || /error/i.test(line)}
        <p class="text-red-400">{visibleLine}</p>
      {:else if line.startsWith('→')}
        <p class="text-zinc-500">{visibleLine}</p>
      {:else}
        <p class="text-zinc-300">{visibleLine}</p>
      {/if}
    {/each}
    <!-- A blinking cursor while the process runs: the difference between "still working" and "hung". -->
    {#if running}
      <span class="text-brand animate-pulse select-none">▌</span>
    {/if}
  </div>
{/if}
