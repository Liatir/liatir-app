<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { workspaceStore, TEST_WORKSPACE_ID } from '$lib/stores/workspace.svelte';
  import { jobsStore } from '$lib/stores/jobs.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';

  let newName = $state('');
  let creating = $state(false);
  let showNewForm = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  const sortedWorkspaces = $derived(
    [...workspaceStore.workspaces.filter(w => w.id !== TEST_WORKSPACE_ID)]
      .sort((a, b) => {
        if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
        return b.lastOpenedAt - a.lastOpenedAt;
      })
  );

  onMount(async () => {
    if (!workspaceStore.initialized) {
      await workspaceStore.init();
    }
  });

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function relativeDate(ms: number) {
    if (ms === 0) return 'Never opened';
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return fmtDate(ms);
  }

  async function openWorkspace(id: string) {
    await workspaceStore.switchTo(id);
    jobsStore.refresh();
    pipelineStore.init();
    goto('/');
  }

  async function createAndOpen() {
    if (!newName.trim()) return;
    creating = true;
    try {
      const w = await workspaceStore.create(newName.trim());
      await workspaceStore.switchTo(w.id);
      jobsStore.refresh();
      pipelineStore.init();
      goto('/');
    } finally {
      creating = false;
    }
  }

  function showForm() {
    showNewForm = true;
    newName = '';
    setTimeout(() => inputEl?.focus(), 50);
  }
</script>

<div class="flex-1 flex flex-col items-center justify-center px-6 py-12">
  <!-- Logo + title -->
  <div class="flex flex-col items-center gap-3 mb-10">
    <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand shadow-lg shadow-brand/20 p-2.5">
      <img src="/logo/png/logo-white.png" alt="Liatir" class="h-full w-full object-contain" />
    </div>
    <div class="text-center">
      <h1 class="text-xl font-semibold text-zinc-900">Liatir</h1>
      <p class="text-sm text-zinc-500 mt-0.5">Select a workspace to continue</p>
    </div>
  </div>

  <!-- Workspace grid -->
  <div class="w-full max-w-2xl space-y-3">
    {#if sortedWorkspaces.length > 0}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {#each sortedWorkspaces as w, index (w.id)}
          <div class="relative group/card">
            <button
              onclick={() => openWorkspace(w.id)}
              class="group w-full text-left rounded-xl border border-border bg-surface p-4 hover:border-brand/40 hover:bg-brand/5
                     hover:shadow-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 shrink-0">
                    <Icon icon="lucide:folder" width="15" height="15" class="text-brand" />
                  </div>
                  <p class="text-sm font-medium text-zinc-800 truncate group-hover:text-brand transition-colors">
                    {w.name}
                  </p>
                </div>
              </div>
              <div class="mt-3 flex items-center gap-1 text-xs text-zinc-400">
                <span>{relativeDate(w.lastOpenedAt)}</span>
                <div class="bg-border rounded-full w-[2.5px] h-[2.5px]"></div>
                <span>Created {fmtDate(w.createdAt)}</span>
              </div>
            </button>
            <!-- Star / favorite button -->
            <button
              onclick={(e) => { e.stopPropagation(); workspaceStore.toggleFavorite(w.id); }}
              title={w.favorite ? 'Remove from favorites' : 'Add to favorites'}
              class="absolute top-2.5 right-3 p-1 rounded opacity-0 group-hover/card:opacity-100 transition-opacity
                     {w.favorite ? 'opacity-100 text-amber-400 hover:text-amber-500' : 'text-zinc-300 hover:text-amber-400'}"
            >
              <Icon icon={w.favorite ? 'ph:star-fill' : 'ph:star'} width="13" height="13" />
            </button>
          </div>
          {#if index === sortedWorkspaces.length - 1 && sortedWorkspaces.length % 2 !== 0}
            <div class="hidden md:flex group/card items-center justify-center w-full rounded-xl border border-border bg-zinc-900/1 opacity-50">
              <span class="text-sm tracking-wide text-zinc-400/0">Empty box</span>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="rounded-xl border border-dashed border-border p-10 text-center">
        <Icon icon="lucide:folder-plus" width="28" height="28" class="text-zinc-300 mx-auto mb-3" />
        <p class="text-sm font-medium text-zinc-600">No workspaces yet</p>
        <p class="text-xs text-zinc-400 mt-1">Create your first workspace to get started</p>
      </div>
    {/if}

    <!-- New workspace -->
    <div class="mt-2">
      {#if showNewForm}
        <div class="rounded-xl border border-brand/30 bg-brand/5 p-4">
          <p class="text-xs font-medium text-zinc-600 mb-2">New workspace name</p>
          <div class="flex gap-2">
            <input
              bind:this={inputEl}
              bind:value={newName}
              type="text"
              placeholder="e.g. Project Alpha"
              class="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800
                     placeholder:text-zinc-300 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              onkeydown={(e) => { if (e.key === 'Enter') createAndOpen(); if (e.key === 'Escape') { showNewForm = false; } }}
            />
            <Button variant="primary" size="sm" onclick={createAndOpen} loading={creating} disabled={!newName.trim()}>
              Create
            </Button>
            <Button variant="ghost" size="sm" onclick={() => { showNewForm = false; }}>
              Cancel
            </Button>
          </div>
        </div>
      {:else}
        <button
          onclick={showForm}
          class="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3
                 text-sm text-zinc-400 hover:border-brand/40 hover:text-brand hover:bg-brand/5 transition-all duration-150"
        >
          <Icon icon="lucide:plus" width="15" height="15" />
          New workspace
        </button>
      {/if}
    </div>

    <!-- Test Mode entry -->
    <div class="mt-5">
      <!-- <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Sandbox</p> -->
      <button
        onclick={() => openWorkspace(TEST_WORKSPACE_ID)}
        class="group w-full text-left rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3
               hover:border-emerald-400 hover:bg-emerald-50 hover:shadow-sm transition-all duration-150
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 shrink-0">
            <Icon icon="lucide:flask-conical" width="15" height="15" class="text-emerald-600" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-emerald-800 group-hover:text-emerald-700 transition-colors">Test Mode</p>
            <p class="text-xs text-emerald-600/70 truncate">Demo files · Isolated sandbox · Resettable</p>
          </div>
          <Icon icon="lucide:arrow-right" width="14" height="14" class="text-emerald-300 group-hover:text-emerald-500 transition-colors shrink-0" />
        </div>
      </button>
    </div>
  </div>
</div>
