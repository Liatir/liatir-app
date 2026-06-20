<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { dataFiles, type DataFile } from '$lib/stores/dataFiles.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { liatir } from '$lib/api';

  onMount(async () => {
    await dataFiles.init();
    dataFiles.checkMissing();
  });

  // ── folder tree ────────────────────────────────────────────────
  let selectedFolder = $state<string | null>(null);
  let showNewFolderInput = $state(false);
  let newFolderPath = $state('');
  let newFolderInputEl = $state<HTMLInputElement | null>(null);

  let renamingFolder = $state<string | null>(null);
  let renameValue = $state('');
  let renameInputEl = $state<HTMLInputElement | null>(null);

  type FolderNode = { name: string; path: string; depth: number; hasChildren: boolean };

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
      for (const n of m.values()) {
        out.push({ name: n.name, path: n.path, depth: d, hasChildren: n.children.size > 0 });
        dfs(n.children, d + 1);
      }
    }
    dfs(root, 0);
    return out;
  }

  let collapsedFolders = $state(new Set<string>());
  let foldersInitialized = $state(false);

  function toggleCollapse(path: string) {
    const next = new Set(collapsedFolders);
    if (next.has(path)) next.delete(path); else next.add(path);
    collapsedFolders = next;
  }

  const flatFolders = $derived(buildFolderTree(dataFiles.allFolderPaths()));

  // Collapse all parent folders on first load
  $effect(() => {
    if (!foldersInitialized && flatFolders.length > 0) {
      collapsedFolders = new Set(flatFolders.filter(f => f.hasChildren).map(f => f.path));
      foldersInitialized = true;
    }
  });

  const visibleFolders = $derived(
    flatFolders.filter(f => {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (collapsedFolders.has(parts.slice(0, i).join('/'))) return false;
      }
      return true;
    })
  );

  // Recursive count: files in folder + all subfolders
  function countInFolder(folderPath: string): number {
    return dataFiles.files.filter(f =>
      f.folder === folderPath || f.folder.startsWith(folderPath + '/')
    ).length;
  }

  // Direct subfolders of the selected folder
  const selectedSubfolders = $derived(
    selectedFolder === null ? [] :
    flatFolders.filter(f => {
      const selParts = selectedFolder.split('/');
      const fParts = f.path.split('/');
      return fParts.length === selParts.length + 1 && f.path.startsWith(selectedFolder + '/');
    })
  );

  // Only direct files in selected folder; all files when "All files" selected
  const visibleFiles = $derived(
    selectedFolder === null
      ? dataFiles.files
      : dataFiles.files.filter(f => f.folder === selectedFolder)
  );

  // Folder picker popup
  let pickerFileId = $state<string | null>(null);
  let pickerQuery = $state('');
  let pickerPos = $state({ top: 0, left: 0, width: 260 });

  const nonDemoFolders = $derived(
    flatFolders.filter(f => !f.path.startsWith('Demo Files'))
  );
  const pickerOptions = $derived(
    [{ value: '', label: 'No folder' }, ...nonDemoFolders.map(f => ({ value: f.path, label: f.path }))]
      .filter(o => pickerQuery.trim() === '' || o.label.toLowerCase().includes(pickerQuery.toLowerCase()))
  );

  function openFolderPicker(fileId: string, el: HTMLElement) {
    pickerFileId = fileId;
    pickerQuery = '';
    const rect = el.getBoundingClientRect();
    const w = 260;
    const left = rect.left + w > window.innerWidth ? Math.max(0, rect.right - w) : rect.left;
    pickerPos = { top: rect.bottom + 4, left, width: w };
  }

  function closePicker() { pickerFileId = null; pickerQuery = ''; }

  $effect(() => {
    if (showNewFolderInput && newFolderInputEl) newFolderInputEl.focus();
  });
  $effect(() => {
    if (renamingFolder !== null && renameInputEl) {
      renameInputEl.focus();
      renameInputEl.select();
    }
  });

  function isSelectedProtected() {
    return selectedFolder !== null && (
      selectedFolder === 'Results' || selectedFolder.startsWith('Results/') ||
      selectedFolder === 'Demo Files' || selectedFolder.startsWith('Demo Files/')
    );
  }

  function startNewFolder() {
    if (isSelectedProtected()) return;
    newFolderPath = selectedFolder !== null ? selectedFolder + '/' : '';
    showNewFolderInput = true;
  }

  async function confirmNewFolder(e: KeyboardEvent | FocusEvent) {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== 'Escape') return;
    if (e instanceof KeyboardEvent && e.key === 'Escape') {
      showNewFolderInput = false; newFolderPath = ''; return;
    }
    const path = newFolderPath.trim().replace(/^\/+|\/+$/g, '');
    if (path) { await dataFiles.createFolder(path); selectedFolder = path; }
    showNewFolderInput = false; newFolderPath = '';
  }

  function startRename(folderPath: string) {
    renamingFolder = folderPath;
    renameValue = folderPath;
  }

  async function confirmRename(e: KeyboardEvent | FocusEvent) {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== 'Escape') return;
    if (e instanceof KeyboardEvent && e.key === 'Escape') {
      renamingFolder = null; renameValue = ''; return;
    }
    const oldPath = renamingFolder!;
    const newPath = renameValue.trim().replace(/^\/+|\/+$/g, '');
    if (newPath && newPath !== oldPath) {
      await dataFiles.renameFolder(oldPath, newPath);
      if (selectedFolder === oldPath) selectedFolder = newPath;
      else if (selectedFolder?.startsWith(oldPath + '/')) {
        selectedFolder = newPath + selectedFolder.slice(oldPath.length);
      }
    }
    renamingFolder = null; renameValue = '';
  }

  async function deleteFolder(folderPath: string) {
    const ok = await confirm({
      title: 'Delete folder',
      message: `Delete "${folderPath}"? Files inside will be moved to root.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await dataFiles.removeFolder(folderPath);
    if (selectedFolder === folderPath || selectedFolder?.startsWith(folderPath + '/')) {
      selectedFolder = null;
    }
  }

  // ── ext styling ────────────────────────────────────────────────
  const EXT_COLOR: Record<string, string> = {
    // FASTQ — raw reads
    'fastq':    'bg-emerald-100 text-emerald-700 border-emerald-200',
    'fastq.gz': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'fq':       'bg-emerald-100 text-emerald-700 border-emerald-200',
    // FASTA — reference / sequences
    'fasta':    'bg-orange-100 text-orange-700 border-orange-200',
    'fasta.gz': 'bg-orange-100 text-orange-700 border-orange-200',
    'fa':       'bg-orange-100 text-orange-700 border-orange-200',
    'fna':      'bg-orange-100 text-orange-700 border-orange-200',
    'faa':      'bg-orange-100 text-orange-700 border-orange-200',
    // Alignment
    'bam':      'bg-sky-100 text-sky-700 border-sky-200',
    'sam':      'bg-blue-100 text-blue-700 border-blue-200',
    'cram':     'bg-indigo-100 text-indigo-700 border-indigo-200',
    // Variants
    'vcf':      'bg-violet-100 text-violet-700 border-violet-200',
    'vcf.gz':   'bg-violet-100 text-violet-700 border-violet-200',
    'bcf':      'bg-purple-100 text-purple-700 border-purple-200',
    'bcf.gz':   'bg-purple-100 text-purple-700 border-purple-200',
    // Annotation / intervals
    'gtf':      'bg-teal-100 text-teal-700 border-teal-200',
    'gff':      'bg-teal-100 text-teal-700 border-teal-200',
    'gff3':     'bg-teal-100 text-teal-700 border-teal-200',
    'bed':      'bg-rose-100 text-rose-700 border-rose-200',
  };
  function extClass(ext: string) { return EXT_COLOR[ext] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'; }
  function fmtDate(ms: number) { return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }
  function truncatePath(path: string, maxLen = 48) {
    if (path.length <= maxLen) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(maxLen - 1));
  }

  // ── search ─────────────────────────────────────────────────────
  let query = $state('');
  const filteredFiles = $derived(
    query.trim() === ''
      ? visibleFiles
      : visibleFiles.filter(f =>
          f.name.toLowerCase().includes(query.toLowerCase()) ||
          f.path.toLowerCase().includes(query.toLowerCase())
        )
  );

  // ── file preview ───────────────────────────────────────────────
  const BINARY_EXTS = new Set(['bam', 'cram', 'bcf', 'bcf.gz', 'fastq.gz', 'fq.gz', 'fasta.gz', 'fa.gz', 'fna.gz', 'vcf.gz']);
  const PREVIEW_LINES: Record<string, number> = {
    fastq: 40, fq: 40,
    fasta: 50, fa: 50, fna: 50, faa: 50,
    vcf: 100, sam: 60,
    bed: 50, gtf: 50, gff: 50, gff3: 50,
  };

  let previewFileId = $state<string | null>(null);
  let previewContent = $state<string | null>(null);
  let previewLoading = $state(false);
  let previewError = $state<string | null>(null);

  const previewFile = $derived(previewFileId ? dataFiles.files.find(f => f.id === previewFileId) ?? null : null);

  function isBinary(ext: string) { return BINARY_EXTS.has(ext); }

  function openPreview(file: DataFile) {
    if (previewFileId === file.id) { previewFileId = null; return; }
    previewFileId = file.id;
  }

  $effect(() => {
    const file = previewFile;
    if (!file || file.missing || isBinary(file.ext)) { previewContent = null; previewError = null; return; }
    previewLoading = true;
    previewContent = null;
    previewError = null;
    const lines = PREVIEW_LINES[file.ext] ?? 50;
    const api = liatir();
    if (!api) { previewLoading = false; return; }
    api.invoke('lia_preview_file', { path: file.path, lines })
      .then((text: unknown) => { previewContent = text as string; previewError = null; })
      .catch((e: unknown) => { previewError = String(e); previewContent = null; })
      .finally(() => { previewLoading = false; });
  });

  // Syntax highlight for preview content
  function highlightLine(line: string, ext: string, lineIdx: number): { text: string; cls: string } {
    if (ext === 'fastq' || ext === 'fq') {
      const mod = lineIdx % 4;
      if (mod === 0) return { text: line, cls: 'text-brand' };
      if (mod === 1) return { text: line, cls: 'text-emerald-700' };
      if (mod === 2) return { text: line, cls: 'text-zinc-400' };
      return { text: line, cls: 'text-amber-600' };
    }
    if (ext === 'fasta' || ext === 'fa' || ext === 'fna' || ext === 'faa') {
      if (line.startsWith('>')) return { text: line, cls: 'text-brand font-medium' };
      return { text: line, cls: 'text-emerald-700' };
    }
    if (ext === 'vcf') {
      if (line.startsWith('##')) return { text: line, cls: 'text-zinc-400' };
      if (line.startsWith('#')) return { text: line, cls: 'text-zinc-600 font-medium' };
      return { text: line, cls: 'text-zinc-800' };
    }
    if (ext === 'sam') {
      if (line.startsWith('@')) return { text: line, cls: 'text-zinc-500' };
      return { text: line, cls: 'text-zinc-800' };
    }
    if (ext === 'gtf' || ext === 'gff' || ext === 'gff3') {
      if (line.startsWith('#')) return { text: line, cls: 'text-zinc-400' };
      return { text: line, cls: 'text-zinc-800' };
    }
    return { text: line, cls: 'text-zinc-800' };
  }

  // ── actions ────────────────────────────────────────────────────
  let importing = $state(false);
  let addingSample = $state(false);

  async function importFiles() {
    importing = true;
    try { await dataFiles.importFromPicker(selectedFolder ?? ''); } finally { importing = false; }
  }

  async function addSample() {
    addingSample = true;
    try { await dataFiles.addSampleFastq(selectedFolder ?? ''); } finally { addingSample = false; }
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Data" description="Files available to tools">
    {#snippet actions()}
      <Button variant="primary" size="sm" onclick={importFiles} loading={importing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Import file
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
          <span class="flex-1 text-left">All files</span>
          <span class="text-[10px] text-zinc-400">{dataFiles.files.length}</span>
        </button>

        {#if flatFolders.length > 0}
          <div class="my-1 mx-3 border-t border-border"></div>
        {/if}

        <!-- Folders -->
        {#each visibleFolders as f (f.path)}
          {#if renamingFolder === f.path}
            <div class="px-3 py-1.5">
              <input
                bind:this={renameInputEl}
                bind:value={renameValue}
                placeholder="folder/name"
                onkeydown={confirmRename}
                onblur={confirmRename}
                class="w-full text-xs border border-brand/60 rounded px-2 py-1
                       bg-surface text-zinc-800 placeholder:text-zinc-400 outline-none"
              />
            </div>
          {:else}
            {@const isProtected = f.path === 'Results' || f.path.startsWith('Results/') || f.path.startsWith('Demo Files')}
            <div class="group relative flex items-center transition-colors {selectedFolder === f.path ? 'bg-brand/8' : 'hover:bg-surface-2'}">
              <button
                onclick={() => {
                  selectedFolder = f.path;
                  if (f.hasChildren) toggleCollapse(f.path);
                }}
                style="padding-left: {f.depth * 10 + 12}px"
                class="flex-1 flex items-center gap-1.5 py-1.5 text-xs min-w-0
                  {selectedFolder === f.path ? 'text-brand font-medium' : 'text-zinc-500 group-hover:text-zinc-700'}"
              >
                {#if f.hasChildren}
                  <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                    class="shrink-0 transition-transform duration-150 {collapsedFolders.has(f.path) ? '' : 'rotate-90'}"
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                {:else}
                  <span class="w-2.5 shrink-0"></span>
                {/if}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span class="flex-1 text-left truncate">{f.name}</span>
              </button>
              <!-- Count (recursive, hidden on hover for non-protected) -->
              <span class="pr-3 text-[10px] text-zinc-400 {isProtected ? '' : 'group-hover:hidden'}">{countInFolder(f.path)}</span>
              {#if !isProtected}
                <div class="pr-1.5 hidden group-hover:flex items-center">
                  <button onclick={(e) => { e.stopPropagation(); startRename(f.path); }} title="Rename" class="p-1 text-zinc-400 hover:text-zinc-700 transition-colors rounded">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button onclick={(e) => { e.stopPropagation(); deleteFolder(f.path); }} title="Delete" class="p-1 text-zinc-400 hover:text-red-500 transition-colors rounded">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              {:else}
                <div class="pr-2.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
              {/if}
            </div>
          {/if}
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
      {#if !showNewFolderInput && !isSelectedProtected()}
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
    <div class="flex-1 overflow-y-auto p-6 {previewFileId ? 'border-r border-border' : ''}">

      {#if dataFiles.files.length === 0}
        <!-- Global empty state -->
        <div class="flex flex-col items-center justify-center h-full text-center gap-3">
          <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <p class="text-sm font-medium text-zinc-700">No files yet</p>
          <p class="text-xs text-zinc-400 max-w-xs">
            Import files to make them available to tools like FastQC.
            Files are referenced by path — they stay where they are on disk.
          </p>
          <div class="flex gap-2 mt-1">
            <Button variant="secondary" size="sm" onclick={importFiles} loading={importing}>Import file</Button>
          </div>
        </div>

      {:else if selectedFolder !== null && visibleFiles.length === 0 && selectedSubfolders.length === 0}
        <!-- Folder empty state -->
        <div class="flex flex-col items-center justify-center h-64 text-center gap-3">
          <div class="h-10 w-10 rounded-xl bg-zinc-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p class="text-sm text-zinc-500">No files in this folder</p>
          <Button variant="secondary" size="sm" onclick={importFiles} loading={importing}>Import file here</Button>
        </div>

      {:else}
        <!-- Subfolders grid (only when a folder is selected) -->
        {#if selectedFolder !== null && selectedSubfolders.length > 0}
          <div class="flex flex-wrap gap-2 mb-4">
            {#each selectedSubfolders as sub (sub.path)}
              <button
                onclick={() => selectedFolder = sub.path}
                class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-surface-2 hover:border-zinc-300 transition-colors text-xs text-zinc-600"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-zinc-400">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>{sub.name}</span>
                <span class="text-[10px] text-zinc-400 font-mono">{countInFolder(sub.path)}</span>
              </button>
            {/each}
          </div>
        {/if}

        <!-- Search bar -->
        {#if visibleFiles.length > 0 || query}
        <div class="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 mb-4">
          <svg class="shrink-0 text-zinc-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            bind:value={query}
            placeholder="Search files…"
            class="flex-1 text-sm bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
          />
          {#if query}
            <button onclick={() => query = ''} class="text-zinc-300 hover:text-zinc-500 transition-colors">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          {/if}
        </div>
        {/if}

        {#if filteredFiles.length === 0 && query}
          <p class="text-sm text-zinc-400 text-center py-8">No files match "{query}"</p>
        {:else if filteredFiles.length > 0}
        <Card>
          <div class="divide-y divide-border">
            {#each filteredFiles as file (file.id)}
              <div
                class="flex items-center gap-3 px-4 py-3 group cursor-pointer transition-colors
                  {file.missing ? 'bg-amber-50/60' : ''}
                  {previewFileId === file.id ? 'bg-brand/5 ring-inset ring-1 ring-brand/20' : 'hover:bg-zinc-50/80'}"
                onclick={() => !file.missing && openPreview(file)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && !file.missing && openPreview(file)}
              >
                {#if !file.missing && !file.protected}
                  <button
                    onclick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirm({ title: 'Remove file', message: `Remove "${file.name}" from the list?`, confirmLabel: 'Remove' });
                      if (ok) dataFiles.remove(file.id);
                    }}
                    aria-label="Remove"
                    class="h-8 w-8 rounded-lg bg-zinc-100 border-zinc-200 border flex items-center justify-center shrink-0 group-hover:bg-red-50 group-hover:border-red-200 transition-colors"
                  >
                    <svg class="group-hover:hidden" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                    <svg class="hidden group-hover:block text-red-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                {:else if file.missing}
                  <button
                    onclick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirm({ title: 'Remove file', message: `Remove "${file.name}" from the list?`, confirmLabel: 'Remove' });
                      if (ok) dataFiles.remove(file.id);
                    }}
                    aria-label="Remove"
                    class="h-8 w-8 rounded-lg bg-amber-100 border-amber-200 border flex items-center justify-center shrink-0 group-hover:bg-red-50 group-hover:border-red-200 transition-colors"
                  >
                    <svg class="group-hover:hidden" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <svg class="hidden group-hover:block text-red-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                {:else}
                  <div class="h-8 w-8 rounded-lg bg-zinc-100 border-zinc-200 border flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  </div>
                {/if}

                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium {file.missing ? 'text-amber-700' : 'text-zinc-800'} truncate">{file.name}</p>
                </div>

                {#if file.missing}
                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border bg-amber-100 text-amber-700 border-amber-200">
                    missing
                  </span>
                  <button
                    onclick={() => dataFiles.relocate(file.id)}
                    class="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-200 transition-colors"
                  >
                    Locate
                  </button>
                {:else}
                  {#if file.size != null}
                    <span class="shrink-0 text-[11px] text-zinc-400 font-mono">{fmtBytes(file.size)}</span>
                  {/if}

                  <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border {extClass(file.ext)}">
                    {file.ext || '?'}
                  </span>

                  <div class="shrink-0 w-24" onclick={(e) => e.stopPropagation()}>
                    {#if file.protected}
                      <span class="flex items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border border-violet-200 bg-violet-50 text-violet-600 w-full">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        Demo
                      </span>
                    {:else}
                      <button
                        onclick={(e) => openFolderPicker(file.id, e.currentTarget)}
                        class="flex items-center gap-1 text-[10px] border border-border rounded px-1.5 py-1 bg-surface
                               text-zinc-500 hover:border-zinc-400 transition-colors w-full min-w-0"
                      >
                        <span class="truncate flex-1 text-left">{file.folder || 'No folder'}</span>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    {/if}
                  </div>
                {/if}

              </div>
            {/each}
          </div>
        </Card>
        {/if}
      {/if}

    </div>

    <!-- Folder picker popup -->
    {#if pickerFileId}
      {@const currentFile = dataFiles.files.find(f => f.id === pickerFileId)}
      <div class="fixed inset-0 z-9998" onclick={closePicker}></div>
      <div
        class="fixed z-9999 bg-surface border border-border rounded-xl shadow-xl p-3 flex flex-col gap-2"
        style="top:{pickerPos.top}px; left:{pickerPos.left}px; width:{pickerPos.width}px;"
      >
        <div class="flex items-center gap-2 border border-border rounded-lg px-2 py-1.5">
          <svg class="shrink-0 text-zinc-400" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            bind:value={pickerQuery}
            placeholder="Search folders…"
            class="flex-1 text-xs bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
            onclick={(e) => e.stopPropagation()}
          />
        </div>
        <div class="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {#each pickerOptions as opt (opt.value)}
            <button
              onclick={(e) => { e.stopPropagation(); dataFiles.move(pickerFileId!, opt.value); closePicker(); }}
              class="text-[11px] rounded-md px-2 py-1 border transition-colors
                {currentFile?.folder === opt.value
                  ? 'bg-brand/10 border-brand/30 text-brand font-medium'
                  : 'bg-zinc-50 border-border text-zinc-600 hover:bg-zinc-100 hover:border-zinc-300'}"
            >
              {opt.label}
            </button>
          {/each}
          {#if pickerOptions.length === 0}
            <p class="text-xs text-zinc-400 py-1">No folders found</p>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Preview panel -->
    {#if previewFileId && previewFile}
      <div class="w-80 shrink-0 flex flex-col overflow-hidden bg-surface">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <div class="flex items-center gap-2 min-w-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f39f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <span class="text-xs font-medium text-zinc-700 truncate">{previewFile.name}</span>
          </div>
          <button
            onclick={() => previewFileId = null}
            aria-label="Close preview"
            class="shrink-0 text-zinc-400 hover:text-zinc-600 transition-colors p-0.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Meta info -->
        <div class="px-3 py-2 border-b border-border space-y-1">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-zinc-400 uppercase tracking-wider">Size</span>
            <span class="text-xs text-zinc-600 font-mono">{previewFile.size != null ? fmtBytes(previewFile.size) : '—'}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-zinc-400 uppercase tracking-wider">Format</span>
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded border {extClass(previewFile.ext)}">{previewFile.ext || '?'}</span>
          </div>
          <p class="text-[10px] text-zinc-400 break-all pt-0.5">{previewFile.path}</p>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-3">
          {#if isBinary(previewFile.ext)}
            <div class="flex flex-col items-center justify-center h-32 gap-2 text-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" />
              </svg>
              <p class="text-xs text-zinc-400">Binary format</p>
              <p class="text-[10px] text-zinc-300">Use a tool to inspect this file</p>
            </div>

          {:else if previewLoading}
            <div class="flex justify-center py-8">
              <svg class="animate-spin h-4 w-4 text-zinc-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            </div>

          {:else if previewError}
            <p class="text-xs text-red-400 font-mono break-all">{previewError}</p>

          {:else if previewContent}
            <pre class="text-[10px] font-mono leading-relaxed">{#each previewContent.split('\n') as line, i}{@const hl = highlightLine(line, previewFile.ext, i)}<span class={hl.cls}>{hl.text}</span>{'\n'}{/each}</pre>
            <p class="text-[10px] text-zinc-300 mt-2 text-right">preview — first {PREVIEW_LINES[previewFile.ext] ?? 50} lines</p>

          {:else}
            <p class="text-xs text-zinc-400 text-center py-8">No content</p>
          {/if}
        </div>
      </div>
    {/if}

  </div>
</div>
