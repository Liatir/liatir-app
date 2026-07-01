<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { pipelineStore, type SavedPipeline } from '$lib/stores/pipeline.svelte';
  import { analysisRuns, type AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';
  import { isExecutablePipelineNode } from '$lib/types/pipeline';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { liatir } from '$lib/api';

  let search = $state('');
  let openMenuId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let renameInput = $state<HTMLInputElement | null>(null);

  onMount(async () => {
    await pipelineStore.init();
    await analysisRuns.init();
  });

  const filtered = $derived(
    pipelineStore.savedPipelines.filter(
      (p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    )
  );

  // Latest recorded run for a saved pipeline (runs are stored newest-first).
  function lastRun(pipelineId: string): AnalysisRunMeta | null {
    return analysisRuns.runs.find(
      (r) => r.tool === 'pipeline' && (r.params?.pipelineId as string) === pipelineId
    ) ?? null;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function openPipeline(p: SavedPipeline) {
    pipelineStore.loadSavedPipeline(p);
    goto('/pipeline');
  }

  function newPipeline() {
    pipelineStore.newPipeline();
    goto('/pipeline');
  }

  async function startRename(p: SavedPipeline) {
    openMenuId = null;
    renamingId = p.id;
    renameDraft = p.name;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  async function commitRename(p: SavedPipeline) {
    const name = renameDraft.trim();
    renamingId = null;
    if (name && name !== p.name) await pipelineStore.renamePipeline(p.id, name);
  }

  async function duplicatePipeline(p: SavedPipeline) {
    openMenuId = null;
    const copy = await pipelineStore.duplicatePipeline(p);
    toast.success(`Duplicated as "${copy.name}"`);
  }

  async function deletePipeline(p: SavedPipeline) {
    openMenuId = null;
    const ok = await confirm({
      title: 'Delete pipeline',
      message: `Delete "${p.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await pipelineStore.deleteSavedPipeline(p.id);
  }

  async function exportPipeline(p: SavedPipeline) {
    openMenuId = null;
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
      const json = (await api.invoke('lia_read_file_text', { path })) as string;
      const p = pipelineStore.importFromJson(json);
      if (!p) {
        toast.error('Invalid pipeline file');
        return;
      }
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
      <!-- Search -->
      <div class="max-w-4xl mb-4">
        <div class="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 shadow-sm max-w-xs">
          <Icon icon="lucide:search" width="13" height="13" class="text-zinc-400 shrink-0" />
          <input
            type="text"
            bind:value={search}
            placeholder="Search pipelines…"
            class="flex-1 min-w-0 text-sm bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
          />
          {#if search}
            <button onclick={() => (search = '')} class="text-zinc-400 hover:text-zinc-600" aria-label="Clear search">
              <Icon icon="lucide:x" width="12" height="12" />
            </button>
          {/if}
        </div>
      </div>

      {#if filtered.length === 0}
        <p class="max-w-4xl text-center text-sm text-zinc-400 py-10">No pipelines match “{search}”.</p>
      {:else}
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
          {#each filtered as p (p.id)}
            {@const stepCount = p.nodes.filter(isExecutablePipelineNode).length}
            {@const pipelineRunning = pipelineStore.isPipelineRunning(p.id)}
            {@const lr = lastRun(p.id)}
            <div class="bg-white rounded-xl border border-border shadow-sm hover:shadow-md hover:border-brand/30 transition-all group relative">
              <!-- Info area: click to open in editor -->
              <div
                role="button"
                tabindex="0"
                onclick={() => { if (renamingId !== p.id) openPipeline(p); }}
                onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && renamingId !== p.id) { e.preventDefault(); openPipeline(p); } }}
                class="w-full text-left p-4 pb-2 cursor-pointer"
              >
                <div class="flex items-start justify-between gap-2 mb-3">
                  <div class="h-9 w-9 rounded-lg bg-brand/8 flex items-center justify-center shrink-0">
                    <Icon icon="lucide:workflow" width="18" height="18" class="text-brand" />
                  </div>
                  <div class="flex flex-col items-end gap-1 mt-0.5">
                    {#if pipelineRunning}
                      <span class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">
                        <span class="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse"></span>
                        Running
                      </span>
                    {:else if lr}
                      <span
                        class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium
                          {lr.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}"
                        title="{lr.status === 'done' ? 'Last run succeeded' : 'Last run failed'} · {fmtDate(lr.endedAt)}"
                      >
                        <Icon icon={lr.status === 'done' ? 'lucide:check' : 'lucide:x'} width="10" height="10" />
                        {lr.status === 'done' ? 'Ran' : 'Failed'} {fmtDate(lr.endedAt)}
                      </span>
                    {/if}
                  </div>
                </div>

                {#if renamingId === p.id}
                  <input
                    bind:this={renameInput}
                    bind:value={renameDraft}
                    onclick={(e) => e.stopPropagation()}
                    onblur={() => commitRename(p)}
                    onkeydown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') { e.preventDefault(); void commitRename(p); }
                      else if (e.key === 'Escape') { e.preventDefault(); renamingId = null; }
                    }}
                    class="w-full rounded border border-brand/40 bg-white px-2 py-1 text-sm font-semibold text-zinc-800 outline-none focus:ring-1 focus:ring-brand/30"
                  />
                {:else}
                  <p class="text-sm font-semibold text-zinc-800 truncate">{p.name}</p>
                {/if}
                <p class="text-xs text-zinc-400 mt-0.5">
                  {stepCount} step{stepCount !== 1 ? 's' : ''}
                  · {p.edges.length} connection{p.edges.length !== 1 ? 's' : ''}
                  · Edited {fmtDate(p.updatedAt)}
                </p>
              </div>

              <!-- Footer actions -->
              <div class="flex items-center gap-1.5 px-4 pb-3">
                <button
                  onclick={() => { openMenuId = null; openPipeline(p); }}
                  class="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 text-brand hover:bg-brand hover:text-white px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  <Icon icon="lucide:pencil" width="11" height="11" />
                  Open
                </button>

                <div class="relative ml-auto">
                  <button
                    onclick={() => (openMenuId = openMenuId === p.id ? null : p.id)}
                    aria-label="More actions"
                    class="flex items-center justify-center h-7 w-7 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                  >
                    <Icon icon="lucide:ellipsis" width="15" height="15" />
                  </button>
                  {#if openMenuId === p.id}
                    <div class="absolute right-0 top-full mt-1 z-30 min-w-40 rounded-lg border border-border bg-white shadow-xl py-1 text-sm overflow-hidden">
                      <button onclick={() => { openMenuId = null; openPipeline(p); }} class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors">
                        <Icon icon="lucide:pencil" width="13" height="13" /> Open in editor
                      </button>
                      <button onclick={() => startRename(p)} class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors">
                        <Icon icon="lucide:text-cursor-input" width="13" height="13" /> Rename
                      </button>
                      <button onclick={() => duplicatePipeline(p)} class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors">
                        <Icon icon="lucide:copy" width="13" height="13" /> Duplicate
                      </button>
                      <button onclick={() => exportPipeline(p)} class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50 transition-colors">
                        <Icon icon="lucide:download" width="13" height="13" /> Export
                      </button>
                      <div class="my-1 border-t border-border/60"></div>
                      <button onclick={() => deletePipeline(p)} disabled={pipelineRunning} class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <Icon icon="lucide:trash-2" width="13" height="13" /> Delete
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/each}

          <!-- New pipeline card -->
          <button
            onclick={newPipeline}
            class="rounded-xl border-2 border-dashed border-border hover:border-brand/40 hover:bg-brand/3 transition-all p-6 flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-brand min-h-32"
          >
            <Icon icon="lucide:plus-circle" width="28" height="28" />
            <span class="text-sm font-medium">New pipeline</span>
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Click-away layer to dismiss the open actions menu -->
{#if openMenuId}
  <div class="fixed inset-0 z-20" role="presentation" onclick={() => (openMenuId = null)} oncontextmenu={(e) => { e.preventDefault(); openMenuId = null; }}></div>
{/if}
