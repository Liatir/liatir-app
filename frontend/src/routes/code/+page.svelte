<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CodeEditor from '$lib/components/ui/CodeEditor.svelte';
  import { codeIfEmpty } from '$lib/stores/codeEditor.svelte';
  import { savedScripts } from '$lib/stores/savedScripts.svelte';

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

  // Track which script id was last loaded to avoid reloading on update()
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

  // ── execution ──────────────────────────────────────────────────
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  async function run() {
    running = true;
    output = null;
    outputError = null;
    outputType = null;
    try {
      const fn = new AsyncFunction('Offlab', code);
      const result = await fn(window.Offlab);
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
    // $effect will pick up the change
  }

  function newScript() {
    savedScripts.setActive(null);
  }

  function deleteScript(id: string) {
    savedScripts.remove(id);
  }

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatOutput(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  const allFolderPaths = $derived(savedScripts.allFolderPaths());
</script>

<div class="flex h-full overflow-hidden">

  <!-- Scripts sidebar -->
  <div class="w-56 shrink-0 border-r border-border bg-surface flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <span class="text-xs font-medium text-zinc-600">Scripts</span>
      <button
        onclick={newScript}
        class="text-zinc-500 hover:text-zinc-800 transition-colors p-0.5 rounded"
        title="New script"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if savedScripts.scripts.length === 0}
        <p class="text-xs text-zinc-400 text-center py-6 px-3">No saved scripts yet.<br/>Run and save to keep them.</p>
      {:else}
        {#each savedScripts.scripts as s (s.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => loadScript(s.id)}
            onkeydown={(e) => e.key === 'Enter' && loadScript(s.id)}
            class="w-full text-left px-3 py-2 group transition-colors cursor-pointer
              {savedScripts.activeScriptId === s.id
                ? 'bg-brand/15 text-brand-soft'
                : 'text-zinc-600 hover:bg-surface-2 hover:text-zinc-800'}"
          >
            <p class="text-xs font-medium truncate">{s.name}</p>
            <div class="flex items-center justify-between mt-0.5">
              <p class="text-[10px] text-zinc-400">{fmtDate(s.savedAt)}</p>
              <button
                onclick={(e) => { e.stopPropagation(); deleteScript(s.id); }}
                aria-label="Delete script"
                class="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Editor + output -->
  <div class="flex-1 flex flex-col overflow-hidden">
    <PageHeader title="Code" description="Write JavaScript and use the Offlab API directly">
      {#snippet actions()}
        {#if showSavePanel}
          <input
            data-selectable
            bind:value={saveNameInput}
            placeholder="Script name…"
            onkeydown={(e) => e.key === 'Enter' && saveScript()}
            class="rounded-lg border border-border bg-surface-2 px-3 py-1.5
                   text-sm text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-brand
                   transition-colors w-36"
          />
          {#if allFolderPaths.length > 0}
            <select
              bind:value={saveFolderInput}
              class="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-zinc-700 outline-none"
            >
              <option value="">Root</option>
              {#each allFolderPaths as p}
                <option value={p}>{p}</option>
              {/each}
            </select>
          {/if}
          <Button variant="primary" size="sm" onclick={saveScript}>Save</Button>
          <Button variant="ghost" size="sm" onclick={() => (showSavePanel = false)}>Cancel</Button>
        {:else}
          <Button variant="ghost" size="sm" onclick={openSavePanel}>Save</Button>
          <Button variant="primary" size="sm" disabled={running} loading={running} onclick={run}>
            Run  <span class="text-[10px] ml-1">⌘↵</span>
          </Button>
        {/if}
      {/snippet}
    </PageHeader>

    <div class="flex-1 flex flex-col overflow-hidden p-4 gap-3">

      <!-- Code editor -->
      <div class="flex-1 min-h-0">
        <CodeEditor
          value={code}
          onchange={(v) => { code = v; }}
          onrun={run}
        />
      </div>

      <!-- Output -->
      {#if outputType !== null}
        <div class="shrink-0 max-h-64 rounded-xl border overflow-hidden
          {outputType === 'error'
            ? 'border-red-200 bg-red-50'
            : 'border-border bg-surface'}">
          <div class="flex items-center justify-between px-4 py-2 border-b border-inherit">
            <span class="text-xs font-medium {outputType === 'error' ? 'text-red-600' : 'text-zinc-600'}">
              {outputType === 'error' ? 'Error' : 'Output'}
            </span>
            <button
              aria-label="Clear output"
              onclick={() => { output = null; outputError = null; outputType = null; }}
              class="text-zinc-400 hover:text-zinc-600 transition-colors"
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
            >{outputType === 'error' ? outputError : formatOutput(output)}</pre>
          </div>
        </div>
      {/if}

    </div>
  </div>

</div>
