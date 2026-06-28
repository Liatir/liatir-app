<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { pipelineStore, type SavedPipeline } from '$lib/stores/pipeline.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { liatir } from '$lib/api';

  onMount(() => pipelineStore.init());

  function fmtDate(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function openPipeline(p: SavedPipeline) {
    pipelineStore.loadSavedPipeline(p);
    goto('/pipeline');
  }

  function newPipeline() {
    pipelineStore.newPipeline();
    goto('/pipeline');
  }

  async function deletePipeline(p: SavedPipeline) {
    const ok = await confirm({
      title: 'Delete pipeline',
      message: `Delete "${p.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await pipelineStore.deleteSavedPipeline(p.id);
  }

  async function exportPipeline(p: SavedPipeline) {
    const api = liatir();
    if (!api) return;
    const json = pipelineStore.exportToJson(p);
    const safeName = p.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-') || 'pipeline';
    try {
      const path = await api.desktop.files.save(`${safeName}.json`);
      if (!path) return;
      await api.invoke('lia_write_file_path', { path, content: json });
      toast.success('Pipeline exported');
    } catch {
      toast.error('Export failed');
    }
  }

  async function importPipeline() {
    const api = liatir();
    if (!api) return;
    try {
      const result = await api.desktop.files.open({ multi: false, allowed: ['json'] });
      const path = result?.paths?.[0];
      if (!path) return;
      const json = await api.invoke('lia_read_file_text', { path }) as string;
      const p = pipelineStore.importFromJson(json);
      if (!p) { toast.error('Invalid pipeline file'); return; }
      await pipelineStore.addImported(p);
      toast.success(`Imported "${p.name}"`);
    } catch {
      toast.error('Import failed');
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="Pipelines" description="Manage and run your saved analysis workflows">
    {#snippet actions()}
      <Button variant="ghost" size="sm" onclick={importPipeline}>
        <Icon icon="lucide:upload" width="13" height="13" />
        Import
      </Button>
      <Button variant="primary" size="sm" onclick={newPipeline}>
        <Icon icon="lucide:plus" width="13" height="13" />
        New pipeline
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    {#if pipelineStore.savedPipelines.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div class="h-16 w-16 rounded-2xl bg-white border border-border shadow-sm flex items-center justify-center">
          <Icon icon="lucide:workflow" width="28" height="28" class="text-zinc-300" />
        </div>
        <div>
          <p class="text-sm font-medium text-zinc-600">No saved pipelines</p>
          <p class="text-xs text-zinc-400 mt-1">Create a pipeline in the editor and save it to see it here.</p>
        </div>
        <Button variant="secondary" onclick={newPipeline}>
          <Icon icon="lucide:plus" width="13" height="13" />
          Create pipeline
        </Button>
      </div>
    {:else}
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
        {#each pipelineStore.savedPipelines as p (p.id)}
          {@const stepCount = p.nodes.filter(n => n.type !== 'start').length}
          <div class="bg-white rounded-xl border border-border shadow-sm hover:shadow-md hover:border-brand/30 transition-all group">
            <button
              onclick={() => openPipeline(p)}
              class="w-full text-left p-4"
            >
              <div class="flex items-start justify-between gap-2 mb-3">
                <div class="h-9 w-9 rounded-lg bg-brand/8 flex items-center justify-center shrink-0">
                  <Icon icon="lucide:workflow" width="18" height="18" class="text-brand" />
                </div>
                <span class="text-[11px] text-zinc-400 mt-1">{fmtDate(p.updatedAt)}</span>
              </div>
              <p class="text-sm font-semibold text-zinc-800 truncate">{p.name}</p>
              <p class="text-xs text-zinc-400 mt-0.5">
                {stepCount} step{stepCount !== 1 ? 's' : ''}
                · {p.edges.length} connection{p.edges.length !== 1 ? 's' : ''}
              </p>
            </button>
            <div class="flex items-center gap-1 px-3 pb-3 opacity-30 group-hover:opacity-100 transition-opacity">
              <button
                onclick={() => deletePipeline(p)}
                class="flex items-center w-fit justify-center gap-1.5 text-xs text-zinc-400 bg-zinc-50 hover:text-red-500 hover:bg-red-50 rounded-lg px-2 py-1.5 transition-colors"
              >
                <Icon icon="lucide:trash-2" width="11" height="11" />
              </button>
              <button
                onclick={() => exportPipeline(p)}
                class="flex items-center w-fit justify-center gap-1.5 text-xs text-zinc-400 bg-zinc-50 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg px-2 py-1.5 transition-colors"
                title="Export pipeline"
              >
                <Icon icon="lucide:download" width="11" height="11" />
              </button>
              <button
                onclick={() => openPipeline(p)}
                class="flex items-center w-fit justify-center gap-1.5 text-xs text-zinc-400 bg-zinc-50 hover:text-brand hover:bg-brand/10 rounded-lg px-2 py-1.5 transition-colors"
              >
                <Icon icon="lucide:pencil" width="11" height="11" />
              </button>
            </div>
          </div>
        {/each}

        <!-- New pipeline card -->
        <button
          onclick={newPipeline}
          class="rounded-xl border-2 border-dashed border-border hover:border-brand/40 hover:bg-brand/3 transition-all p-6 flex flex-col items-center gap-2 text-zinc-400 hover:text-brand"
        >
          <Icon icon="lucide:plus-circle" width="28" height="28" />
          <span class="text-sm font-medium">New pipeline</span>
        </button>
      </div>
    {/if}
  </div>
</div>
