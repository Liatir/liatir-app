<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { liatir } from '$lib/api';
  import { managedBins } from '$lib/stores/managedBins.svelte';
  import { versionGte, versionLt } from '$lib/utils/versions';
  import type { DepRequirement } from '$lib/data/dep-requirements';

  export type DepStatus = 'checking' | 'ok' | 'outdated' | 'missing';

  let {
    req,
    onStatusChange,
  }: {
    req: DepRequirement;
    onStatusChange?: (s: DepStatus) => void;
  } = $props();

  let status    = $state<DepStatus>('checking');
  let installed = $state<string | null>(null);

  $effect(() => { onStatusChange?.(status); });

  async function check() {
    status = 'checking';
    installed = null;
    const api = liatir();
    if (!api) return;
    await managedBins.init();
    const managed = managedBins.get(req.binary);
    const r = await api.deps.check(req.binary);
    if (!r.available && managed) {
      installed = `${managed.version} managed`;
      status = 'ok';
    } else if (!r.available) {
      status = 'missing';
    } else {
      installed = r.version ?? null;
      if (!installed) {
        status = 'ok'; // installed but version undetectable — assume ok
      } else {
        status = versionGte(installed, req.minVersion) && (!req.maxVersionExclusive || versionLt(installed, req.maxVersionExclusive))
          ? 'ok'
          : 'outdated';
      }
    }
  }

  async function openReleases() {
    const api = liatir();
    if (api) await api.openBrowser(req.releasesUrl);
  }

  async function openUrl(url: string) {
    const api = liatir();
    if (api) await api.openBrowser(url);
  }

  onMount(check);

  const statusColor = $derived(
    status === 'ok'       ? 'text-emerald-600' :
    status === 'outdated' ? 'text-amber-600' :
    status === 'missing'  ? 'text-red-600' : 'text-zinc-400'
  );

  const requirementLabel = $derived(
    req.versionLabel ?? (req.maxVersionExclusive ? `${req.minVersion} - <${req.maxVersionExclusive}` : `${req.minVersion}+`)
  );
</script>

<div class="rounded-xl border border-border bg-surface p-4 space-y-3">

  <!-- Header row -->
  <div class="flex items-center gap-3">
    <!-- Icon -->
    <div class="h-7 w-7 rounded-lg flex items-center justify-center shrink-0
      {status === 'ok'       ? 'bg-emerald-100' :
       status === 'outdated' ? 'bg-amber-100' :
       status === 'missing'  ? 'bg-red-100' : 'bg-zinc-100'}">
      {#if status === 'checking'}
        <svg class="animate-spin h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      {:else if status === 'ok'}
        <svg class="h-3.5 w-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      {:else if status === 'outdated'}
        <svg class="h-3.5 w-3.5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      {:else}
        <svg class="h-3.5 w-3.5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      {/if}
    </div>

    <!-- Name + version -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm font-semibold text-zinc-800">{req.label}</span>
        {#if status === 'checking'}
          <span class="text-xs text-zinc-400">Checking…</span>
        {:else if status === 'ok'}
          <span class="font-mono text-xs text-emerald-600">{installed}</span>
          <span class="text-[10px] text-zinc-400">(requires {requirementLabel})</span>
        {:else if status === 'outdated'}
          <span class="font-mono text-xs text-amber-600">{installed}</span>
          <span class="text-[10px] text-zinc-400">(requires {requirementLabel})</span>
        {:else}
          <span class="text-xs text-zinc-400">Not installed</span>
          <span class="text-[10px] text-zinc-400">(requires {requirementLabel})</span>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-1.5 shrink-0">
      <button
        onclick={check}
        class="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors px-2 py-1 rounded hover:bg-zinc-100"
        title="Re-check"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
      {#if status !== 'missing'}
        <button
          onclick={openReleases}
          class="text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors px-2 py-1 rounded hover:bg-zinc-100 flex items-center gap-1"
          title="Check for updates"
        >
          Updates
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>

  <!-- Outdated or missing: install/upgrade instructions -->
  {#if status === 'outdated' || status === 'missing'}
    <div class="rounded-lg border border-border bg-surface-2 p-3 space-y-1.5">
      <p class="text-[11px] text-zinc-500 mb-2">
        {status === 'outdated' ? `Update ${req.label} to ${requirementLabel}:` : `Install ${req.label}:`}
      </p>
      {#each req.installCmds as { platform, cmd }}
        <div class="flex items-center gap-2 font-mono text-xs">
          <span class="text-zinc-400 w-14 shrink-0 font-sans text-[11px]">{platform}</span>
          <code class="bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded select-all">{cmd}</code>
        </div>
      {/each}
      {#if req.downloadOptions}
        <div class="pt-2 border-t border-border mt-2">
          <p class="text-[11px] text-zinc-500 mb-1.5">Download installer:</p>
          <div class="flex flex-wrap gap-1.5">
            {#each req.downloadOptions as opt}
              <button
                onclick={() => openUrl(opt.url)}
                class="flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs transition-colors
                  {opt.recommended
                    ? 'border-brand/40 bg-brand/5 text-brand hover:bg-brand/10'
                    : 'border-border bg-surface text-zinc-600 hover:border-zinc-300'}"
              >
                {opt.label}
                {#if opt.recommended}
                  <span class="text-[9px] font-medium uppercase tracking-wide opacity-70">recommended</span>
                {/if}
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </button>
            {/each}
          </div>
        </div>
      {/if}
      <p class="text-[11px] text-zinc-400 mt-2 font-sans">Restart Liatir after installing.</p>
      <div class="pt-1.5">
        <button
          onclick={() => goto(`/deps?focus=${encodeURIComponent(req.binary)}`)}
          class="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          Manage all dependencies
        </button>
      </div>
    </div>
  {/if}

</div>
