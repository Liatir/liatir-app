<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { liatir } from '$lib/api';
  import { sanitizeLocalPathsForDisplay, getLastSegmentsStringFromPath } from '$lib/utils';
  import type { FieldDef, PluginRuntime } from '$lib/stores/lia-plugins.svelte';

  type PluginDevSession = {
    sessionId: string;
    projectDir: string;
    bundlePath?: string | null;
    manifest?: {
      name?: string;
      version?: string;
      description?: string;
      runtime?: PluginRuntime;
      inputSchema?: Record<string, FieldDef>;
      outputSchema?: Record<string, FieldDef>;
    } | null;
    runtime?: PluginRuntime | null;
    status: 'ready' | 'error' | string;
    error?: string | null;
    buildId?: string | null;
    initialInputs?: Record<string, unknown> | null;
    updatedAtMs: number;
    windowLabel: string;
  };

  type BufferedOutput = {
    stdout: string[];
    stderr: string[];
    stdoutTotal: number;
    stderrTotal: number;
  };

  type JobEntry = {
    id: string;
    label?: string | null;
    kind?: string | null;
    startedAtMs?: number;
    endedAtMs?: number | null;
    status: { type: 'running' | 'done' | 'failed' | 'killed'; exitCode?: number | null };
  };

  const sessionId = $derived(page.url.searchParams.get('session') ?? '');

  let session = $state<PluginDevSession | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let values = $state<Record<string, string | number | boolean>>({});
  let running = $state(false);
  let stdoutLines = $state<string[]>([]);
  let stderrLines = $state<string[]>([]);
  let devJobs = $state<JobEntry[]>([]);
  let result = $state<unknown>(null);
  let exitCode = $state<number | null | undefined>(undefined);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBuildId: string | null = null;

  const manifest = $derived(session?.manifest ?? null);
  const inputSchema = $derived((manifest?.inputSchema ?? {}) as Record<string, FieldDef>);
  const outputSchema = $derived((manifest?.outputSchema ?? {}) as Record<string, FieldDef>);
  const runtime = $derived((session?.runtime ?? manifest?.runtime ?? 'node') as PluginRuntime);
  const hasRun = $derived(exitCode !== undefined);
  const succeeded = $derived(exitCode === 0);
  const ready = $derived(session?.status === 'ready' && !!session.bundlePath);
  const canRun = $derived(
    ready &&
    !running &&
    Object.entries(inputSchema).every(([key, field]) => fieldHasValue(key, field))
  );

  function runtimeLabel(value: PluginRuntime) {
    if (value === 'python') return 'Python';
    if (value === 'wasm') return 'WASM';
    return 'Node';
  }

  function inputFields(schema: Record<string, FieldDef>) {
    return Object.entries(schema);
  }

  function fieldHasValue(key: string, field: FieldDef): boolean {
    if (!field.required) return true;
    const value = values[key];
    if (field.type === 'boolean') return value !== undefined;
    if (field.type === 'number') return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
    return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
  }

  function applyDefaults(nextSession: PluginDevSession) {
    const schema = (nextSession.manifest?.inputSchema ?? {}) as Record<string, FieldDef>;
    const nextValues: Record<string, string | number | boolean> = {};
    for (const [key, field] of Object.entries(schema)) {
      const previous = values[key];
      if (previous !== undefined) nextValues[key] = previous;
      else if (nextSession.initialInputs && nextSession.initialInputs[key] !== undefined) {
        nextValues[key] = nextSession.initialInputs[key] as string | number | boolean;
      }
      else if (field.default !== undefined) nextValues[key] = field.default;
      else if (field.type === 'boolean') nextValues[key] = false;
      else nextValues[key] = '';
    }
    values = nextValues;
  }

  async function refreshSession() {
    const api = liatir();
    if (!api || !sessionId) {
      loadError = 'Plugin dev session is not available.';
      loading = false;
      return;
    }

    try {
      const nextSession = await api.invoke('lia_plugin_dev_get_session', { sessionId }) as PluginDevSession | null;
      if (!nextSession) {
        loadError = 'Plugin dev session was closed.';
        session = null;
      } else {
        loadError = null;
        session = nextSession;
        if (nextSession.buildId !== lastBuildId) {
          lastBuildId = nextSession.buildId ?? null;
          applyDefaults(nextSession);
        }
      }
    } catch (error) {
      loadError = String(error);
    } finally {
      loading = false;
    }
  }

  async function chooseFile(key: string, field: FieldDef) {
    if (running) return;
    const api = liatir();
    if (!api) return;
    const opened = await api.desktop.files.open({ multi: false, allowed: field.accept ?? undefined });
    const path = opened.paths[0];
    if (path) values[key] = path;
  }

  function clearOutput() {
    stdoutLines = [];
    stderrLines = [];
    devJobs = [];
    result = null;
    exitCode = undefined;
  }

  async function refreshDevJobs() {
    const api = liatir();
    if (!api || !sessionId) return;
    try {
      devJobs = await api.invoke('lia_plugin_dev_list_jobs', { sessionId }) as JobEntry[];
    } catch {
      // Dev job listing is diagnostic; the main run output remains authoritative.
    }
  }

  async function pollJob(jobId: string) {
    const api = liatir();
    if (!api) throw new Error('Liatir API not available.');

    let stdoutSeen = 0;
    let stderrSeen = 0;
    while (true) {
      const [out, entry] = await Promise.all([
        api.invoke('lia_jobs_get_output', { jobId }) as Promise<BufferedOutput>,
        api.invoke('lia_jobs_status', { jobId }) as Promise<JobEntry>,
      ]);
      await refreshDevJobs();

      for (const line of out.stdout.slice(stdoutSeen)) {
        if (line.startsWith('__LIATIR_RESULT__')) {
          try { result = JSON.parse(line.slice('__LIATIR_RESULT__'.length)); } catch { /* ignore malformed result marker */ }
        } else {
          stdoutLines = [...stdoutLines, line];
        }
      }
      for (const line of out.stderr.slice(stderrSeen)) {
        stderrLines = [...stderrLines, line];
      }

      stdoutSeen = out.stdoutTotal;
      stderrSeen = out.stderrTotal;

      if (entry.status.type !== 'running') {
        exitCode = entry.status.type === 'done' ? (entry.status.exitCode ?? 0) : (entry.status.exitCode ?? 1);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async function run() {
    if (!sessionId || !canRun) return;
    const api = liatir();
    if (!api) return;
    running = true;
    clearOutput();
    try {
      const response = await api.invoke('lia_plugin_dev_run', { sessionId, inputs: values }) as
        | { jobId: string }
        | { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };

      if ('jobId' in response && response.jobId) {
        await pollJob(response.jobId);
      } else {
        const direct = response as { ok: boolean; value?: unknown; stdout?: string; stderr?: string; error?: string };
        if (direct.value !== undefined && direct.value !== null) result = direct.value;
        for (const line of (direct.stdout ?? '').split('\n')) if (line) stdoutLines = [...stdoutLines, line];
        for (const line of (direct.stderr ?? '').split('\n')) if (line) stderrLines = [...stderrLines, line];
        if (direct.error) stderrLines = [...stderrLines, direct.error];
        exitCode = direct.ok ? 0 : 1;
      }
    } catch (error) {
      stderrLines = [String(error)];
      exitCode = 1;
    } finally {
      running = false;
    }
  }

  onMount(() => {
    void refreshSession();
    void refreshDevJobs();
    pollTimer = setInterval(() => {
      if (!running) void refreshSession();
      void refreshDevJobs();
    }, 900);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <header class="shrink-0 border-b border-border bg-surface px-5 py-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p class="truncate text-lg font-semibold text-zinc-800">{manifest?.name ?? 'Plugin dev session'}</p>
          {#if session}
            <Badge hideDot size="xs" variant={ready ? 'available' : session.status === 'error' ? 'missing' : 'neutral'}>
              {ready ? 'Ready' : session.status === 'error' ? 'Build error' : session.status}
            </Badge>
            <Badge hideDot size="xs" variant="brand">{runtimeLabel(runtime)}</Badge>
          {/if}
        </div>
        <p class="mt-1 max-w-3xl truncate text-xs text-zinc-500">
          {manifest?.description || 'Temporary .lia plugin dev runner'}
        </p>
        {#if session}
          <p class="mt-1 text-[11px] text-zinc-400">
            Project: {getLastSegmentsStringFromPath(session.projectDir, 2)}
          </p>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <Button variant="secondary" size="sm" onclick={refreshSession} disabled={running}>Refresh</Button>
        <Button variant="primary" size="sm" onclick={run} loading={running} disabled={!canRun}>
          {running ? 'Running...' : 'Run'}
        </Button>
      </div>
    </div>
  </header>

  <main class="min-h-0 flex-1 overflow-y-auto p-5">
    {#if loading}
      <div class="flex h-full items-center justify-center text-sm text-zinc-400">Loading dev session...</div>
    {:else if loadError}
      <Card>
        <div class="px-4 py-4">
          <p class="text-sm font-medium text-red-600">Dev session unavailable</p>
          <p class="mt-1 text-xs text-red-500">{sanitizeLocalPathsForDisplay(loadError, 2)}</p>
        </div>
      </Card>
    {:else if session}
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div class="space-y-4">
          {#if session.status === 'error'}
            <Card>
              <div class="px-4 py-4">
                <p class="text-sm font-medium text-red-600">Build failed</p>
                <pre class="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-red-500">{sanitizeLocalPathsForDisplay(session.error ?? 'Unknown build error.', 2)}</pre>
              </div>
            </Card>
          {/if}

          <Card>
            <div class="border-b border-border px-4 py-3">
              <p class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Inputs</p>
            </div>
            <div class="space-y-4 px-4 py-4">
              {#if Object.keys(inputSchema).length === 0}
                <p class="text-sm text-zinc-400">This plugin takes no inputs.</p>
              {:else}
                {#each inputFields(inputSchema) as [key, field]}
                  <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-medium text-zinc-600" for="field-{key}">
                      {field.label ?? key}
                      {#if field.required}<span class="ml-0.5 text-red-400">*</span>{/if}
                    </label>

                    {#if field.type === 'file'}
                      <div class="flex gap-2">
                        <input
                          id="field-{key}"
                          type="text"
                          bind:value={values[key] as string}
                          placeholder="Select or paste a file path"
                          disabled={running}
                          class="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800 outline-none transition-colors focus:border-brand/60"
                        />
                        <Button variant="secondary" size="sm" onclick={() => chooseFile(key, field)} disabled={running}>
                          Choose
                        </Button>
                      </div>
                    {:else if field.type === 'boolean'}
                      <label class="flex cursor-pointer items-center gap-2">
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
                        class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800 outline-none transition-colors focus:border-brand/60"
                      />
                    {:else}
                      <input
                        id="field-{key}"
                        type="text"
                        bind:value={values[key] as string}
                        placeholder={String(field.default ?? '')}
                        disabled={running}
                        class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-zinc-800 outline-none transition-colors focus:border-brand/60"
                      />
                    {/if}

                    {#if field.description && field.type !== 'boolean'}
                      <p class="text-[11px] text-zinc-400">{field.description}</p>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </Card>

          <Card>
            <div class="px-4 py-4">
              <p class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Contract</p>
              <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div class="rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <p class="text-zinc-400">Inputs</p>
                  <p class="mt-1 font-mono text-zinc-700">{Object.keys(inputSchema).length}</p>
                </div>
                <div class="rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <p class="text-zinc-400">Outputs</p>
                  <p class="mt-1 font-mono text-zinc-700">{Object.keys(outputSchema).length}</p>
                </div>
              </div>
            </div>
          </Card>

          {#if devJobs.length > 0}
            <Card>
              <div class="border-b border-border px-4 py-3">
                <p class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Session jobs</p>
              </div>
              <div class="divide-y divide-border">
                {#each devJobs as job}
                  <div class="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium text-zinc-700">{job.label ?? job.id}</p>
                      <p class="truncate text-[10px] text-zinc-400">{job.kind ?? job.id}</p>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium {job.status.type === 'running' ? 'bg-brand/10 text-brand' : job.status.type === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}">
                      {job.status.type}
                    </span>
                  </div>
                {/each}
              </div>
            </Card>
          {/if}
        </div>

        <div class="space-y-4">
          <Card>
            <div class="border-b border-border px-4 py-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Run output</p>
                {#if hasRun}
                  <span class="rounded-full px-2 py-0.5 text-[10px] font-medium {succeeded ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}">
                    {succeeded ? 'Done' : `Exit ${exitCode}`}
                  </span>
                {:else if running}
                  <span class="text-[10px] text-zinc-400">running...</span>
                {/if}
              </div>
            </div>

            {#if result !== null}
              <div class="border-b border-border bg-emerald-50/50 px-4 py-3">
                <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Result</p>
                <pre class="whitespace-pre-wrap font-mono text-xs text-emerald-800">{JSON.stringify(result, null, 2)}</pre>
              </div>
            {/if}

            {#if stdoutLines.length > 0}
              <div class="border-b border-border px-4 py-3">
                <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">stdout</p>
                <pre class="max-h-72 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700">{sanitizeLocalPathsForDisplay(stdoutLines.join('\n'), 2)}</pre>
              </div>
            {/if}

            {#if stderrLines.length > 0}
              <div class="px-4 py-3">
                <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">stderr</p>
                <pre class="max-h-72 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-red-600">{sanitizeLocalPathsForDisplay(stderrLines.join('\n'), 2)}</pre>
              </div>
            {/if}

            {#if !running && !hasRun}
              <div class="px-4 py-16 text-center">
                <Icon icon="lucide:play-circle" width="28" height="28" class="mx-auto text-zinc-300" />
                <p class="mt-2 text-sm text-zinc-400">Run the temporary plugin session to inspect output.</p>
              </div>
            {:else if running && stdoutLines.length === 0 && stderrLines.length === 0 && result === null}
              <div class="px-4 py-16 text-center text-sm text-zinc-400">Waiting for output...</div>
            {/if}
          </Card>
        </div>
      </div>
    {/if}
  </main>
</div>
