<script lang="ts">
  let { text }: { text: string } = $props();
  let open = $state(false);
  let renderedText = $state('');

  $effect(() => {
    let cancelled = false;
    void (async () => {
      const { parse } = await import('marked');
      const html = await parse(text);
      if (!cancelled) renderedText = html;
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<svelte:window
  onclick={() => { if (open) open = false; }}
  onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
/>

<span class="relative inline-flex items-center leading-none">
  <button
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    aria-label="More information"
    class="inline-flex items-center justify-center ml-1 text-zinc-300 hover:text-brand transition-colors"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  </button>

  {#if open}
    <div
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      class="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
             w-96 rounded-xl border border-border bg-surface shadow-xl"
    >
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Info
        </span>
        <button
          onclick={(e) => { e.stopPropagation(); open = false; }}
          aria-label="Close"
          class="text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <p class="px-4 py-3 text-xs font-medium markdown-body leading-relaxed">{@html (renderedText?.trim() || "")}</p>
    </div>
  {/if}
</span>
