<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import CodeEditor from '$lib/components/ui/CodeEditor.svelte';
  import { codeIfEmpty } from '$lib/stores/codeEditor.svelte';
  import { savedScripts, type SavedScript } from '$lib/stores/savedScripts.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
	import { goto } from '$app/navigation';

  // ── editor state ───────────────────────────────────────────────
  let code = $state(codeIfEmpty);
  let running = $state(false);
  let output = $state<unknown>(null);
  let outputError = $state<string | null>(null);
  let outputType = $state<'result' | 'error' | null>(null);

  // ── save dialog state ──────────────────────────────────────────
  let showSavePanel = $state(false);
  let saveNameInput = $state('');
  let saveFolderInput = $state('');

  let lastLoadedId: string | null = null;

  $effect(() => {
    const id = savedScripts.activeScriptId;
    const script = savedScripts.activeScript;
    if (id !== lastLoadedId) {
      lastLoadedId = id;
      if (script) {
        code = script.code;
        saveNameInput = script.name;
        saveFolderInput = script.folder;
      } else {
        code = codeIfEmpty;
        saveNameInput = '';
        saveFolderInput = '';
      }
      output = null;
      outputError = null;
      outputType = null;
    }
  });

  onMount(() => savedScripts.init());

  // ── script grouping ────────────────────────────────────────────
  type ScriptGroup = { folder: string; scripts: SavedScript[] };

  const scriptGroups = $derived.by(() => {
    const root: SavedScript[] = [];
    const folderMap = new Map<string, SavedScript[]>();
    for (const s of savedScripts.scripts) {
      if (!s.folder) {
        root.push(s);
      } else {
        if (!folderMap.has(s.folder)) folderMap.set(s.folder, []);
        folderMap.get(s.folder)!.push(s);
      }
    }
    const folders: ScriptGroup[] = [...folderMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([folder, scripts]) => ({ folder, scripts }));
    return { root, folders };
  });

  const folderOptions = $derived([
    { value: '', label: 'No folder' },
    ...savedScripts.allFolderPaths().map(p => ({ value: p, label: p })),
  ]);

  // ── execution ──────────────────────────────────────────────────
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  async function run() {
    running = true;
    output = null;
    outputError = null;
    outputType = null;
    try {
      const fn = new AsyncFunction('Liatir', code);
      const result = await fn(window.Liatir);
      output = result;
      outputType = 'result';
    } catch (e) {
      outputError = String(e);
      outputType = 'error';
    } finally {
      running = false;
    }
  }

  // ── save ───────────────────────────────────────────────────────
  async function saveScript() {
    const name = saveNameInput.trim() || `Script ${savedScripts.scripts.length + 1}`;
    const id = savedScripts.activeScriptId;
    if (id) {
      await savedScripts.update(id, name, code);
    } else {
      await savedScripts.create(name, code, saveFolderInput);
    }
    showSavePanel = false;
    saveNameInput = savedScripts.activeScript?.name ?? '';
  }

  function openSavePanel() {
    saveNameInput = savedScripts.activeScript?.name ?? '';
    saveFolderInput = savedScripts.activeScript?.folder ?? '';
    showSavePanel = true;
  }

  // ── script list actions ────────────────────────────────────────
  function loadScript(id: string) {
    savedScripts.setActive(id);
  }

  function newScript() {
    savedScripts.setActive(null);
  }

  async function deleteScript(id: string, name: string) {
    const ok = await confirm({ title: 'Delete script', message: `Delete "${name}"?`, confirmLabel: 'Delete' });
    if (ok) savedScripts.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatOutput(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
</script>

<div class="flex h-full overflow-hidden">

  <!-- Scripts sidebar -->
  <span class="hidden">
    <div class="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
      <div class="flex items-center justify-between px-3 py-3 border-b border-border">
        <span class="text-xs font-medium text-text-secondary">Scripts</span>
        <!-- <button
          onclick={newScript}
          class="text-text-muted hover:text-text transition-colors p-0.5 rounded"
          title="New script"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button> -->
      </div>

      <div class="flex-1 overflow-y-auto py-1">
        {#if savedScripts.scripts.length === 0}
          <p class="text-xs text-text-subtle text-center py-6 px-3">No saved scripts yet.<br/>Run and save to keep them.</p>
        {:else}
          <!-- Root scripts -->
          {#each scriptGroups.root as s (s.id)}
            {@const active = savedScripts.activeScriptId === s.id}
            <div
              role="button"
              tabindex="0"
              onclick={() => loadScript(s.id)}
              onkeydown={(e) => e.key === 'Enter' && loadScript(s.id)}
              class="w-full text-left px-3 py-2 group transition-colors cursor-pointer
                {active ? 'bg-brand/15 text-brand-soft' : 'text-text-secondary hover:bg-surface-2 hover:text-text'}"
            >
              <div class="flex items-center justify-between mt-0.5">
                <p class="text-xs font-medium truncate">{s.name}</p>
                <button
                  onclick={(e) => { e.stopPropagation(); deleteScript(s.id, s.name); }}
                  aria-label="Delete script"
                  class="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-red-500 transition-all"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
                <p class="text-[10px] text-text-subtle">
                  {fmtDate(s.savedAt)}
                </p>
            </div>
          {/each}

          <!-- Folder groups -->
          {#each scriptGroups.folders as group}
            <!-- Folder header -->
            <div class="flex items-center gap-1.5 px-3 pt-2.5 pb-1 {scriptGroups.root.length > 0 || scriptGroups.folders.indexOf(group) > 0 ? 'mt-0.5' : ''}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-subtle">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span class="text-[10px] font-semibold text-text-subtle truncate uppercase tracking-wide">{group.folder}</span>
            </div>
            <!-- Scripts in this folder -->
            {#each group.scripts as s (s.id)}
              {@const active = savedScripts.activeScriptId === s.id}
              <div
                role="button"
                tabindex="0"
                onclick={() => loadScript(s.id)}
                onkeydown={(e) => e.key === 'Enter' && loadScript(s.id)}
                class="w-full text-left pl-6 pr-3 py-2 group transition-colors cursor-pointer
                  {active ? 'bg-brand/15 text-brand-soft' : 'text-text-secondary hover:bg-surface-2 hover:text-text'}"
              >
                <div class="flex items-center justify-between mt-0.5">
                <p class="text-xs font-medium truncate">{s.name}</p>
                  <button
                    onclick={(e) => { e.stopPropagation(); deleteScript(s.id, s.name); }}
                    aria-label="Delete script"
                    class="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-red-500 transition-all"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                  <p class="text-[10px] text-text-subtle">{fmtDate(s.savedAt)}</p>
              </div>
            {/each}
          {/each}
        {/if}
      </div>
    </div>
  </span>

  <!-- Editor + output -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="Code Editor" description="Write JS/TS and test the Liatir API directly">
      {#snippet actions()}
        {#if showSavePanel}
          <input
            data-selectable
            bind:value={saveNameInput}
            placeholder="Script name…"
            onkeydown={(e) => e.key === 'Enter' && saveScript()}
            class="rounded-lg border border-border bg-surface-2 px-3 py-1.5
                   text-sm text-text placeholder:text-text-subtle outline-none focus:border-brand
                   transition-colors w-36"
          />
          {#if folderOptions.length > 1}
            <Select
              value={saveFolderInput}
              options={folderOptions}
              onchange={(v) => (saveFolderInput = v)}
              class="self-center"
            />
          {/if}
          <Button variant="primary" size="sm" onclick={saveScript}>Save</Button>
          <Button variant="ghost" size="sm" onclick={() => (showSavePanel = false)}>Cancel</Button>
        {:else}
          <Button variant="ghost" size="sm" onclick={openSavePanel}>Save</Button>
          <Button variant="primary" size="sm" disabled={running} loading={running} onclick={run}>
            Run  <span class="text-[10px] ml-1">⌘↵</span>
          </Button>
          <div class="w-px bg-border self-stretch"></div>
          <Button variant="secondary" size="sm" onclick={()=>goto("/scripts")}>Saved Scrpits</Button>
        {/if}
      {/snippet}
    </PageHeader>

    <div class="flex-1 flex flex-col overflow-hidden gap-3">

      <!-- Code editor -->
      <div class="flex-1 min-h-0">
        <CodeEditor
          value={code}
          onchange={(v) => { code = v; }}
          onrun={run}
          class="border-none rounded-none"
        />
      </div>

      <!-- Output -->
      {#if outputType !== null}
        <div class="shrink-0 max-h-64 rounded-xl border overflow-hidden
          {outputType === 'error'
            ? 'border-red-200 bg-red-50'
            : 'border-border bg-surface'}">
          <div class="flex items-center justify-between px-4 py-2 border-b border-inherit">
            <span class="text-xs font-medium {outputType === 'error' ? 'text-red-600' : 'text-text-secondary'}">
              {outputType === 'error' ? 'Error' : 'Output'}
            </span>
            <button
              aria-label="Clear output"
              onclick={() => { output = null; outputError = null; outputType = null; }}
              class="text-text-subtle hover:text-text-secondary transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="overflow-y-auto max-h-48 px-4 py-3">
            <pre class="text-sm font-mono whitespace-pre-wrap break-all leading-relaxed
              {outputType === 'error' ? 'text-red-700' : 'text-emerald-700'}"
              data-selectable
            >{sanitizeLocalPathsForDisplay(outputType === 'error' ? (outputError ?? '') : formatOutput(output), 2)}</pre>
          </div>
        </div>
      {/if}

    </div>
  </div>

</div>
