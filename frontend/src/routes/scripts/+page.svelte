<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { savedScripts, type SavedScript } from '$lib/stores/savedScripts.svelte';

  onMount(() => savedScripts.init());

  // ── folder tree ────────────────────────────────────────────────
  let selectedFolder = $state<string | null>(null); // null = All
  let showNewFolderInput = $state(false);
  let newFolderPath = $state('');
  let newFolderInputEl = $state<HTMLInputElement | null>(null);

  type FolderNode = { name: string; path: string; depth: number };

  function buildFolderTree(paths: string[]): FolderNode[] {
    type Node = { name: string; path: string; children: Map<string, Node> };
    const root = new Map<string, Node>();
    for (const p of [...paths].sort()) {
      const parts = p.split('/');
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i];
        if (!cur.has(key)) {
          cur.set(key, { name: key, path: parts.slice(0, i + 1).join('/'), children: new Map() });
        }
        cur = cur.get(key)!.children;
      }
    }
    const out: FolderNode[] = [];
    function dfs(m: Map<string, Node>, d: number) {
      for (const n of m.values()) { out.push({ name: n.name, path: n.path, depth: d }); dfs(n.children, d + 1); }
    }
    dfs(root, 0);
    return out;
  }

  const flatFolders = $derived(buildFolderTree(savedScripts.allFolderPaths()));
  const visibleScripts = $derived(
    selectedFolder === null ? savedScripts.scripts : savedScripts.byFolder(selectedFolder)
  );

  $effect(() => {
    if (showNewFolderInput && newFolderInputEl) newFolderInputEl.focus();
  });

  function startNewFolder() {
    newFolderPath = selectedFolder !== null ? selectedFolder + '/' : '';
    showNewFolderInput = true;
  }

  async function confirmNewFolder(e: KeyboardEvent | FocusEvent) {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== 'Escape') return;
    if (e instanceof KeyboardEvent && e.key === 'Escape') {
      showNewFolderInput = false; newFolderPath = ''; return;
    }
    const path = newFolderPath.trim().replace(/^\/+|\/+$/g, '');
    if (path) { await savedScripts.createFolder(path); selectedFolder = path; }
    showNewFolderInput = false; newFolderPath = '';
  }

  // ── script actions ─────────────────────────────────────────────
  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function openScript(script: SavedScript) {
    savedScripts.setActive(script.id);
    goto('/code');
  }

  function newScript() {
    savedScripts.setActive(null);
    goto('/code');
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Scripts" description="Saved JavaScript scripts">
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={newScript}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New script
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex flex-1 overflow-hidden">

    <!-- Folder sidebar -->
    <div class="w-44 shrink-0 border-r border-border bg-surface flex flex-col">
      <div class="px-3 py-2 border-b border-border">
        <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Folders</span>
      </div>

      <div class="flex-1 overflow-y-auto py-1">
        <!-- All -->
        <button
          onclick={() => selectedFolder = null}
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors
            {selectedFolder === null
              ? 'bg-brand/8 text-brand font-medium'
              : 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-700'}"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
          <span class="flex-1 text-left">All scripts</span>
          <span class="text-[10px] text-zinc-400">{savedScripts.scripts.length}</span>
        </button>

        {#if flatFolders.length > 0}
          <div class="my-1 mx-3 border-t border-border"></div>
        {/if}

        <!-- Folders -->
        {#each flatFolders as f (f.path)}
          <button
            onclick={() => selectedFolder = f.path}
            style="padding-left: {f.depth * 10 + 12}px"
            class="w-full flex items-center gap-2 pr-3 py-1.5 text-xs transition-colors
              {selectedFolder === f.path
                ? 'bg-brand/8 text-brand font-medium'
                : 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-700'}"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span class="flex-1 text-left truncate">{f.name}</span>
            <span class="text-[10px] text-zinc-400">{savedScripts.byFolder(f.path).length}</span>
          </button>
        {/each}

        <!-- New folder input -->
        {#if showNewFolderInput}
          <div class="px-3 py-2">
            <input
              bind:this={newFolderInputEl}
              bind:value={newFolderPath}
              placeholder="folder/name"
              onkeydown={confirmNewFolder}
              onblur={confirmNewFolder}
              class="w-full text-xs border border-brand/60 rounded px-2 py-1.5
                     bg-surface text-zinc-800 placeholder:text-zinc-400 outline-none"
            />
          </div>
        {/if}
      </div>

      <!-- New folder button -->
      {#if !showNewFolderInput}
        <button
          onclick={startNewFolder}
          class="flex items-center gap-1.5 px-3 py-2.5 text-[11px] text-zinc-400
                 hover:text-zinc-600 transition-colors border-t border-border"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New folder
        </button>
      {/if}
    </div>

    <!-- Main content -->
    <div class="flex-1 overflow-y-auto p-6">

      {#if savedScripts.scripts.length === 0}
        <!-- Global empty state -->
        <div class="flex flex-col items-center justify-center h-full text-center gap-3">
          <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-700">No saved scripts</p>
          <p class="text-xs text-zinc-400 max-w-xs">
            Write a script in the Code editor and save it to find it here.
          </p>
          <Button variant="secondary" size="sm" onclick={newScript}>Open editor</Button>
        </div>

      {:else if visibleScripts.length === 0}
        <!-- Folder empty state -->
        <div class="flex flex-col items-center justify-center h-64 text-center gap-3">
          <div class="h-10 w-10 rounded-xl bg-zinc-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p class="text-sm text-zinc-500">No scripts in this folder</p>
        </div>

      {:else}
        <Card>
          <div class="divide-y divide-border">
            {#each visibleScripts as script (script.id)}
              <div class="flex items-center gap-3 px-4 py-3 group">
                <div class="h-8 w-8 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>

                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-800 truncate">{script.name}</p>
                  <p class="text-xs text-zinc-400">{fmtDate(script.savedAt)}</p>
                </div>

                <!-- Move to folder select -->
                <select
                  value={script.folder}
                  onchange={(e) => savedScripts.move(script.id, e.currentTarget.value)}
                  title="Move to folder"
                  class="shrink-0 text-[10px] border border-border rounded px-1.5 py-1 bg-surface
                         text-zinc-500 cursor-pointer max-w-22 truncate"
                >
                  <option value="">/ Root</option>
                  {#each flatFolders as f}
                    <option value={f.path}>{f.path}</option>
                  {/each}
                </select>

                <button
                  onclick={() => openScript(script)}
                  class="shrink-0 flex items-center gap-1.5 rounded-lg border border-border
                         bg-surface px-2.5 py-1.5 text-xs font-medium text-zinc-600
                         hover:border-brand hover:text-brand transition-colors"
                >
                  Open
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>

                <button
                  onclick={() => savedScripts.remove(script.id)}
                  aria-label="Delete"
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
</div>
