<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { liaPluginsStore } from '$lib/stores/lia-plugins.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import type { LiatirPlugin, PluginRuntime } from '$lib/stores/lia-plugins.svelte';
	import Dot from '$lib/components/ui/Dot.svelte';
	import { openLinkInBrowser } from '$lib';
	import { LIATIR_CLI_NPM_PACKAGE_URL } from '$lib/_constants';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  onMount(() => liaPluginsStore.init());

  let importing = $state(false);
  let query = $state('');
  let runtimeFilter = $state<'all' | PluginRuntime>('all');
  let categoryFilter = $state('All');
  let tagDrafts = $state<Record<string, string>>({});

  const visiblePlugins = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return liaPluginsStore.plugins.filter(mod => {
      const matchesRuntime = runtimeFilter === 'all' || mod.runtime === runtimeFilter;
      const matchesCategory = categoryFilter === 'All' || mod.category === categoryFilter;
      if (!matchesRuntime || !matchesCategory) return false;
      if (!normalizedQuery) return true;
      const searchable = [
        mod.name,
        mod.description,
        mod.version,
        mod.runtime,
        mod.category,
        mod.path.split(/[\\/]/).pop() ?? '',
        ...(mod.tags ?? []),
      ].join(' ').toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  });

  async function importPlugin() {
    importing = true;
    try {
      const mod = await liaPluginsStore.importFromPicker();
      if (mod) goto(`/plugins/${mod.id}`);
    } finally {
      importing = false;
    }
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fieldCount(schema: Record<string, unknown>) {
    return Object.keys(schema).length;
  }

  function runtimeLabel(runtime: LiatirPlugin['runtime']) {
    if (runtime === 'wasm') return 'WASM .lia';
    if (runtime === 'python') return 'Python .lia';
    return 'Node .lia';
  }

  async function addTag(mod: LiatirPlugin) {
    const tag = tagDrafts[mod.id]?.trim() ?? '';
    if (!tag) return;
    await liaPluginsStore.addTag(mod.id, tag);
    tagDrafts = { ...tagDrafts, [mod.id]: '' };
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="Plugins"
    description="Imported .lia plugins for Node, Python, and WASM runtimes"
    info=".lia plugins are local extensions packaged with a manifest that declares runtime, inputs, and outputs. Node plugins can use the desktop bridge, Python plugins run in managed Python environments, and WASM plugins run as portable sandboxed tools. Import a .lia file here to inspect, organize, and run it with your parameters."
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={importPlugin} loading={importing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Import .lia
      </Button>
    {/snippet}
  </PageHeader>
  
  <PageContent>

  <div class="flex-1 overflow-y-auto p-6 space-y-5">
    {#if liaPluginsStore.plugins.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center gap-3">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-zinc-700">No plugins yet</p>
        <div class="text-xs text-zinc-400 max-w-md flex items-center justify-center gap-1">
          Import a <span class="font-mono">.lia</span> plugin built with <button class="min-w-fit flex items-center justify-center gap-1 font-mono hover:bg-brand-hover hover:text-brand-shadow hover:border-brand-shadow cursor-pointer bg-zinc-200/15 py-0.5 px-1.5 rounded-sm border border-zinc-300/50" onclick={()=>{openLinkInBrowser(LIATIR_CLI_NPM_PACKAGE_URL)}}><span>@liatir/cli</span> <Icon class="text-xs opacity-40" icon="lucide:external-link"/></button>
        </div>
        <Button variant="secondary" size="sm" onclick={importPlugin} loading={importing}>
          Import .lia
        </Button>
      </div>

    {:else}
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <Icon icon="lucide:search" width="14" height="14" class="shrink-0 text-zinc-400" />
          <input
            bind:value={query}
            placeholder="Search plugins…"
            class="flex-1 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 outline-none"
          />
          {#if query}
            <button
              type="button"
              onclick={() => query = ''}
              class="text-zinc-400 hover:text-zinc-600 transition-colors"
              aria-label="Clear plugin search"
            >
              <Icon icon="lucide:x" width="13" height="13" />
            </button>
          {/if}
        </div>

        <div class="flex flex-wrap items-center gap-2">
          {#each [
            { value: 'all', label: 'All runtimes' },
            { value: 'node', label: 'Node' },
            { value: 'python', label: 'Python' },
            { value: 'wasm', label: 'WASM' },
          ] as runtime}
            <button
              type="button"
              onclick={() => runtimeFilter = runtime.value as 'all' | PluginRuntime}
              class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
                {runtimeFilter === runtime.value
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-surface text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'}"
            >
              {runtime.label}
            </button>
          {/each}

          <div class="ml-auto flex items-center gap-2"></div>
        </div>
      </div>

      {#if visiblePlugins.length === 0}
        <div class="py-16 text-center">
          <p class="text-sm font-medium text-zinc-600">No plugins found</p>
        </div>
      {:else}
        <div class="grid grid-cols-1 2xl:grid-cols-2 4xl:grid-cols-3 gap-3">
          {#each visiblePlugins as mod (mod.id)}
      <Card class="overflow-hidden">
            <div class="flex items-start gap-4 px-4 py-4 group hover:bg-zinc-100/60 transition-colors">

              <div class="flex-1 justify-between min-w-0 border-r border-r-zinc-200/80 mr-2 pr-2">
                <p class="text-md font-medium text-zinc-800 truncate">{mod.name}</p>
                <div class="flex items-center gap-2 min-w-0 mt-3">
                  <Badge hideDot size="xs" variant="brand">{(runtimeLabel(mod.runtime)).replace(".lia","")}</Badge>
                  <Badge hideDot size="xs" variant="neutral">{mod.category}</Badge>
                </div>
              </div>

              <div class="hidden md:flex min-w-36 flex-col self-stretch justify-between gap-1 text-xs text-zinc-400">
                <span class="font-mono">v{mod.version}</span>
                <div class="flex items-center gap-1.5 opacity-50">
                  <Badge hideDot size='xs'>{fieldCount(mod.inputSchema)} input{fieldCount(mod.inputSchema) !== 1 ? 's' : ''}</Badge>
                  <Badge hideDot size='xs'>{fieldCount(mod.outputSchema)} output{fieldCount(mod.outputSchema) !== 1 ? 's' : ''}</Badge>
                </div>
              </div>

              <button
                onclick={async () => goto(`/plugins/${mod.id}`)}
                aria-label="Run"
                class="shrink-0 text-zinc-300 hover:text-brand transition-colors"
              >
                <Icon icon="lucide:play" width="14" height="14" />
              </button>

              <button
                onclick={async () => {
                  const ok = await confirm({ title: 'Remove plugin', message: `Remove "${mod.name}"?`, confirmLabel: 'Remove' });
                  if (ok) liaPluginsStore.remove(mod.id);
                }}
                aria-label="Remove"
                class="shrink-0 text-zinc-300 hover:text-red-500 transition-colors"
              >
                <Icon icon="lucide:trash-2" width="14" height="14" />
              </button>
            </div>
      </Card>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
  </PageContent>
</div>
