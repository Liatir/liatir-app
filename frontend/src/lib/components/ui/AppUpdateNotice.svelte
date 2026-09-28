<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import { appUpdate } from '$lib/stores/appUpdate.svelte';

  const version = $derived(appUpdate.update?.version ?? '');
  const busy = $derived(appUpdate.state === 'installing');
</script>

{#if appUpdate.noticeOpen}
  <div
    class="fixed top-4 right-4 z-40 w-80 rounded-xl border border-border bg-surface text-xs shadow-lg"
    role="status"
    aria-live="polite"
    data-testid="app-update-notice"
  >
    <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
      <span class="font-semibold text-text-secondary">Liatir {version} is available</span>
      <button
        onclick={appUpdate.closeNotice}
        disabled={busy}
        class="text-text-faint transition-colors hover:text-text-muted disabled:opacity-40"
        aria-label="Close"
        data-testid="app-update-notice-close"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="space-y-3 px-4 py-3">
      {#if appUpdate.state === 'available'}
        <p class="text-text-muted">
          You have {appUpdate.update?.currentVersion}. Your data and analyses are kept when you update.
        </p>
      {:else if appUpdate.message}
        <p class={appUpdate.state === 'error' ? 'text-red-400' : 'text-text-muted'} data-testid="app-update-notice-status">
          {appUpdate.message}
          {#if appUpdate.progress !== null}<span class="ml-1 font-mono">{appUpdate.progress}%</span>{/if}
        </p>
      {/if}

      <div class="flex items-center gap-2">
        {#if appUpdate.state === 'ready'}
          <Button variant="primary" size="sm" testId="app-update-notice-restart" onclick={appUpdate.restart}>Restart Liatir</Button>
        {:else if appUpdate.state === 'available' || busy}
          <Button variant="primary" size="sm" loading={busy} testId="app-update-notice-install" onclick={appUpdate.install}>Install update</Button>
        {/if}
        {#if appUpdate.state === 'available'}
          <button
            onclick={appUpdate.skipNoticedVersion}
            class="text-text-subtle underline-offset-2 transition-colors hover:text-text-muted hover:underline"
            data-testid="app-update-notice-skip"
          >Don't show again for this version</button>
        {/if}
      </div>
    </div>
  </div>
{/if}
