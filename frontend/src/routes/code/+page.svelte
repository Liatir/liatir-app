<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  interface SavedScript {
    id: string;
    name: string;
    code: string;
    savedAt: number;
  }

  const STORAGE_KEY = 'offlab_scripts';

  let code = $state(`// Offlab API is available as 'Offlab'
// Use 'return' to output a value, or just let statements run.
// ⌘↵ to execute

const jobs = await Offlab.jobs.list();
return jobs;`);

  let running = $state(false);
  let output = $state<unknown>(null);
  let outputError = $state<string | null>(null);
  let outputType = $state<'result' | 'error' | null>(null);

  let scripts = $state<SavedScript[]>([]);
  let saveNameInput = $state('');
  let showSavePanel = $state(false);
  let activeScriptId = $state<string | null>(null);

  // AsyncFunction constructor for eval-like execution with async/await support
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target as HTMLTextAreaElement;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      code = code.slice(0, start) + '  ' + code.slice(end);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      run();
    }
  }

  function loadScripts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      scripts = raw ? JSON.parse(raw) : [];
    } catch {
      scripts = [];
    }
  }

  function saveScripts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  }

  function saveScript() {
    const name = saveNameInput.trim() || `Script ${scripts.length + 1}`;
    if (activeScriptId) {
      scripts = scripts.map((s) =>
        s.id === activeScriptId ? { ...s, name, code, savedAt: Date.now() } : s
      );
    } else {
      const id = `script_${Date.now()}`;
      scripts = [{ id, name, code, savedAt: Date.now() }, ...scripts];
      activeScriptId = id;
    }
    saveScripts();
    showSavePanel = false;
    saveNameInput = '';
  }

  function loadScript(s: SavedScript) {
    code = s.code;
    activeScriptId = s.id;
    saveNameInput = s.name;
    output = null;
    outputError = null;
    outputType = null;
  }

  function deleteScript(id: string) {
    scripts = scripts.filter((s) => s.id !== id);
    saveScripts();
    if (activeScriptId === id) {
      activeScriptId = null;
      saveNameInput = '';
    }
  }

  function newScript() {
    code = '// Write your script here\n// Offlab API is available as \'Offlab\'\n\n';
    activeScriptId = null;
    saveNameInput = '';
    output = null;
    outputError = null;
    outputType = null;
  }

  function formatOutput(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  onMount(loadScripts);
</script>

<div class="flex h-full overflow-hidden">

  <!-- Scripts sidebar -->
  <div class="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
    <div class="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
      <span class="text-xs font-medium text-zinc-400">Scripts</span>
      <button
        onclick={newScript}
        class="text-zinc-500 hover:text-zinc-200 transition-colors p-0.5 rounded"
        title="New script"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      {#if scripts.length === 0}
        <p class="text-xs text-zinc-600 text-center py-6 px-3">No saved scripts yet.<br/>Run and save to keep them.</p>
      {:else}
        {#each scripts as s (s.id)}
          <!-- outer div avoids nested <button> — delete uses its own click area -->
          <div
            role="button"
            tabindex="0"
            onclick={() => loadScript(s)}
            onkeydown={(e) => e.key === 'Enter' && loadScript(s)}
            class="w-full text-left px-3 py-2 group transition-colors cursor-pointer
              {activeScriptId === s.id
                ? 'bg-brand/15 text-brand-soft'
                : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'}"
          >
            <p class="text-xs font-medium truncate">{s.name}</p>
            <div class="flex items-center justify-between mt-0.5">
              <p class="text-[10px] text-zinc-600">{fmtDate(s.savedAt)}</p>
              <button
                onclick={(e) => { e.stopPropagation(); deleteScript(s.id); }}
                aria-label="Delete script"
                class="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
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
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5
                   text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-brand
                   transition-colors w-40"
          />
          <Button variant="primary" size="sm" onclick={saveScript}>Save</Button>
          <Button variant="ghost" size="sm" onclick={() => (showSavePanel = false)}>Cancel</Button>
        {:else}
          <Button variant="ghost" size="sm" onclick={() => { showSavePanel = true; }}>
            Save
          </Button>
          <Button variant="primary" size="sm" disabled={running} loading={running} onclick={run}>
            Run  <span class="text-brand-soft text-[10px] ml-1">⌘↵</span>
          </Button>
        {/if}
      {/snippet}
    </PageHeader>

    <div class="flex-1 flex flex-col overflow-hidden p-4 gap-3">

      <!-- Code editor -->
      <div class="flex-1 min-h-0">
        <textarea
          data-selectable
          bind:value={code}
          onkeydown={handleKeydown}
          spellcheck="false"
          class="w-full h-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]
                 px-5 py-4 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 outline-none
                 resize-none focus:border-brand transition-colors leading-relaxed"
        ></textarea>
      </div>

      <!-- Output -->
      {#if outputType !== null}
        <div class="shrink-0 max-h-64 rounded-xl border overflow-hidden
          {outputType === 'error'
            ? 'border-red-700/40 bg-red-950/30'
            : 'border-[var(--color-border)] bg-[var(--color-surface)]'}">
          <div class="flex items-center justify-between px-4 py-2 border-b border-inherit">
            <span class="text-xs font-medium {outputType === 'error' ? 'text-red-400' : 'text-zinc-400'}">
              {outputType === 'error' ? 'Error' : 'Output'}
            </span>
            <button
              aria-label="Clear output"
              onclick={() => { output = null; outputError = null; outputType = null; }}
              class="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="overflow-y-auto max-h-48 px-4 py-3">
            <pre class="text-sm font-mono whitespace-pre-wrap break-all leading-relaxed
              {outputType === 'error' ? 'text-red-300' : 'text-emerald-300'}"
              data-selectable
            >{outputType === 'error' ? outputError : formatOutput(output)}</pre>
          </div>
        </div>
      {/if}

    </div>
  </div>

</div>
