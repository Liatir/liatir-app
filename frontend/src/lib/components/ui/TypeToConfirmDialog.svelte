<script lang="ts">
  interface Props {
    open: boolean;
    phrase?: string;
    title?: string;
    message?: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    open,
    phrase = 'I UNDERSTAND',
    title = 'Confirm action',
    message = 'This action cannot be undone.',
    confirmLabel = 'Confirm',
    onconfirm,
    oncancel,
  }: Props = $props();

  let typed = $state('');

  $effect(() => {
    if (!open) typed = '';
  });

  const canConfirm = $derived(typed === phrase);

  function onKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') oncancel();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div
    role="presentation"
    onclick={oncancel}
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="type-confirm-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      class="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden"
    >
      <!-- Header -->
      <div class="px-5 pt-5 pb-4 border-b border-border">
        <div class="flex items-center gap-2.5 mb-1">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <p id="type-confirm-title" class="text-sm font-semibold text-text">{title}</p>
        </div>
        <p class="text-sm text-text-muted leading-relaxed mt-2">{message}</p>
      </div>

      <!-- Type to confirm -->
      <div class="px-5 py-4">
        <p class="text-xs text-text-muted mb-2">
          Type <span class="font-mono font-semibold text-text-secondary">{phrase}</span> to confirm:
        </p>
        <input
          type="text"
          bind:value={typed}
          autocomplete="off"
          spellcheck="false"
          placeholder={phrase}
          class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text
                 placeholder:text-text-faint focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/20
                 transition-colors"
        />
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-2 px-5 pb-5">
        <button
          onclick={oncancel}
          class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary
                 hover:bg-surface-2 transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={() => { if (canConfirm) onconfirm(); }}
          disabled={!canConfirm}
          class="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors
                 {canConfirm
                   ? 'bg-red-500 hover:bg-red-600 cursor-pointer'
                   : 'bg-red-300 cursor-not-allowed opacity-60'}"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
