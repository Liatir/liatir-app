<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { liaPluginsStore, type LiatirPlugin, type FieldDef } from '$lib/stores/lia-plugins.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { liatir } from '$lib/api';
  import { savePluginResultFiles, type PluginSaveResult } from '$lib/utils/plugin-files';
  import { runLiatirPlugin } from '$lib/utils/plugin-run';
  import { matchesAcceptedExtension } from '$lib/utils/file-extensions';
  import { toast } from '$lib/stores/toast.svelte';
  import { getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  const id = $derived((page.params as { id: string }).id);
  let mod = $state<LiatirPlugin | null>(null);

  // Form values — keyed by field name
  let values = $state<Record<string, string | number | boolean>>({});

  // Run state
  let running = $state(false);
  let jobId = $state<string | null>(null);
  let stdoutLines = $state<string[]>([]);
  let stderrLines = $state<string[]>([]);
  let exitCode = $state<number | null | undefined>(undefined);
  let result = $state<unknown>(null);
  let savedFiles = $state<PluginSaveResult[]>([]);

  // Node.js availability
  let nodeAvailable = $state<boolean | null>(null);

  function resetRunOutput() {
    running = false;
    jobId = null;
    stdoutLines = [];
    stderrLines = [];
    exitCode = undefined;
    result = null;
    savedFiles = [];
  }

  onMount(async () => {
    resetRunOutput();
    values = {};
    await liaPluginsStore.init();
    mod = liaPluginsStore.byId(id);
    if (!mod) { goto('/plugins'); return; }

    // Pre-fill defaults
    for (const [key, field] of Object.entries(mod.inputSchema)) {
      if (field.default !== undefined) values[key] = field.default;
    }

    dataFiles.init();

    const api = liatir();
    // Node availability only matters for Node-runtime plugins.
    if (api && mod.runtime === 'node') {
      const check = await api.deps.check('node');
      nodeAvailable = check.available;
    }
  });

  function inputFields(schema: Record<string, FieldDef>) {
    return Object.entries(schema);
  }

  function filesForField(field: FieldDef) {
    if (!field.accept?.length) return dataFiles.files;
    return dataFiles.files.filter(f => matchesAcceptedExtension(f.path, field.accept ?? []));
  }

  function fieldHasValue(key: string, field: FieldDef): boolean {
    if (!field.required) return true;
    const value = values[key];
    if (field.type === 'boolean') return value !== undefined;
    if (field.type === 'number') {
      return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
    }
    return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
  }

  const canRun = $derived(
    !running &&
    nodeAvailable !== false &&
    !!mod &&
    Object.entries(mod.inputSchema).every(([key, field]) => fieldHasValue(key, field))
  );

  async function run() {
    if (!mod) return;
    running = true;
    jobId = null;
    stdoutLines = [];
    stderrLines = [];
    exitCode = undefined;
    result = null;
    savedFiles = [];
    const runId = crypto.randomUUID();

    const api = liatir();
    if (!api) { running = false; return; }

    try {
      // Execute via the shared runner (Node job streaming OR WASM direct result).
      const out = await runLiatirPlugin(mod, values, (stream, line) => {
        if (stream === 'stdout') stdoutLines = [...stdoutLines, line];
        else stderrLines = [...stderrLines, line];
      });
      result = out.result;
      exitCode = out.exitCode;

      // Persist any file-typed outputs into Results (same as native tools).
      if (exitCode === 0 && mod && Object.keys(mod.outputSchema).length > 0) {
        try {
          savedFiles = await savePluginResultFiles(mod.name, mod.outputSchema, result, runId);
          if (savedFiles.length > 0) {
            toast.success(`Saved ${savedFiles.length} file${savedFiles.length > 1 ? 's' : ''} to Results`);
          }
        } catch (e) {
          toast.error(`Failed to save plugin outputs: ${e}`);
        }
      }
    } catch (e) {
      stderrLines = [String(e)];
      exitCode = 1;
    } finally {
      running = false;
    }
  }

  const hasRun = $derived(exitCode !== undefined);
  const succeeded = $derived(exitCode === 0);

  function runtimeLabel(runtime: LiatirPlugin['runtime']) {
    if (runtime === 'wasm') return 'WASM .lia';
    if (runtime === 'python') return 'Python .lia';
    return 'Node .lia';
  }
</script>

{#if mod}
  <div class="flex flex-col h-full">
    <PageHeader title={mod.name} description={mod.description || `Manage and run your plugin`}>
      {#snippet actions()}
        <span class="text-xs font-mono text-zinc-400">v{mod!.version} | </span>
        <Button variant="secondary" size="sm" onclick={() => goto('/plugins')}>Plugins Page</Button>
      {/snippet}
    </PageHeader>
<PageContent>
    <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
      <Card>
        <div class="px-4 py-3 flex flex-wrap items-center gap-2 capitalize">
          <Badge hideDot size="xs" variant="brand">{runtimeLabel(mod.runtime).replace('.lia', '')}</Badge>
          <Badge hideDot size="xs" variant="neutral">{mod.category}</Badge>
          {#each mod.tags ?? [] as tag}
            <span class="rounded px-1.5 py-0.5 text-[10px] font-medium border bg-white text-zinc-500 border-zinc-200">
              {tag}
            </span>
          {/each}
          <span class="ml-auto text-xs text-zinc-400">{Object.keys(mod.inputSchema).length} input{Object.keys(mod.inputSchema).length !== 1 ? 's' : ''}</span>
          <span class="text-xs text-zinc-400">{Object.keys(mod.outputSchema).length} output{Object.keys(mod.outputSchema).length !== 1 ? 's' : ''}</span>
        </div>
      </Card>

      {#if nodeAvailable === false}
        <Card>
          <div class="px-4 py-4 flex items-start gap-3">
            <svg class="shrink-0 mt-0.5 text-amber-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p class="text-sm font-medium text-zinc-700">Node.js not found</p>
              <p class="text-xs text-zinc-400 mt-0.5">.lia plugins require Node.js ≥18. Install it from <span class="font-mono">nodejs.org</span> or via your package manager.</p>
            </div>
          </div>
        </Card>
      {/if}

      <!-- Input form -->
      <Card>
        <div class="px-4 py-3 border-b border-border">
          <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Inputs</p>
        </div>
        <div class="px-4 py-4 space-y-4">
          {#if Object.keys(mod.inputSchema).length === 0}
            <p class="text-sm text-zinc-400">This plugin takes no inputs.</p>
          {:else}
            {#each inputFields(mod.inputSchema) as [key, field]}
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-medium text-zinc-600" for="field-{key}">
                  {field.label ?? key}
                  {#if field.required}<span class="text-red-400 ml-0.5">*</span>{/if}
                </label>

                {#if field.type === 'file'}
                  <Select
                    id="field-{key}"
                    value={String(values[key] ?? '')}
                    options={[
                      { value: '', label: 'Select a file...' },
                      ...filesForField(field).map((file) => ({
                        value: file.path,
                        label: file.name,
                        description: getLastSegmentsStringFromPath(file.path, 2)
                      }))
                    ]}
                    disabled={running}
                    searchable
                    onchange={(value) => (values[key] = value)}
                  />
                {:else if field.type === 'boolean'}
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      id="field-{key}"
                      type="checkbox"
                      bind:checked={values[key] as boolean}
                      disabled={running}
                      class="rounded border-border text-brand"
                    />
                    <span class="text-sm text-zinc-600">{field.description ?? ''}</span>
                  </label>
                {:else if field.type === 'number'}
                  <input
                    id="field-{key}"
                    type="number"
                    bind:value={values[key]}
                    placeholder={String(field.default ?? '')}
                    disabled={running}
                    class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand/60 transition-colors"
                  />
                {:else}
                  <input
                    id="field-{key}"
                    type="text"
                    bind:value={values[key]}
                    placeholder={String(field.default ?? '')}
                    disabled={running}
                    class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800 outline-none focus:border-brand/60 transition-colors"
                  />
                {/if}

                {#if field.description && field.type !== 'boolean'}
                  <p class="text-[11px] text-zinc-400">{field.description}</p>
                {/if}
              </div>
            {/each}
          {/if}

          <div class="pt-2">
            <Button
              variant="primary"
              size="sm"
              loading={running}
              disabled={!canRun}
              onclick={run}
            >
              {running ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>
      </Card>

      <!-- Output -->
      {#if running || hasRun}
        <Card>
          <div class="px-4 py-3 border-b border-border flex items-center gap-2">
            <p class="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex-1">Output</p>
            {#if hasRun}
              <span class="rounded-full px-2 py-0.5 text-[10px] font-medium {succeeded ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}">
                {succeeded ? 'Done' : `Exit ${exitCode}`}
              </span>
            {:else}
              <span class="text-[10px] text-zinc-400 animate-pulse">running…</span>
            {/if}
          </div>

          <!-- Structured result -->
          {#if result !== null}
            <div class="px-4 py-3 border-b border-border bg-emerald-50/50">
              <p class="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-1.5">Result</p>
              <pre class="text-xs text-emerald-800 whitespace-pre-wrap font-mono">{JSON.stringify(result, null, 2)}</pre>
            </div>
          {/if}

          <!-- Saved output files (→ Results) -->
          {#if savedFiles.length > 0}
            <div class="px-4 py-3 border-b border-border">
              <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Saved to Results</p>
              <div class="flex flex-wrap gap-1.5">
                {#each savedFiles as f}
                  <span class="inline-flex items-center gap-1 rounded-full bg-brand/8 border border-brand/20 px-2 py-0.5 text-[11px] text-brand font-mono">
                    {f.virtualFolder}/{f.path.split(/[\\/]/).pop()}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          <!-- stdout -->
          {#if stdoutLines.length > 0}
            <div class="px-4 py-3 {stderrLines.length > 0 ? 'border-b border-border' : ''}">
              <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">stdout</p>
              <pre class="text-xs text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">{sanitizeLocalPathsForDisplay(stdoutLines.join('\n'), 2)}</pre>
            </div>
          {/if}

          <!-- stderr -->
          {#if stderrLines.length > 0}
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1.5">stderr</p>
              <pre class="text-xs text-red-600 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">{sanitizeLocalPathsForDisplay(stderrLines.join('\n'), 2)}</pre>
            </div>
          {/if}

          {#if running && stdoutLines.length === 0 && stderrLines.length === 0}
            <div class="px-4 py-6 text-center text-xs text-zinc-400">Waiting for output…</div>
          {/if}
        </Card>
      {/if}

    </div>
    </PageContent>
  </div>
{/if}
