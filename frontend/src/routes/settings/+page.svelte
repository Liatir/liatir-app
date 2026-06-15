<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { offlab } from '$lib/api';

  let apiVersion = $state<string | null>(null);
  let appVersion = $state<string | null>(null);
  let pluginModules = $state<string[]>([]);
  let loadingPlugins = $state(false);

  onMount(async () => {
    const api = offlab();
    if (!api) return;
    apiVersion = api.apiVersion ?? null;
    try {
      const info = await api.desktop.app.getInfo();
      appVersion = info?.version ?? null;
    } catch {}
    await refreshPlugins();
  });

  async function refreshPlugins() {
    const api = offlab();
    if (!api) return;
    loadingPlugins = true;
    try {
      pluginModules = await api.plugins.list();
    } finally {
      loadingPlugins = false;
    }
  }

  async function addPlugin() {
    const api = offlab();
    if (!api) return;
    try {
      await api.plugins.add('');
      await refreshPlugins();
    } catch (e) {
      console.error(e);
    }
  }

  async function removePlugin(name: string) {
    const api = offlab();
    if (!api) return;
    await api.plugins.remove(name);
    await refreshPlugins();
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Settings" description="Application preferences and plugin management" />

  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    <!-- App info -->
    <section>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">About</h2>
      <Card class="divide-y divide-border">
        {#each [
          { label: 'Application', value: 'Offlab' },
          { label: 'App Version', value: appVersion ?? '—' },
          { label: 'API Version', value: apiVersion ?? '—' },
        ] as row}
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-zinc-400">{row.label}</span>
            <span class="text-sm font-mono text-zinc-200" data-selectable>{row.value}</span>
          </div>
        {/each}
      </Card>
    </section>

    <!-- WASM plugin modules -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider">WASM Plugins</h2>
        <Button variant="secondary" size="sm" onclick={addPlugin}>Add module</Button>
      </div>

      <Card>
        {#if loadingPlugins}
          <div class="py-6 flex justify-center">
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500"></div>
          </div>
        {:else if pluginModules.length === 0}
          <div class="py-8 text-center">
            <p class="text-sm text-zinc-500">No WASM modules loaded.</p>
            <p class="text-xs text-zinc-600 mt-1">
              Add a <code class="font-mono">.wasm</code> file compiled for <code class="font-mono">wasm32-wasip1</code>.
            </p>
          </div>
        {:else}
          <div class="divide-y divide-border">
            {#each pluginModules as mod}
              <div class="flex items-center justify-between px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                  <span class="text-sm font-mono text-zinc-200">{mod}</span>
                </div>
                <Button variant="ghost" size="sm" onclick={() => removePlugin(mod)}>Remove</Button>
              </div>
            {/each}
          </div>
        {/if}
      </Card>
    </section>

  </div>
</div>
