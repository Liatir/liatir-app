<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppUpdateCheckResult } from '../../../../src-ts/modules/rs/app/_types';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { liatir } from '$lib/api';
  import { settingsStore, type ThemePreference } from '$lib/stores/settings.svelte';
	import { goto } from '$app/navigation';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { getLastSegmentsStringFromPath } from '$lib/utils';
	import PageContent from '$lib/components/layout/PageContent.svelte';
	import { LIATIR_DOCS_URL } from '$lib/_constants';
  import type { NavHref } from '$lib/sidebarUtils';
  import type { LiatirMcpAuditRecord, LiatirMcpServerStatus } from '@liatir/core';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';

  let apiVersion = $state<string | null>(null);
  let appVersion = $state<string | null>(null);
  let updateState = $state<'idle' | 'checking' | 'available' | 'up-to-date' | 'installing' | 'ready' | 'error'>('idle');
  let availableUpdate = $state<AppUpdateCheckResult | null>(null);
  let updateMessage = $state<string | null>(null);
  let updateProgress = $state<number | null>(null);

  let javaPathInput = $state('');
  let javaSaving = $state(false);
  let javaSaved = $state(false);

  let mcpStatus = $state<LiatirMcpServerStatus | null>(null);
  let mcpAudit = $state<LiatirMcpAuditRecord[]>([]);
  let mcpBusy = $state<string | null>(null);
  let mcpError = $state<string | null>(null);
  let showMcpToken = $state(false);
  let copiedMcp = $state<string | null>(null);

  async function refreshMcp() {
    const api = liatir();
    if (!api) return;
    try {
      [mcpStatus, mcpAudit] = await Promise.all([
        api.desktop.mcp.status(),
        api.desktop.mcp.auditRecords(),
      ]);
      mcpError = null;
    } catch (error) {
      mcpError = readableError(error);
    }
  }

  onMount(() => {
    let disposed = false;
    let stopUpdateEvents: (() => void) | undefined;
    let stopMcpEvents: (() => void) | undefined;

    void (async () => {
      const api = liatir();
      if (!api) return;
      apiVersion = api.apiVersion ?? null;
      try {
        const info = await api.desktop.app.info();
        if (!disposed) appVersion = info?.version ?? null;
      } catch {}
      await settingsStore.init();
      if (!disposed) javaPathInput = settingsStore.javaPath;
      await Promise.all([pipelineStore.init(), dataFiles.init()]);
      await refreshMcp();

      stopMcpEvents = await api.desktop.events.on('mcp:state-changed', () => {
        if (!disposed) void refreshMcp();
      });

      stopUpdateEvents = await api.desktop.events.on('app:update-progress', (payload: {
        phase?: string;
        downloadedBytes?: number;
        totalBytes?: number | null;
      }) => {
        if (disposed || updateState !== 'installing') return;
        if (payload.phase === 'downloading') {
          updateMessage = 'Downloading the signed update…';
          updateProgress = payload.totalBytes
            ? Math.min(100, Math.round(((payload.downloadedBytes ?? 0) / payload.totalBytes) * 100))
            : null;
        } else if (payload.phase === 'verifying') {
          updateMessage = 'Verifying the update signature…';
          updateProgress = null;
        } else if (payload.phase === 'installing') {
          updateMessage = 'Installing the verified update…';
          updateProgress = null;
        }
      });
    })();

    return () => {
      disposed = true;
      stopUpdateEvents?.();
      stopMcpEvents?.();
    };
  });

  function readableError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'The operation could not be completed.';
  }

  async function checkForUpdate() {
    const api = liatir();
    if (!api) return;
    updateState = 'checking';
    availableUpdate = null;
    updateMessage = 'Contacting the signed release feed…';
    updateProgress = null;
    try {
      const result = await api.desktop.app.updates.check();
      availableUpdate = result;
      if (result.available) {
        updateState = 'available';
        updateMessage = `Liatir ${result.version} is ready to install.`;
      } else {
        updateState = 'up-to-date';
        updateMessage = `Liatir ${result.currentVersion} is up to date.`;
      }
    } catch (error) {
      updateState = 'error';
      updateMessage = readableError(error);
    }
  }

  async function installUpdate() {
    const api = liatir();
    if (!api) return;
    updateState = 'installing';
    updateMessage = 'Preparing the signed update…';
    updateProgress = null;
    try {
      const result = await api.desktop.app.updates.install();
      updateState = 'ready';
      updateMessage = `Liatir ${result.version} is installed. Restart when you are ready.`;
    } catch (error) {
      updateState = 'error';
      updateMessage = readableError(error);
    }
  }

  async function restartAfterUpdate() {
    const api = liatir();
    if (!api) return;
    try {
      await api.desktop.app.updates.restart();
    } catch (error) {
      updateState = 'error';
      updateMessage = readableError(error);
    }
  }

  async function saveJavaPath() {
    javaSaving = true;
    await settingsStore.setJavaPath(javaPathInput);
    javaSaving = false;
    javaSaved = true;
    setTimeout(() => { javaSaved = false; }, 2000);
  }

  async function setMcpEnabled(enabled: boolean) {
    const api = liatir();
    if (!api) return;
    mcpBusy = enabled ? 'enable' : 'disable';
    mcpError = null;
    try {
      mcpStatus = await api.desktop.mcp.setEnabled(enabled);
      mcpAudit = await api.desktop.mcp.auditRecords();
    } catch (error) {
      mcpError = readableError(error);
    } finally {
      mcpBusy = null;
    }
  }

  async function rotateMcpToken() {
    const api = liatir();
    if (!api) return;
    mcpBusy = 'rotate';
    mcpError = null;
    try {
      mcpStatus = await api.desktop.mcp.rotateToken();
      mcpAudit = await api.desktop.mcp.auditRecords();
      showMcpToken = true;
    } catch (error) {
      mcpError = readableError(error);
    } finally {
      mcpBusy = null;
    }
  }

  async function setPipelineAllowed(pipelineId: string, allowed: boolean) {
    const api = liatir();
    const workspaceId = workspaceStore.activeId;
    if (!api || !workspaceId) return;
    mcpBusy = `pipeline:${pipelineId}`;
    mcpError = null;
    try {
      mcpStatus = allowed
        ? await api.desktop.mcp.allowPipeline(
            workspaceId,
            pipelineId,
            pipelineStore.mcpInputSchema(pipelineId),
          )
        : await api.desktop.mcp.revokePipeline(workspaceId, pipelineId);
      mcpAudit = await api.desktop.mcp.auditRecords();
    } catch (error) {
      mcpError = readableError(error);
    } finally {
      mcpBusy = null;
    }
  }

  function grantFor(pipelineId: string) {
    return mcpStatus?.allowlist.find((grant) =>
      grant.workspaceId === workspaceStore.activeId && grant.pipelineId === pipelineId
    ) ?? null;
  }

  function dataGrantFor(artifactId: string) {
    return mcpStatus?.dataAllowlist.find((grant) =>
      grant.workspaceId === workspaceStore.activeId && grant.artifactId === artifactId
    ) ?? null;
  }

  function mcpSourceFiles() {
    return dataFiles.files.filter((file) =>
      !file.missing && file.folder !== 'Results' && !file.folder.startsWith('Results/')
    );
  }

  async function setResultsReadable(enabled: boolean) {
    const api = liatir();
    if (!api) return;
    mcpBusy = 'results';
    mcpError = null;
    try {
      mcpStatus = await api.desktop.mcp.setReadResults(enabled);
      mcpAudit = await api.desktop.mcp.auditRecords();
    } catch (error) {
      mcpError = readableError(error);
    } finally {
      mcpBusy = null;
    }
  }

  async function setDataFileAllowed(artifactId: string, allowed: boolean) {
    const api = liatir();
    const workspaceId = workspaceStore.activeId;
    if (!api || !workspaceId) return;
    mcpBusy = `file:${artifactId}`;
    mcpError = null;
    try {
      mcpStatus = allowed
        ? await api.desktop.mcp.allowDataFile(workspaceId, artifactId)
        : await api.desktop.mcp.revokeDataFile(workspaceId, artifactId);
      mcpAudit = await api.desktop.mcp.auditRecords();
    } catch (error) {
      mcpError = readableError(error);
    } finally {
      mcpBusy = null;
    }
  }

  async function copyMcp(label: string, value: string | null | undefined) {
    const api = liatir();
    if (!api || !value) return;
    await api.desktop.clipboard.writeText(value);
    copiedMcp = label;
    setTimeout(() => { if (copiedMcp === label) copiedMcp = null; }, 1800);
  }

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  const testAPIButtonCallback = () => goto("/scripts");
  const docsButtonCallback = () => {
    const api = liatir();
    api?.openBrowser(LIATIR_DOCS_URL);
  };

  function fmtPath(p: string | null | undefined) {
    return p ? getLastSegmentsStringFromPath(p, 2) : '—';
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Settings" description="Application configuration" />

  <PageContent>
  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    <!-- About -->
    <section>
      <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">About</h2>
      <Card class="divide-y divide-border overflow-hidden">
        {#each [
          { label: 'Application', value: 'Liatir' },
          { label: 'App Version', value: appVersion ?? '—' },
          { label: 'Active Workspace', value: (workspaceStore?.activeId) ? (workspaceStore?.isSandboxMode)?'[sandbox]':((workspaceStore?.active?.name)??'-') : '—' },
          { label: 'API Version', value: apiVersion ?? '—' },
          { label: 'Dependencies', value: '⟶', callback: ()=>goto(("/deps") as NavHref)},
          { label: 'Test Liatir API', value: '⟶', callback: testAPIButtonCallback, hidden: !workspaceStore.isSandboxMode },
          { label: 'Liatir Documentation', value: '⟶', callback: docsButtonCallback },
        ] as row}
          {#if !(row?.hidden)}
            <div class="flex items-center justify-between px-4 py-3 {(row?.callback)?"hover:bg-surface-2 cursor-pointer":""}" role={(row?.callback) ? 'button' : undefined} onclick={row?.callback??undefined}>
              <span class="text-sm text-text-secondary">{row.label}</span>
              <span class="text-sm font-mono text-text" data-selectable>{row.value}</span>
            </div>
          {/if}
        {/each}
      </Card>
    </section>

    <!-- Application updates -->
    <section>
      <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Application updates</h2>
      <Card class="p-4 space-y-3">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <p class="text-sm text-text-secondary">Keep Liatir current</p>
            <p class="text-[11px] text-text-subtle">
              Liatir checks for updates only when you ask. Your data and analyses stay local and continue to work offline.
            </p>
          </div>
          {#if updateState === 'available'}
            <Button
              variant="primary"
              size="sm"
              testId="app-update-install"
              onclick={installUpdate}
            >Install update</Button>
          {:else if updateState === 'ready'}
            <Button
              variant="primary"
              size="sm"
              testId="app-update-restart"
              onclick={restartAfterUpdate}
            >Restart Liatir</Button>
          {:else}
            <Button
              variant="secondary"
              size="sm"
              testId="app-update-check"
              loading={updateState === 'checking' || updateState === 'installing'}
              onclick={checkForUpdate}
            >Check for updates</Button>
          {/if}
        </div>

        {#if updateMessage}
          <div
            class="rounded-lg border px-3 py-2 text-xs {updateState === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-400'
              : updateState === 'ready' || updateState === 'up-to-date'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                : 'border-border bg-surface-2 text-text-secondary'}"
            data-testid="app-update-status"
            role={updateState === 'error' ? 'alert' : 'status'}
          >
            {updateMessage}
            {#if updateProgress !== null}
              <span class="ml-1 font-mono">{updateProgress}%</span>
            {/if}
          </div>
        {/if}

        {#if updateState === 'available' && availableUpdate?.notes}
          <div class="rounded-lg border border-border bg-surface-2 p-3">
            <p class="mb-1 text-[11px] font-medium text-text-muted">What changed</p>
            <p class="whitespace-pre-wrap text-xs text-text-secondary" data-testid="app-update-notes">{availableUpdate.notes}</p>
          </div>
        {/if}
      </Card>
    </section>

    <!-- Appearance -->
    <section>
      <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Appearance</h2>
      <Card class="p-4 space-y-1.5">
        <span class="text-sm text-text-muted">Theme</span>
        <p class="text-[11px] text-text-subtle">
          Choose how Liatir looks. "System" follows your operating system preference.
        </p>
        <div class="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit" role="radiogroup" aria-label="Theme">
          {#each themeOptions as opt}
            <button
              type="button"
              role="radio"
              aria-checked={settingsStore.theme === opt.value}
              class="px-3 py-1 rounded-md text-xs font-medium transition-colors
                     {settingsStore.theme === opt.value
                       ? 'bg-surface text-text shadow-sm'
                       : 'text-text-muted hover:text-text'}"
              onclick={() => settingsStore.setTheme(opt.value)}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </Card>
    </section>

    <!-- Local MCP -->
    <section>
      <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Local MCP</h2>
      <Card class="p-4 space-y-4">
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <p class="text-sm font-medium text-text-secondary">Connect an AI client to Liatir</p>
            <p class="max-w-2xl text-[11px] leading-relaxed text-text-subtle">
              The server stays on this computer and is off by default. A client can read only the active workspace and allowed run evidence. Every pipeline run still needs your approval in Liatir.
            </p>
          </div>
          <Button
            variant={mcpStatus?.enabled ? 'danger' : 'primary'}
            size="sm"
            loading={mcpBusy === 'enable' || mcpBusy === 'disable'}
            testId="mcp-toggle"
            onclick={() => void setMcpEnabled(!mcpStatus?.enabled)}
          >{mcpStatus?.enabled ? 'Turn off' : 'Turn on'}</Button>
        </div>

        <div class="flex items-center gap-2 text-xs" data-testid="mcp-status">
          <span class="h-2 w-2 rounded-full {mcpStatus?.enabled ? 'bg-emerald-500' : 'bg-text-subtle'}"></span>
          <span class="font-medium {mcpStatus?.enabled ? 'text-emerald-500' : 'text-text-muted'}">
            {mcpStatus?.enabled ? 'Ready for local clients' : 'Off'}
          </span>
          {#if mcpStatus?.pendingCount}
            <span class="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-500">{mcpStatus.pendingCount} waiting for approval</span>
          {/if}
        </div>

        {#if mcpStatus?.enabled}
          <div class="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
            <div class="space-y-1.5">
              <label for="mcp-endpoint" class="text-[11px] font-medium text-text-muted">Server URL</label>
              <div class="flex gap-2">
                <input id="mcp-endpoint" readonly value={mcpStatus.endpoint ?? 'Starting…'} class="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-secondary" data-testid="mcp-endpoint" />
                <Button size="sm" variant="secondary" disabled={!mcpStatus.endpoint} onclick={() => void copyMcp('url', mcpStatus?.endpoint)}>
                  {copiedMcp === 'url' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            <div class="space-y-1.5">
              <label for="mcp-token" class="text-[11px] font-medium text-text-muted">Bearer token</label>
              <div class="flex gap-2">
                <input id="mcp-token" readonly type={showMcpToken ? 'text' : 'password'} value={mcpStatus.bearerToken} class="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-secondary" data-testid="mcp-token" />
                <Button size="sm" variant="secondary" onclick={() => { showMcpToken = !showMcpToken; }}>{showMcpToken ? 'Hide' : 'Show'}</Button>
                <Button size="sm" variant="secondary" onclick={() => void copyMcp('token', mcpStatus?.bearerToken)}>{copiedMcp === 'token' ? 'Copied' : 'Copy'}</Button>
              </div>
              <p class="text-[11px] text-text-subtle">Treat this token like a password. Rotating it disconnects current clients.</p>
            </div>
            <Button size="sm" variant="secondary" loading={mcpBusy === 'rotate'} testId="mcp-rotate-token" onclick={() => void rotateMcpToken()}>Rotate token</Button>
          </div>
        {/if}

        <div class="space-y-2">
          <div>
            <p class="text-sm text-text-secondary">Saved pipelines clients may request</p>
            <p class="text-[11px] text-text-subtle">Permission applies only to the current saved revision. Editing a pipeline makes the permission stale.</p>
          </div>
          {#if pipelineStore.savedPipelines.length === 0}
            <p class="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-subtle">Save a pipeline first, then allow it here.</p>
          {:else}
            <div class="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {#each pipelineStore.savedPipelines as pipeline (pipeline.id)}
                {@const grant = grantFor(pipeline.id)}
                {@const current = grant?.pipelineRevision === String(pipeline.updatedAt)}
                {@const inputCount = current ? (grant.inputs?.length ?? 0) : pipelineStore.mcpInputSchema(pipeline.id).length}
                <div class="flex items-center justify-between gap-3 bg-surface-2 px-3 py-3" data-testid={`mcp-pipeline-${pipeline.id}`}>
                  <div class="min-w-0">
                    <p class="truncate text-sm text-text-secondary">{pipeline.name}</p>
                    <p class="text-[11px] {current ? 'text-emerald-500' : grant ? 'text-amber-500' : 'text-text-subtle'}">
                      {current ? 'Allowed for this revision' : grant ? 'Changed since it was allowed' : 'Not allowed'}
                    </p>
                    <p class="mt-0.5 text-[11px] text-text-subtle">{inputCount} run-time input{inputCount === 1 ? '' : 's'} available to the client</p>
                  </div>
                  <Button
                    size="sm"
                    variant={current ? 'danger' : 'secondary'}
                    loading={mcpBusy === `pipeline:${pipeline.id}`}
                    onclick={() => void setPipelineAllowed(pipeline.id, !current)}
                  >{current ? 'Revoke' : grant ? 'Allow new revision' : 'Allow'}</Button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="space-y-2 border-t border-border pt-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm text-text-secondary">Results</p>
              <p class="max-w-2xl text-[11px] leading-relaxed text-text-subtle">
                Artifacts produced by an MCP run are readable by that client automatically. Turn this on only if clients may also list and read every Result in the active workspace.
              </p>
            </div>
            <Button
              size="sm"
              variant={mcpStatus?.readResults ? 'danger' : 'secondary'}
              loading={mcpBusy === 'results'}
              testId="mcp-results-toggle"
              onclick={() => void setResultsReadable(!mcpStatus?.readResults)}
            >{mcpStatus?.readResults ? 'Revoke' : 'Allow Results'}</Button>
          </div>
          <p class="text-[11px] {mcpStatus?.readResults ? 'text-emerald-500' : 'text-text-subtle'}" data-testid="mcp-results-status">
            {mcpStatus?.readResults ? 'All Results in this workspace are readable' : 'Only Results from MCP-owned runs are readable'}
          </p>
        </div>

        <div class="space-y-2 border-t border-border pt-4">
          <div>
            <p class="text-sm text-text-secondary">Source files from Data</p>
            <p class="max-w-2xl text-[11px] leading-relaxed text-text-subtle">
              Allow individual registered files so a client can read them or pass their artifact ID to a pipeline file input. Liatir never exposes their filesystem paths.
            </p>
          </div>
          {#if mcpSourceFiles().length === 0}
            <p class="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-text-subtle">Add a source file to Data first.</p>
          {:else}
            <div class="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {#each mcpSourceFiles() as file (file.id)}
                {@const allowed = Boolean(dataGrantFor(file.id))}
                <div class="flex items-center justify-between gap-3 bg-surface-2 px-3 py-3" data-testid={`mcp-data-file-${file.id}`}>
                  <div class="min-w-0">
                    <p class="truncate text-sm text-text-secondary">{file.name}</p>
                    <p class="truncate text-[11px] text-text-subtle">{file.folder || 'Data'} · {file.ext || 'file'}{file.size != null ? ` · ${file.size.toLocaleString()} bytes` : ''}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={allowed ? 'danger' : 'secondary'}
                    loading={mcpBusy === `file:${file.id}`}
                    onclick={() => void setDataFileAllowed(file.id, !allowed)}
                  >{allowed ? 'Revoke' : 'Allow'}</Button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if mcpError}
          <p role="alert" class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400" data-testid="mcp-settings-error">{mcpError}</p>
        {/if}

        {#if mcpAudit.length > 0}
          <details class="text-xs text-text-muted">
            <summary class="cursor-pointer select-none font-medium">Recent security activity</summary>
            <div class="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {#each mcpAudit.slice(0, 5) as record (record.id)}
                <div class="flex items-start justify-between gap-3 bg-surface-2 px-3 py-2">
                  <span>{record.action.replaceAll('-', ' ')}</span>
                  <span class="shrink-0 font-mono text-[10px] text-text-subtle">{new Date(record.timestamp).toLocaleString()}</span>
                </div>
              {/each}
            </div>
          </details>
        {/if}
      </Card>
    </section>

    <!-- Java -->
    <section>
      <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Java</h2>
      <Card class="p-4 space-y-3">
        <div class="space-y-1.5">
          <label class="text-sm text-text-secondary" for="java-path">Java binary path</label>
          <p class="text-[11px] text-text-subtle">
            Override the <code class="font-mono">java</code> binary used by SnpEff. Leave empty to use <code class="font-mono">java</code> from your PATH.
          </p>
          <div class="flex gap-2">
            <input
              id="java-path"
              type="text"
              bind:value={javaPathInput}
              placeholder="/usr/lib/jvm/java-21/bin/java"
              class="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono
                     placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <Button
              variant="secondary"
              size="sm"
              loading={javaSaving}
              disabled={javaPathInput === settingsStore.javaPath && !javaSaving}
              onclick={saveJavaPath}
            >
              {javaSaved ? 'Saved' : 'Save'}
            </Button>
          </div>
          {#if settingsStore.javaPath}
            <p class="text-[11px] text-emerald-600">
              Active: <code class="font-mono" title={fmtPath(settingsStore.javaPath)}>{fmtPath(settingsStore.javaPath)}</code>
            </p>
          {/if}
        </div>
      </Card>
    </section>

  </div>
  </PageContent>
</div>
