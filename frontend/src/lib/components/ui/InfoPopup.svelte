<!--
	The little "i" button that explains a field.

	Used heavily across the AI and tool forms, because Liatir is for non-technical users first: an input
	called "Max tokens" or "Recycling steps" means nothing without one, and putting the explanation
	behind an icon keeps the form uncluttered for the users who already know.

	The help text is markdown (see `model-help.ts`), so it can contain code spans and emphasis.
-->
<script lang="ts">
  let { text }: { text: string } = $props();
  let open = $state(false);
  let renderedText = $state('');

  // `marked` is imported dynamically: it is a parser we only need when a popup is actually used, so it
  // stays out of the initial bundle.
  $effect(() => {
    // `cancelled` guards against a stale write: if `text` changes (or the component unmounts) while the
    // parse is still running, the finished HTML must not overwrite whatever is current now.
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

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<span class="relative inline-flex items-center leading-none">
  <button
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    aria-label="More information"
    class="inline-flex items-center justify-center ml-1 text-text-faint hover:text-brand transition-colors"
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  </button>

  {#if open}
    <!--
      A full-screen transparent backdrop: clicking anywhere outside the popup closes it. It is a
      `<button>` rather than a `<div>` so it is focusable and keyboard-dismissible, which a bare div
      with a click handler would not be.
    -->
    <button
      type="button"
      aria-label="Close information"
      class="fixed inset-0 z-40 cursor-default bg-transparent"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open = false;
      }}
    ></button>

    <!--
      The popup itself, above the backdrop. It stops click and key events from propagating, so
      interacting with its content does not bubble out and dismiss it — or, when this sits inside a
      pipeline node, drag the node underneath.
    -->
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
        <span class="text-xs font-semibold text-text-secondary flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A948B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Info
        </span>
        <button
          onclick={(e) => { e.stopPropagation(); open = false; }}
          aria-label="Close"
          class="text-text-subtle hover:text-text-secondary transition-colors"
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
