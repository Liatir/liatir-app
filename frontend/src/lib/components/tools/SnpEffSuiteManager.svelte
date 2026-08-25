<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { snpEffStore } from '$lib/stores/snpeff.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { notify } from '$lib/utils/notify';

  interface Props {
    showDatabases?: boolean;
    selectedDatabaseId?: string;
    onselect?: (id: string) => void;
  }

  let {
    showDatabases = false,
    selectedDatabaseId = '',
    onselect,
  }: Props = $props();

  const active = $derived(snpEffStore.active);
  const catalog = $derived(snpEffStore.catalog);
  const recommended = $derived(catalog?.releases.find(
    (release) => release.version === catalog?.recommendedVersion,
  ) ?? null);
  const updateAvailable = $derived(Boolean(
    active && recommended
    && (active.version !== recommended.version || active.archiveSha256 !== recommended.archive.sha256)
  ));
  const suiteOperation = $derived(snpEffStore.suiteProgress());
  const databaseEntries = $derived((catalog?.databases ?? []).filter(
    (entry) => entry.suiteVersion === active?.version,
  ));
  const databaseOptions = $derived(databaseEntries.map((entry) => ({
    value: entry.id,
    label: entry.label,
    description: `${entry.species.scientificName} · ${entry.assembly} · ${entry.annotation.provider} ${entry.annotation.release}`,
    meta: snpEffStore.installedDatabaseFor(entry) ? 'Installed' : formatBytes(entry.archive.sizeBytes),
  })));
  const selectedEntry = $derived(databaseEntries.find((entry) => entry.id === selectedDatabaseId) ?? null);
  const installedDatabase = $derived(selectedEntry ? snpEffStore.installedDatabaseFor(selectedEntry) : null);
  const databaseOperation = $derived(selectedEntry ? snpEffStore.databaseProgress(selectedEntry) : null);

  $effect(() => {
    if (!showDatabases || databaseEntries.length === 0) return;
    if (databaseEntries.some((entry) => entry.id === selectedDatabaseId)) return;
    const preferred = databaseEntries.find((entry) => entry.id === 'GRCh38.115') ?? databaseEntries[0];
    selectedDatabaseId = preferred.id;
    onselect?.(preferred.id);
  });

  onMount(async () => {
    try {
      await Promise.all([snpEffStore.init(), executionRuns.init()]);
    } catch (error) {
      await notify('SnpEff catalog unavailable', String(error));
    }
  });

  function formatBytes(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function selectDatabase(value: string) {
    selectedDatabaseId = value;
    onselect?.(value);
  }

  async function installSuite() {
    try {
      const result = await snpEffStore.installSuite();
      await notify(
        result.reused ? 'SnpEff + SnpSift reused' : 'SnpEff + SnpSift ready',
        result.reused
          ? 'The verified local copy was reused.'
          : `Version ${result.active.version} was downloaded and verified.`,
      );
    } catch (error) {
      await notify('Suite installation failed', String(error));
    }
  }

  async function removeSuite() {
    const accepted = await confirm({
      title: 'Remove SnpEff + SnpSift',
      message: 'Remove the managed SnpEff and SnpSift programs from this computer? Verified genome databases are kept for reuse.',
      confirmLabel: 'Remove',
    });
    if (!accepted) return;
    try {
      await snpEffStore.removeSuite();
      await notify('Suite removed', 'SnpEff and SnpSift were removed.');
    } catch (error) {
      await notify('Removal failed', String(error));
    }
  }

  async function installDatabase() {
    if (!selectedEntry) return;
    try {
      const result = await snpEffStore.installDatabase(selectedEntry);
      await notify(
        result.reused ? 'Database reused' : 'Database ready',
        result.reused ? 'The verified local copy was reused.' : `${selectedEntry.label} is ready.`,
      );
    } catch (error) {
      await notify('Database installation failed', String(error));
    }
  }

  async function removeDatabase() {
    if (!selectedEntry || !installedDatabase) return;
    const accepted = await confirm({
      title: 'Remove genome database',
      message: `Remove "${selectedEntry.label}" from this computer? It can be downloaded again later.`,
      confirmLabel: 'Remove',
    });
    if (!accepted) return;
    try {
      await snpEffStore.removeDatabase(installedDatabase);
      await notify('Database removed', `${selectedEntry.label} was removed.`);
    } catch (error) {
      await notify('Removal failed', String(error));
    }
  }
</script>

<Card class="p-5 space-y-4" testId="snpeff-suite-manager">
  <div>
    <h2 class="text-sm font-semibold text-text">SnpEff + SnpSift suite</h2>
    <p class="mt-1 text-xs text-text-secondary leading-relaxed">
      Liatir downloads both programs together once, verifies the exact files, and reuses them.
      Java remains the only system requirement.
    </p>
  </div>

  {#if snpEffStore.loading && !catalog}
    <p class="text-xs text-text-subtle">Checking the verified suite catalog…</p>
  {:else if snpEffStore.error && !catalog}
    <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" data-testid="snpeff-suite-error">
      {snpEffStore.error}
    </div>
  {:else if suiteOperation.status === 'downloading' || suiteOperation.status === 'installing'}
    <div class="space-y-2" data-testid="snpeff-suite-progress">
      <div class="flex justify-between text-[11px] text-text-subtle">
        <span>{suiteOperation.status === 'installing' ? 'Verifying and installing…' : 'Downloading…'}</span>
        {#if suiteOperation.bytesTotal}
          <span>{Math.round(suiteOperation.bytesDownloaded / suiteOperation.bytesTotal * 100)}%</span>
        {/if}
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-brand transition-all"
          style={`width: ${suiteOperation.bytesTotal ? Math.min(100, suiteOperation.bytesDownloaded / suiteOperation.bytesTotal * 100) : 8}%`}
        ></div>
      </div>
      <Button variant="secondary" size="sm" testId="snpeff-suite-cancel" onclick={snpEffStore.cancelSuiteInstall}>Cancel</Button>
    </div>
  {:else if active}
    <div class="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
      <span class="text-xs font-medium text-text" data-testid="snpeff-suite-installed">
        Version {active.version} installed and verified
      </span>
      <span class="text-[10px] text-text-subtle font-mono">{active.archiveSha256.slice(0, 12)}…</span>
      {#if updateAvailable}
        <Button variant="primary" size="sm" testId="snpeff-suite-update" onclick={installSuite}>Update to {recommended!.version}</Button>
      {/if}
      <Button variant="secondary" size="sm" testId="snpeff-suite-remove" onclick={removeSuite}>Remove</Button>
    </div>
  {:else}
    {#if suiteOperation.status === 'error'}
      <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {suiteOperation.error}
      </div>
    {/if}
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="primary" testId="snpeff-suite-install" onclick={installSuite}>Download and verify</Button>
      {#if recommended}
        <span class="text-[11px] text-text-subtle">Version {recommended.version} · {formatBytes(recommended.archive.sizeBytes)} · MIT</span>
      {/if}
    </div>
  {/if}

  {#if showDatabases && active}
    <div class="border-t border-border pt-4 space-y-3" data-testid="snpeff-database-manager">
      <div>
        <h3 class="text-xs font-semibold text-text">Genome database</h3>
        <p class="mt-1 text-[11px] text-text-secondary leading-relaxed">
          The species, genome assembly and annotation release are recorded with every run.
        </p>
      </div>
      <Select
        id="snpeff-database"
        value={selectedDatabaseId}
        options={databaseOptions}
        searchable
        placeholder="Choose a species and release"
        emptyText="No compatible databases are available."
        onchange={selectDatabase}
      />

      {#if selectedEntry}
        <div class="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[11px] text-text-secondary leading-relaxed" data-testid="snpeff-database-identity">
          <span class="font-medium text-text">{selectedEntry.species.commonName} ({selectedEntry.assembly})</span>
          · {selectedEntry.species.scientificName}
          · {selectedEntry.annotation.provider} {selectedEntry.annotation.release}
          · {formatBytes(selectedEntry.archive.sizeBytes)}
        </div>

        {#if databaseOperation?.status === 'downloading' || databaseOperation?.status === 'installing'}
          <div class="space-y-1.5" data-testid="snpeff-database-progress">
            <div class="flex justify-between text-[11px] text-text-subtle">
              <span>{databaseOperation.status === 'installing' ? 'Verifying and installing…' : 'Downloading…'}</span>
              {#if databaseOperation.bytesTotal}
                <span>{Math.round(databaseOperation.bytesDownloaded / databaseOperation.bytesTotal * 100)}%</span>
              {/if}
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                class="h-full rounded-full bg-brand transition-all"
                style={`width: ${databaseOperation.bytesTotal ? Math.min(100, databaseOperation.bytesDownloaded / databaseOperation.bytesTotal * 100) : 8}%`}
              ></div>
            </div>
          </div>
        {:else if databaseOperation?.status === 'error'}
          <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {databaseOperation.error}
          </div>
        {/if}

        <div class="flex items-center gap-2">
          {#if installedDatabase}
            <Button variant="secondary" size="sm" testId="snpeff-database-remove" onclick={removeDatabase}>Remove</Button>
            <span class="text-[11px] text-emerald-700" data-testid="snpeff-database-installed">Installed and verified</span>
          {:else if databaseOperation?.status === 'downloading' || databaseOperation?.status === 'installing'}
            <Button variant="secondary" size="sm" testId="snpeff-database-cancel" onclick={() => snpEffStore.cancelDatabaseInstall(selectedEntry)}>Cancel</Button>
          {:else}
            <Button variant="primary" size="sm" testId="snpeff-database-install" onclick={installDatabase}>Download and verify</Button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</Card>
