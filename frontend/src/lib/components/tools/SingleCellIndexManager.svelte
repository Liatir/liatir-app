<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { singleCellIndexes } from '$lib/stores/singleCellIndexes.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { notify } from '$lib/utils/notify';

  interface Props {
    onuse?: (manifestPath: string) => void;
  }

  let { onuse }: Props = $props();
  let selectedIdentity = $state('');

  const options = $derived(singleCellIndexes.catalog.map((entry) => ({
    value: `${entry.id}@${entry.version}`,
    label: entry.label,
    description: `${entry.species.scientificName} · ${entry.genome.assembly} · ${entry.annotation.provider} ${entry.annotation.release} · ${entry.readLength} bp`,
    meta: singleCellIndexes.installedFor(entry) ? 'Installed' : formatBytes(entry.archive.sizeBytes),
  })));
  const selected = $derived(singleCellIndexes.catalog.find(
    (entry) => `${entry.id}@${entry.version}` === selectedIdentity,
  ) ?? null);
  const installed = $derived(selected ? singleCellIndexes.installedFor(selected) : undefined);
  const operation = $derived(selected ? singleCellIndexes.progressFor(selected) : null);
  const inUse = $derived(Boolean(installed && executionRuns.active.some(
    (run) => valueContainsPath(run.inputs, installed.manifestPath),
  )));

  onMount(async () => {
    await Promise.all([singleCellIndexes.refresh(), executionRuns.init()]);
    if (!selectedIdentity && singleCellIndexes.catalog.length > 0) {
      selectedIdentity = `${singleCellIndexes.catalog[0].id}@${singleCellIndexes.catalog[0].version}`;
    }
  });

  function formatBytes(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function valueContainsPath(value: unknown, path: string): boolean {
    if (value === path) return true;
    if (Array.isArray(value)) return value.some((item) => valueContainsPath(item, path));
    if (value && typeof value === 'object') {
      return Object.values(value).some((item) => valueContainsPath(item, path));
    }
    return false;
  }

  async function installSelected() {
    if (!selected) return;
    try {
      const result = await singleCellIndexes.install(selected);
      await notify(
        result.reused ? 'Reference index reused' : 'Reference index ready',
        result.reused ? 'The verified local copy was reused.' : `${selected.label} is ready to use.`,
      );
      onuse?.(result.installed.manifestPath);
    } catch (error) {
      await notify('Reference index failed', String(error));
    }
  }

  async function removeSelected() {
    if (!selected || !installed) return;
    if (inUse) {
      await notify('Reference index is in use', 'Wait for the analysis using this index to finish.');
      return;
    }
    const accepted = await confirm({
      title: 'Remove reference index',
      message: `Remove "${selected.label}" from this computer? It can be downloaded again later.`,
      confirmLabel: 'Remove',
    });
    if (!accepted) return;
    try {
      await singleCellIndexes.remove(installed);
      await notify('Reference index removed', `${selected.label} was removed.`);
    } catch (error) {
      await notify('Removal failed', String(error));
    }
  }
</script>

<Card class="p-5 space-y-4" testId="single-cell-index-manager">
  <div>
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-text">Ready-made reference</h2>
      {#if singleCellIndexes.catalogSource === 'cache'}
        <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">Offline copy</span>
      {/if}
    </div>
    <p class="mt-1 text-xs text-text-secondary leading-relaxed">
      Choose the species and annotation release. Liatir downloads this index once, verifies every
      file, and reuses it for later samples.
    </p>
  </div>

  {#if singleCellIndexes.loading}
    <p class="text-xs text-text-subtle">Loading verified index catalog…</p>
  {:else if singleCellIndexes.catalogError && options.length === 0}
    <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="single-cell-index-catalog-error">
      {singleCellIndexes.catalogError}
    </div>
  {:else}
    <div>
      <label for="published-single-cell-index" class="block text-xs font-medium text-text-secondary mb-1.5">Reference</label>
      <Select
        id="published-single-cell-index"
        value={selectedIdentity}
        {options}
        searchable
        placeholder="Choose a species and release"
        emptyText="No published indexes are available."
        onchange={(value) => selectedIdentity = value}
      />
    </div>

    {#if selected}
      <div class="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[11px] text-text-secondary leading-relaxed" data-testid="single-cell-index-scientific-identity">
        <span class="font-medium text-text">{selected.species.commonName} ({selected.genome.assembly})</span>
        · {selected.annotation.provider} {selected.annotation.release}
        · exons + introns
        · R2 {selected.readLength} bases
        · {formatBytes(selected.archive.sizeBytes)}
      </div>

      {#if operation?.status === 'downloading' || operation?.status === 'installing'}
        <div class="space-y-1.5" data-testid="single-cell-index-progress">
          <div class="flex justify-between text-[11px] text-text-subtle">
            <span>{operation.status === 'installing' ? 'Verifying and installing…' : 'Downloading…'}</span>
            {#if operation.bytesTotal}
              <span>{Math.round(operation.bytesDownloaded / operation.bytesTotal * 100)}%</span>
            {/if}
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              class="h-full rounded-full bg-brand transition-all"
              style={`width: ${operation.bytesTotal ? Math.min(100, operation.bytesDownloaded / operation.bytesTotal * 100) : 8}%`}
            ></div>
          </div>
        </div>
      {:else if operation?.status === 'error'}
        <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="single-cell-index-error">
          {operation.error}
        </div>
      {/if}

      <div class="flex items-center gap-2">
        {#if installed}
          {#if onuse}
            <Button variant="primary" testId="single-cell-index-use" onclick={() => onuse?.(installed.manifestPath)}>Use this index</Button>
          {/if}
          <Button variant="secondary" testId="single-cell-index-remove" disabled={inUse} onclick={removeSelected}>Remove</Button>
          <span class="text-[11px] {inUse ? 'text-amber-700' : 'text-emerald-700'}" data-testid="single-cell-index-installed">
            {inUse ? 'In use by a running analysis' : 'Installed and verified'}
          </span>
        {:else if operation?.status === 'downloading' || operation?.status === 'installing'}
          <Button variant="secondary" testId="single-cell-index-cancel" onclick={() => singleCellIndexes.cancel(selected)}>Cancel</Button>
        {:else}
          <Button variant="primary" testId="single-cell-index-install" onclick={installSelected}>Download and verify</Button>
        {/if}
      </div>
    {/if}
  {/if}
</Card>
