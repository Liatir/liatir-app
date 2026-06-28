<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { modulesStore } from '$lib/stores/modules.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import type { LiatirModule } from '$lib/stores/modules.svelte';

  onMount(() => modulesStore.init());

  let importing = $state(false);
  let query = $state('');
  let runtimeFilter = $state<'all' | 'node' | 'wasm'>('all');
  let categoryFilter = $state('All');
  let tagDrafts = $state<Record<string, string>>({});

  const categories = $derived([
    'All',
    ...new Set(modulesStore.modules.map(mod => mod.category).filter(Boolean)),
  ]);

  const visiblePlugins = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return modulesStore.modules.filter(mod => {
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
      const mod = await modulesStore.importFromPicker();
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

  function runtimeLabel(runtime: LiatirModule['runtime']) {
    return runtime === 'wasm' ? 'WASM .lia' : 'Node .lia';
  }

  async function addTag(mod: LiatirModule) {
    const tag = tagDrafts[mod.id]?.trim() ?? '';
    if (!tag) return;
    await modulesStore.addTag(mod.id, tag);
    tagDrafts = { ...tagDrafts, [mod.id]: '' };
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="Plugins"
    description="Imported .lia plugins for Node and WASM runtimes"
    info=".lia plugins are local extensions packaged with a manifest that declares runtime, inputs, and outputs. Node plugins can use the desktop bridge for native Liatir APIs, while WASM plugins run as portable sandboxed tools. Import a .lia file here to inspect, organize, and run it with your parameters."
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

  <div class="flex-1 overflow-y-auto p-6 space-y-5">
    {#if modulesStore.modules.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center gap-3">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-zinc-700">No plugins yet</p>
        <p class="text-xs text-zinc-400 max-w-xs">
          Import a <span class="font-mono">.lia</span> plugin built with <span class="font-mono">liatir build</span>.
        </p>
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
            { value: 'node', label: 'Node .lia' },
            { value: 'wasm', label: 'WASM .lia' },
          ] as runtime}
            <button
              type="button"
              onclick={() => runtimeFilter = runtime.value as 'all' | 'node' | 'wasm'}
              class="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors
                {runtimeFilter === runtime.value
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border bg-surface text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'}"
            >
              {runtime.label}
            </button>
          {/each}

          <div class="ml-auto flex items-center gap-2">
            <!-- <Icon icon="lucide:folder-filter" width="13" height="13" class="text-zinc-400" />
            <select
              bind:value={categoryFilter}
              class="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-zinc-600 outline-none focus:border-brand/60"
            >
              {#each categories as category}
                <option value={category}>{category}</option>
              {/each}
            </select> -->
          </div>
        </div>
      </div>

      {#if visiblePlugins.length === 0}
        <div class="py-16 text-center">
          <p class="text-sm font-medium text-zinc-600">No plugins found</p>
        </div>
      {:else}
      <Card>
        <div class="divide-y divide-border">
          {#each visiblePlugins as mod (mod.id)}
            <div class="flex items-start gap-4 px-4 py-3 group hover:bg-surface-2 transition-colors">

              <div class="h-9 w-9 rounded-lg bg-brand/8 border border-brand/20 flex items-center justify-center shrink-0">
                <Icon icon={mod.runtime === 'wasm' ? 'lucide:box' : 'lucide:package'} width="15" height="15" class="text-brand" />
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <p class="text-sm font-medium text-zinc-800 truncate">{mod.name}</p>
                  <Badge variant={mod.runtime === 'wasm' ? 'neutral' : 'available'}>{runtimeLabel(mod.runtime)}</Badge>
                </div>
                {#if mod.description}
                  <p class="text-xs text-zinc-400 truncate">{mod.description}</p>
                {:else}
                  <p class="text-xs text-zinc-300 truncate font-mono">{mod.path.split(/[\\/]/).pop()}</p>
                {/if}
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-medium border bg-zinc-100 text-zinc-500 border-zinc-200">
                    {mod.category}
                  </span>
                  {#each mod.tags ?? [] as tag}
                    <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border bg-white text-zinc-500 border-zinc-200">
                      {tag}
                      <button
                        type="button"
                        onclick={() => modulesStore.removeTag(mod.id, tag)}
                        class="text-zinc-300 hover:text-red-500"
                        aria-label={`Remove ${tag} tag`}
                      >
                        <Icon icon="lucide:x" width="9" height="9" />
                      </button>
                    </span>
                  {/each}
                </div>
                <div class="mt-2 flex max-w-xs items-center gap-1.5">
                  <input
                    value={tagDrafts[mod.id] ?? ''}
                    placeholder="Tag"
                    oninput={(e) => tagDrafts = { ...tagDrafts, [mod.id]: (e.target as HTMLInputElement).value }}
                    onkeydown={(e) => { if (e.key === 'Enter') addTag(mod); }}
                    class="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-zinc-700 outline-none focus:border-brand/60"
                  />
                  <button
                    type="button"
                    onclick={() => addTag(mod)}
                    class="shrink-0 rounded-lg border border-border bg-surface px-2 py-1 text-zinc-400 hover:text-brand hover:border-brand/40 transition-colors"
                    aria-label={`Add tag to ${mod.name}`}
                  >
                    <Icon icon="lucide:tag" width="12" height="12" />
                  </button>
                </div>
              </div>

              <div class="hidden lg:flex min-w-36 flex-col gap-1 text-xs text-zinc-400">
                <span class="font-mono">v{mod.version}</span>
                <span>{fieldCount(mod.inputSchema)} input{fieldCount(mod.inputSchema) !== 1 ? 's' : ''}</span>
                <span>{fieldCount(mod.outputSchema)} output{fieldCount(mod.outputSchema) !== 1 ? 's' : ''}</span>
              </div>

              <span class="shrink-0 text-xs text-zinc-400 hidden sm:block">{fmtDate(mod.addedAt)}</span>

              <Button variant="primary" size="sm" onclick={() => goto(`/plugins/${mod.id}`)}>
                Run
              </Button>

              <button
                onclick={async () => {
                  const ok = await confirm({ title: 'Remove plugin', message: `Remove "${mod.name}"?`, confirmLabel: 'Remove' });
                  if (ok) modulesStore.remove(mod.id);
                }}
                aria-label="Remove"
                class="shrink-0 text-zinc-300 hover:text-red-500 transition-colors"
              >
                <Icon icon="lucide:trash-2" width="14" height="14" />
              </button>
            </div>
          {/each}
        </div>
      </Card>
      {/if}
    {/if}
  </div>
</div>
