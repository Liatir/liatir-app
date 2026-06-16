<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { offlab } from '$lib/api';
  import { fmtDuration } from '$lib/utils';
  import { pluginsStore } from '$lib/stores/plugins.svelte';

  const name = $derived(decodeURIComponent($page.params.name ?? ''));

  let payload = $state('{}');
  let running = $state(false);
  let result = $state<unknown>(null);
  let stdout = $state<string | null>(null);
  let stderr = $state<string | null>(null);
  let error = $state<string | null>(null);
  let startedAt = $state<number | null>(null);
  let duration = $state<string | null>(null);
  let payloadError = $state<string | null>(null);

  function validatePayload(): unknown | null {
    try {
      const parsed = JSON.parse(payload);
      payloadError = null;
      return parsed;
    } catch (e) {
      payloadError = `Invalid JSON: ${String(e)}`;
      return null;
    }
  }

  async function run() {
    const parsed = validatePayload();
    if (parsed === null) return;

    const api = offlab();
    if (!api) return;

    running = true;
    result = null;
    stdout = null;
    stderr = null;
    error = null;
    startedAt = Date.now();

    try {
      const res = await api.plugins.call(name, parsed);
      result = res?.value ?? res;
      stdout = res?.stdout ?? null;
      stderr = res?.stderr ?? null;
      if (!res?.ok && res?.error) error = res.error;
      duration = fmtDuration(startedAt!, Date.now());
    } catch (e) {
      error = String(e);
      duration = fmtDuration(startedAt!, Date.now());
    } finally {
      running = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      payload = payload.slice(0, start) + '  ' + payload.slice(end);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      run();
    }
  }

  function formatJson(v: unknown): string {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  onMount(() => pluginsStore.refresh());
</script>

<div class="flex flex-col h-full">
  <PageHeader title={name} description="Custom WASM plugin">
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={() => goto('/tools')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        Back
      </Button>
      <Button variant="danger" size="sm" onclick={() => { pluginsStore.remove(name); goto('/tools'); }}>
        Remove
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6 space-y-4">

    <!-- Payload editor -->
    <Card class="p-5 space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-zinc-900">Payload <span class="text-zinc-400 font-normal text-xs">(JSON)</span></h2>
        <span class="text-[11px] text-zinc-400">⌘↵ to run</span>
      </div>

      <textarea
        data-selectable
        bind:value={payload}
        onkeydown={handleKeydown}
        rows="8"
        spellcheck="false"
        class="w-full rounded-lg border border-border bg-surface-2 px-4 py-3
               font-mono text-sm text-zinc-700 placeholder:text-zinc-400 outline-none resize-y
               focus:border-brand transition-colors leading-relaxed"
      ></textarea>

      {#if payloadError}
        <p class="text-xs text-red-400">{payloadError}</p>
      {/if}

      <div class="flex items-center gap-3">
        <Button variant="primary" disabled={running} loading={running} onclick={run}>
          Run
        </Button>
        <Button variant="ghost" size="sm" onclick={() => { payload = '{}'; }}>
          Reset
        </Button>
        {#if running && startedAt}
          <span class="text-xs text-zinc-500">{fmtDuration(startedAt)}</span>
        {/if}
      </div>
    </Card>

    <!-- Error -->
    {#if error}
      <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 font-mono" data-selectable>
        {error}
      </div>
    {/if}

    <!-- Result -->
    {#if result !== null}
      <Card class="p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Result</h2>
          {#if duration}
            <span class="text-xs text-zinc-400">{duration}</span>
          {/if}
        </div>
        <pre class="text-sm font-mono text-emerald-700 whitespace-pre-wrap break-all leading-relaxed" data-selectable>{formatJson(result)}</pre>
      </Card>
    {/if}

    <!-- Stdout / Stderr -->
    {#if stdout}
      <Card class="p-4">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">stdout</h2>
        <pre class="text-xs font-mono text-zinc-700 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto" data-selectable>{stdout}</pre>
      </Card>
    {/if}

    {#if stderr}
      <Card class="p-4">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">stderr</h2>
        <pre class="text-xs font-mono text-amber-700 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto" data-selectable>{stderr}</pre>
      </Card>
    {/if}

  </div>
</div>
