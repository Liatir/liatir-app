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

  let apiVersion = $state<string | null>(null);
  let appVersion = $state<string | null>(null);
  let updateState = $state<'idle' | 'checking' | 'available' | 'up-to-date' | 'installing' | 'ready' | 'error'>('idle');
  let availableUpdate = $state<AppUpdateCheckResult | null>(null);
  let updateMessage = $state<string | null>(null);
  let updateProgress = $state<number | null>(null);

  let javaPathInput = $state('');
  let javaSaving = $state(false);
  let javaSaved = $state(false);

  onMount(() => {
    let disposed = false;
    let stopUpdateEvents: (() => void) | undefined;

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
