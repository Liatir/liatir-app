<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { pluginsStore } from '$lib/stores/plugins.svelte';
  import { liatir } from '$lib/api';

  let apiVersion = $state<string | null>(null);
  let appVersion = $state<string | null>(null);

  onMount(async () => {
    const api = liatir();
    if (!api) return;
    apiVersion = api.apiVersion ?? null;
    try {
      const info = await api.desktop.app.getInfo();
      appVersion = info?.version ?? null;
    } catch {}
    await pluginsStore.refresh();
  });
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Settings" description="Application info and plugin management" />

  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    <!-- About -->
    <section>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">About</h2>
      <Card class="divide-y divide-border">
        {#each [
          { label: 'Application', value: 'Liatir' },
          { label: 'App Version', value: appVersion ?? '—' },
          { label: 'API Version', value: apiVersion ?? '—' },
        ] as row}
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-zinc-600">{row.label}</span>
            <span class="text-sm font-mono text-zinc-800" data-selectable>{row.value}</span>
          </div>
        {/each}
      </Card>
    </section>

    <!-- WASM Plugins -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">WASM Plugins</h2>
          <p class="text-xs text-zinc-400 mt-0.5">Plugins are stored persistently and auto-available on restart.</p>
        </div>
        <Button variant="secondary" size="sm" onclick={() => pluginsStore.add()} loading={pluginsStore.loading}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add plugin
        </Button>
      </div>

      <Card>
        {#if pluginsStore.loading}
          <div class="py-8 flex justify-center"><Spinner /></div>

        {:else if pluginsStore.modules.length === 0}
          <div class="py-10 text-center space-y-2">
            <p class="text-sm text-zinc-500">No plugins installed.</p>
            <p class="text-xs text-zinc-400 max-w-xs mx-auto">
              Add any <code class="font-mono text-zinc-500">.wasm</code> file compiled for
              <code class="font-mono text-zinc-500">wasm32-wasip1</code>.
              Each plugin gets its own persistent storage directory.
            </p>
          </div>

        {:else}
          <div class="divide-y divide-border">
            {#each pluginsStore.modules as mod}
              <div class="flex items-center gap-3 px-4 py-3">
                <div class="h-7 w-7 rounded-lg bg-brand/20 border border-brand/20 flex items-center justify-center shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                </div>

                <div class="flex-1 min-w-0">
                  <p class="text-sm font-mono font-medium text-zinc-800 truncate">{mod}</p>
                  <p class="text-xs text-zinc-400">Stored in app data · available in Tools</p>
                </div>

                <Badge variant="available">Active</Badge>

                <Button variant="ghost" size="sm" onclick={() => pluginsStore.remove(mod)}>
                  Remove
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </Card>

      {#if pluginsStore.error}
        <p class="mt-2 text-xs text-red-400">{pluginsStore.error}</p>
      {/if}
    </section>

  </div>
</div>
