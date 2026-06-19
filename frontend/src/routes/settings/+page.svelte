<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { liatir } from '$lib/api';
  import { settingsStore } from '$lib/stores/settings.svelte';

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
      const info = await api.desktop.app.getInfo();
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

  function fmtPath(p: string | null | undefined) {
    return p ?? '—';
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Settings" description="Application configuration" />

  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    <!-- About -->
    <section>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">About</h2>
      <Card class="divide-y divide-border">
        {#each [
          { label: 'Application', value: 'Liatir' },
          { label: 'App Version', value: appVersion ?? '—' },
          { label: 'API Version', value: apiVersion ?? '—' },
        ] as row}
          <div class="flex items-center justify-between px-4 py-3">
            <span class="text-sm text-zinc-600">{row.label}</span>
            <span class="text-sm font-mono text-zinc-800" data-selectable>{row.value}</span>
          </div>
        {/each}
      </Card>
    </section>

    <!-- Java -->
    <section>
      <h2 class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Java</h2>
      <Card class="p-4 space-y-3">
        <div class="space-y-1.5">
          <label class="text-sm text-zinc-600" for="java-path">Java binary path</label>
          <p class="text-[11px] text-zinc-400">
            Override the <code class="font-mono">java</code> binary used by SnpEff. Leave empty to use <code class="font-mono">java</code> from your PATH.
          </p>
          <div class="flex gap-2">
            <input
              id="java-path"
              type="text"
              bind:value={javaPathInput}
              placeholder="/usr/lib/jvm/java-21/bin/java"
              class="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono
                     placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
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
              Active: <code class="font-mono">{settingsStore.javaPath}</code>
            </p>
          {/if}
        </div>
      </Card>
    </section>

  </div>
</div>
