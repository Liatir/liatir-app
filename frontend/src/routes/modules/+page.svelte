<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { modulesStore } from '$lib/stores/modules.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';

  onMount(() => modulesStore.init());

  let importing = $state(false);

  async function importModule() {
    importing = true;
    try {
      const mod = await modulesStore.importFromPicker();
      if (mod) goto(`/modules/${mod.id}`);
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
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="Modules"
    description=".lia modules you can run from here"
    info=".lia modules are Node.js tools distributed as signed zip archives containing compiled code plus an input/output manifest. When you run a module, Liatir extracts the bundle into a temporary directory and launches it with Node.js. The script automatically connects to the app through the local IPC server and can use Liatir APIs to start processes (`samtools`, `nextflow`, ...), read files, check dependencies, and more. To create a module, install **liatir-cli** (`npm i -g liatir-cli`), then run: `liatir init my-tool` → `cd my-tool && npm install` → `liatir build` → `my-tool.lia`. Import the .lia file here and run it with your parameters."
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={importModule} loading={importing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Import .lia
      </Button>
      <div class="w-px bg-border self-stretch"></div>
      <Button variant="secondary" size="sm" onclick={()=>goto("/code")}>
        Test API
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    {#if modulesStore.modules.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-center gap-3">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
        </div>
        <p class="text-sm font-medium text-zinc-700">No modules yet</p>
        <p class="text-xs text-zinc-400 max-w-xs">
          Import a <span class="font-mono">.lia</span> module built with <span class="font-mono">liatir build</span>.
        </p>
        <Button variant="secondary" size="sm" onclick={importModule} loading={importing}>
          Import .lia
        </Button>
      </div>

    {:else}
      <Card>
        <div class="divide-y divide-border">
          {#each modulesStore.modules as mod (mod.id)}
            <div class="flex items-center gap-4 px-4 py-3 group hover:bg-surface-2 transition-colors">

              <div class="h-9 w-9 rounded-lg bg-brand/8 border border-brand/20 flex items-center justify-center shrink-0">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="text-brand">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-zinc-800 truncate">{mod.name}</p>
                {#if mod.description}
                  <p class="text-xs text-zinc-400 truncate">{mod.description}</p>
                {:else}
                  <p class="text-xs text-zinc-300 truncate font-mono">{mod.path.split(/[\\/]/).pop()}</p>
                {/if}
              </div>

              <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium border bg-zinc-100 text-zinc-500 border-zinc-200">
                v{mod.version}
              </span>

              <span class="shrink-0 text-xs text-zinc-400">
                {fieldCount(mod.inputSchema)} input{fieldCount(mod.inputSchema) !== 1 ? 's' : ''}
              </span>

              <span class="shrink-0 text-xs text-zinc-400 hidden sm:block">{fmtDate(mod.addedAt)}</span>

              <Button variant="primary" size="sm" onclick={() => goto(`/modules/${mod.id}`)}>
                Run
              </Button>

              <button
                onclick={async () => {
                  const ok = await confirm({ title: 'Remove module', message: `Remove "${mod.name}"?`, confirmLabel: 'Remove' });
                  if (ok) modulesStore.remove(mod.id);
                }}
                aria-label="Remove"
                class="shrink-0 text-zinc-300 hover:text-red-500 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          {/each}
        </div>
      </Card>
    {/if}
  </div>
</div>
