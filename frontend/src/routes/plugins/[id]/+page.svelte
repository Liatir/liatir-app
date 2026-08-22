<script lang="ts">
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
  import { fmtBytes, getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
	import PageContent from '$lib/components/layout/PageContent.svelte';
  import { createLiatirRootExecutionIdentity, liatirExecutionMetadata, type JsonValue } from '@liatir/core';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { finalizeExecutionResult } from '$lib/execution/finalization';
  import type { ToolOutput } from '$lib/types/tool-output';

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
  let currentRunId = $state<string | null>(null);
  let loadGeneration = 0;

  // Node.js availability
  let nodeAvailable = $state<boolean | null>(null);

  const pythonRuntimeState = $derived(mod?.runtime === 'python' ? liaPluginsStore.pythonRuntimeStates[mod.id] ?? null : null);
  const pythonRuntimeBusy = $derived(pythonRuntimeState?.phase === 'checking' || pythonRuntimeState?.phase === 'preparing');
  const pythonRuntimeReady = $derived(mod?.runtime !== 'python' || pythonRuntimeState?.phase === 'ready');

  function resetRunOutput() {
    running = false;
    currentRunId = null;
    jobId = null;
    stdoutLines = [];
    stderrLines = [];
    exitCode = undefined;
    result = null;
    savedFiles = [];
  }

  async function loadPlugin(pluginId: string) {
    const generation = ++loadGeneration;
    resetRunOutput();
    values = {};
    mod = null;
    nodeAvailable = null;
    await liaPluginsStore.init();
    if (generation !== loadGeneration || id !== pluginId) return;
    mod = liaPluginsStore.byId(pluginId);
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

    if (mod.runtime === 'python') {
      await liaPluginsStore.ensurePythonRuntimeStatus(mod.id);
    }
  }

  $effect(() => {
    const pluginId = id;
    queueMicrotask(() => void loadPlugin(pluginId));
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
    !pythonRuntimeBusy &&
    pythonRuntimeReady &&
    nodeAvailable !== false &&
    !!mod &&
    Object.entries(mod.inputSchema).every(([key, field]) => fieldHasValue(key, field))
  );

  async function preparePythonRuntime() {
    if (!mod || mod.runtime !== 'python') return;
    const state = await liaPluginsStore.preparePythonRuntime(mod.id);
    if (state?.phase === 'ready') {
      toast.success('Python runtime is ready');
    } else if (state?.error) {
      toast.error('Failed to prepare Python runtime');
    }
  }

  async function refreshPythonRuntime() {
    if (!mod || mod.runtime !== 'python') return;
    await liaPluginsStore.refreshPythonRuntimeStatus(mod.id);
  }

  async function run() {
    const workspaceId = workspaceStore.activeId;
    const plugin = mod;
    const api = liatir();
    if (!plugin || !workspaceId || !api) return;
    const runValues = { ...values };
    running = true;
    jobId = null;
    stdoutLines = [];
    stderrLines = [];
    exitCode = undefined;
    result = null;
    savedFiles = [];
    const runId = crypto.randomUUID();
    const runStdout: string[] = [];
    const runStderr: string[] = [];
    let runResult: unknown = null;
    let runSavedFiles: PluginSaveResult[] = [];
    const isCurrentPageRun = () => currentRunId === runId && id === plugin.id;
    currentRunId = runId;
    const startedAt = Date.now();
    const execution = createLiatirRootExecutionIdentity({
      runId,
      runKind: 'lia-plugin',
      workspaceId,
      entityId: plugin.id,
    });

    try {
      await executionRuns.begin({
        identity: execution,
        label: plugin.name,
        resultPolicy: 'own',
        resultId: runId,
        inputs: Object.values(runValues) as JsonValue,
        params: runValues as JsonValue,
        startedAt,
      });
      const out = await runLiatirPlugin(plugin, runValues, (stream, line) => {
        if (stream === 'stdout') runStdout.push(line);
        else runStderr.push(line);
        if (isCurrentPageRun()) {
          stdoutLines = [...runStdout];
          stderrLines = [...runStderr];
        }
        void executionRuns.appendLog(runId, line, {
          stream,
          level: stream === 'stderr' ? 'error' : 'info',
        }).catch(() => {});
      }, {
        workspaceId,
        label: plugin.name,
        kind: 'lia-plugin',
        metadata: {
          ...liatirExecutionMetadata(execution),
          pluginId: plugin.id,
          pluginRuntime: plugin.runtime,
        },
        signal: executionRuns.signal(runId),
        onSpawn: (spawnedJobId) => {
          if (isCurrentPageRun()) jobId = spawnedJobId;
          void executionRuns.attachJob(runId, spawnedJobId).catch(() => {});
        },
      });
      runResult = out.result;
      if (isCurrentPageRun()) {
        result = runResult;
        exitCode = out.exitCode;
      }

      if (out.exitCode !== 0) {
        throw new Error(out.stderr.at(-1) ?? `Plugin exited with code ${out.exitCode}.`);
      }

      // Persist any file-typed outputs into Results (same as native tools).
      if (Object.keys(plugin.outputSchema).length > 0) {
        try {
          runSavedFiles = await savePluginResultFiles(plugin.name, plugin.outputSchema, runResult, runId);
          if (isCurrentPageRun()) savedFiles = runSavedFiles;
          if (runSavedFiles.length > 0) {
            toast.success(`Saved ${runSavedFiles.length} file${runSavedFiles.length > 1 ? 's' : ''} to Results`);
          }
        } catch (e) {
          toast.error(`Failed to save plugin outputs: ${e}`);
          throw e;
        }
      }
      const endedAt = Date.now();
      const output: ToolOutput = {
        sections: [{
          type: 'text',
          label: 'Plugin result',
          content: runResult === null ? 'Plugin completed.' : JSON.stringify(runResult, null, 2),
          mono: runResult !== null,
        }],
      };
      await finalizeExecutionResult(runId, 'done', {
        id: runId,
        tool: plugin.id,
        label: plugin.name,
        inputs: Object.values(runValues).filter((value): value is string => typeof value === 'string'),
        outputFiles: runSavedFiles,
        // A plugin reaches the filesystem only through the SDK's save calls, and everything it
        // saves that way is already in `runSavedFiles`.
        sideEffects: [],
        params: { ...runValues, runtime: plugin.runtime, pluginVersion: plugin.version },
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        output,
        error: null,
        log: [...runStderr, ...runStdout],
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!runStderr.includes(message)) runStderr.push(message);
      if (isCurrentPageRun()) {
        stderrLines = [...runStderr];
        exitCode = 1;
      }
      const cancelled = executionRuns.byId(runId)?.status === 'cancelling' ||
        (e instanceof DOMException && e.name === 'AbortError');
      if (executionRuns.byId(runId)) {
        const endedAt = Date.now();
        await finalizeExecutionResult(runId, cancelled ? 'cancelled' : 'error', {
          id: runId,
          tool: plugin.id,
          label: plugin.name,
          inputs: Object.values(runValues).filter((value): value is string => typeof value === 'string'),
          sideEffects: [],
          params: { ...runValues, runtime: plugin.runtime, pluginVersion: plugin.version },
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          output: null,
          error: cancelled ? 'Plugin run was cancelled.' : message,
          log: [...runStderr, ...runStdout],
        }).catch(() => {});
      }
    } finally {
      if (isCurrentPageRun()) {
        running = false;
        currentRunId = null;
      }
    }
  }

  async function cancelRun() {
    if (!currentRunId) return;
    await executionRuns.cancel(currentRunId);
  }

  const hasRun = $derived(exitCode !== undefined);
  const succeeded = $derived(exitCode === 0);

  function runtimeLabel(runtime: LiatirPlugin['runtime']) {
    if (runtime === 'wasm') return 'WASM .lia';
    if (runtime === 'python') return 'Python .lia';
    return 'Node .lia';
  }

  function pythonRuntimeSummary(): string {
    const state = pythonRuntimeState;
    if (!state || state.phase === 'checking') return 'Checking the managed Python runtime for this plugin.';
    if (state.phase === 'preparing') return 'Preparing the managed Python runtime for this plugin.';
    if (state.phase === 'ready') {
      const parts = ['Ready'];
      if (state.pythonVersion) parts.push(state.pythonVersion);
      if (state.sizeBytes) parts.push(fmtBytes(state.sizeBytes));
      return parts.join(' · ');
    }
    if (state.phase === 'not-prepared') return 'Runtime not prepared yet. Prepare it once before running this plugin.';
    return sanitizeLocalPathsForDisplay(state.error ?? 'Runtime needs attention.', 2);
  }

  function declaredPythonPackages(): string[] {
    if (!mod?.python) return [];
    return [
      ...(mod.python.packages ?? []).map((pkg) => pkg.specifier ?? (pkg.version ? `${pkg.package}==${pkg.version}` : pkg.package)),
      ...(mod.python.requirements ?? []),
    ];
  }
</script>

{#if mod}
  <div class="flex flex-col h-full">
    <PageHeader title={mod.name} description={mod.description || `Manage and run your plugin`}>
      {#snippet actions()}
        <span class="text-xs font-mono text-text-subtle">v{mod!.version} | </span>
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
            <span class="rounded px-1.5 py-0.5 text-[10px] font-medium border bg-surface text-text-muted border-border">
              {tag}
            </span>
          {/each}
          <span class="ml-auto text-xs text-text-subtle">{Object.keys(mod.inputSchema).length} input{Object.keys(mod.inputSchema).length !== 1 ? 's' : ''}</span>
          <span class="text-xs text-text-subtle">{Object.keys(mod.outputSchema).length} output{Object.keys(mod.outputSchema).length !== 1 ? 's' : ''}</span>
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
              <p class="text-sm font-medium text-text-secondary">Node.js not found</p>
              <p class="text-xs text-text-subtle mt-0.5">.lia plugins require Node.js ≥18. Install it from <span class="font-mono">nodejs.org</span> or via your package manager.</p>
            </div>
          </div>
        </Card>
      {/if}

      {#if mod.runtime === 'python'}
        <Card>
          <div class="px-4 py-4 flex flex-col gap-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="text-sm font-medium text-text-secondary">Python runtime</p>
                  <Badge
                    hideDot
                    size="xs"
                    variant={pythonRuntimeState?.phase === 'ready' ? 'available' : pythonRuntimeState?.phase === 'error' ? 'missing' : 'neutral'}
                  >
                    {pythonRuntimeState?.phase === 'ready' ? 'Ready' : pythonRuntimeState?.phase === 'preparing' ? 'Preparing' : pythonRuntimeState?.phase === 'checking' ? 'Checking' : pythonRuntimeState?.phase === 'error' ? 'Needs attention' : 'Not prepared'}
                  </Badge>
                </div>
                <p class="mt-1 text-xs text-text-muted">{pythonRuntimeSummary()}</p>
                {#if declaredPythonPackages().length > 0}
                  <p class="mt-2 text-[11px] text-text-subtle">
                    Dependencies: {declaredPythonPackages().slice(0, 4).join(', ')}{declaredPythonPackages().length > 4 ? ` +${declaredPythonPackages().length - 4}` : ''}
                  </p>
                {:else}
                  <p class="mt-2 text-[11px] text-text-subtle">No external Python packages declared.</p>
                {/if}
                {#if pythonRuntimeState?.missingPackages?.length}
                  <p class="mt-2 text-[11px] text-amber-600">
                    Missing packages: {pythonRuntimeState.missingPackages.join(', ')}
                  </p>
                {/if}
              </div>

              <div class="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onclick={refreshPythonRuntime}
                  disabled={pythonRuntimeBusy || running}
                >
                  Refresh
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onclick={preparePythonRuntime}
                  loading={pythonRuntimeState?.phase === 'preparing'}
                  disabled={pythonRuntimeBusy || running}
                >
                  Prepare runtime
                </Button>
              </div>
            </div>
          </div>
        </Card>
      {/if}

      <!-- Input form -->
      <Card>
        <div class="px-4 py-3 border-b border-border">
          <p class="text-xs font-semibold text-text-muted uppercase tracking-wider">Inputs</p>
        </div>
        <div class="px-4 py-4 space-y-4">
          {#if Object.keys(mod.inputSchema).length === 0}
            <p class="text-sm text-text-subtle">This plugin takes no inputs.</p>
          {:else}
            {#each inputFields(mod.inputSchema) as [key, field]}
              <div class="flex flex-col gap-1.5">
                <label class="text-xs font-medium text-text-secondary" for="field-{key}">
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
                    disabled={running || pythonRuntimeBusy}
                    searchable
                    onchange={(value) => (values[key] = value)}
                  />
                {:else if field.type === 'boolean'}
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      id="field-{key}"
                      type="checkbox"
                      bind:checked={values[key] as boolean}
                      disabled={running || pythonRuntimeBusy}
                      class="rounded border-border text-brand"
                    />
                    <span class="text-sm text-text-secondary">{field.description ?? ''}</span>
                  </label>
                {:else if field.type === 'number'}
                  <input
                    id="field-{key}"
                    type="number"
                    bind:value={values[key]}
                    placeholder={String(field.default ?? '')}
                    disabled={running || pythonRuntimeBusy}
                    class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand/60 transition-colors"
                  />
                {:else}
                  <input
                    id="field-{key}"
                    type="text"
                    bind:value={values[key]}
                    placeholder={String(field.default ?? '')}
                    disabled={running || pythonRuntimeBusy}
                    class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand/60 transition-colors"
                  />
                {/if}

                {#if field.description && field.type !== 'boolean'}
                  <p class="text-[11px] text-text-subtle">{field.description}</p>
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
              testId="plugin-run-button"
            >
              {running ? 'Running…' : mod.runtime === 'python' && !pythonRuntimeReady ? 'Prepare runtime first' : 'Run'}
            </Button>
            {#if running}
              <Button variant="secondary" size="sm" onclick={cancelRun} testId="plugin-cancel-button">Cancel</Button>
            {/if}
          </div>
        </div>
      </Card>

      <!-- Output -->
      {#if running || hasRun}
        <Card testId="plugin-run-output">
          <div class="px-4 py-3 border-b border-border flex items-center gap-2">
            <p class="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">Output</p>
            {#if hasRun}
              <span class="rounded-full px-2 py-0.5 text-[10px] font-medium {succeeded ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}">
                {succeeded ? 'Done' : `Exit ${exitCode}`}
              </span>
            {:else}
              <span class="text-[10px] text-text-subtle animate-pulse">running…</span>
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
              <p class="text-[10px] font-semibold text-text-subtle uppercase tracking-wider mb-1.5">Saved to Results</p>
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
              <p class="text-[10px] font-semibold text-text-subtle uppercase tracking-wider mb-1.5">stdout</p>
              <pre class="text-xs text-text-secondary whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">{sanitizeLocalPathsForDisplay(stdoutLines.join('\n'), 2)}</pre>
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
            <div class="px-4 py-6 text-center text-xs text-text-subtle">Waiting for output…</div>
          {/if}
        </Card>
      {/if}

    </div>
    </PageContent>
  </div>
{/if}
