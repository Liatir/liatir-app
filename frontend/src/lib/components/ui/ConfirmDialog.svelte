<script lang="ts">
  import { confirmStore } from '$lib/stores/confirm.svelte';

  const TIMEOUT = 30;

  function onKeydown(e: KeyboardEvent) {
    if (!confirmStore.open) return;
    if (e.key === 'Enter') confirmStore.accept();
    if (e.key === 'Escape') confirmStore.cancel();
  }

  const progress = $derived(confirmStore.secondsLeft / TIMEOUT * 100);
</script>

<svelte:window onkeydown={onKeydown} />

{#if confirmStore.open}
  <!-- Backdrop -->
  <div
    role="presentation"
    onclick={confirmStore.cancel}
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center"
  >
    <!-- Dialog -->
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      class="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 overflow-hidden"
    >
      <!-- Header -->
      <div class="px-5 pt-5 pb-4">
        <p id="confirm-title" class="text-sm font-semibold text-text">{confirmStore.title}</p>
        <p class="mt-1.5 text-sm text-text-muted leading-relaxed">{confirmStore.message}</p>
      </div>

      <!-- Countdown bar -->
      <div class="h-px bg-surface-2 mx-5">
        <div
          class="h-full bg-border-2 transition-all duration-1000 ease-linear"
          style="width: {progress}%"
        ></div>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between px-5 py-4">
        <span class="text-[10px] text-text-subtle">Auto-cancels in {confirmStore.secondsLeft}s</span>
        <div class="flex gap-2">
          <button
            onclick={confirmStore.cancel}
            class="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary
                   hover:bg-surface-2 transition-colors"
          >
            {confirmStore.cancelLabel}
          </button>
          <button
            onclick={confirmStore.accept}
            class="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white
                   hover:bg-red-600 transition-colors"
          >
            {confirmStore.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
