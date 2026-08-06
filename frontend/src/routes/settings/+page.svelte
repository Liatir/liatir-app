<script lang="ts">
  import { onMount } from 'svelte';
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

  let javaPathInput = $state('');
  let javaSaving = $state(false);
  let javaSaved = $state(false);

  onMount(async () => {
    const api = liatir();
    if (!api) return;
    apiVersion = api.apiVersion ?? null;
    try {
      const info = await api.desktop.app.info();
      appVersion = info?.version ?? null;
    } catch {}
    await settingsStore.init();
    javaPathInput = settingsStore.javaPath;
  });

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
