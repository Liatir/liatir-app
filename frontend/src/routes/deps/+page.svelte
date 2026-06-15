<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { depsStore, COMMON_TOOLS } from '$lib/stores/deps.svelte';

  onMount(() => {
    if (!depsStore.checked) depsStore.checkAll();
  });
</script>

<div class="flex flex-col h-full">
  <PageHeader title="Dependencies" description="Verify bioinformatics tools installed on this system">
    {#snippet actions()}
      <Button variant="secondary" size="sm" onclick={() => depsStore.checkAll()} loading={depsStore.loading}>
        {depsStore.checked ? 'Re-check' : 'Check all'}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6 space-y-4">

    {#if depsStore.loading}
      <div class="flex flex-col items-center gap-3 py-16">
        <Spinner size={28} />
        <p class="text-sm text-zinc-500">Checking {COMMON_TOOLS.length} tools…</p>
      </div>

    {:else if !depsStore.checked}
      <div class="flex flex-col items-center gap-4 py-16">
        <p class="text-sm text-zinc-400">No check has been run yet.</p>
        <Button variant="primary" onclick={() => depsStore.checkAll()}>Check Dependencies</Button>
      </div>

    {:else}
      <!-- Summary -->
      <div class="grid grid-cols-3 gap-3">
        <Card class="p-4">
          <p class="text-xs text-zinc-500 mb-1">Available</p>
          <p class="text-2xl font-semibold text-emerald-400">{depsStore.availableCount}</p>
          <p class="text-xs text-zinc-600 mt-1">of {depsStore.results.length} tools</p>
        </Card>
        <Card class="p-4">
          <p class="text-xs text-zinc-500 mb-1">Missing</p>
          <p class="text-2xl font-semibold text-red-400">
            {depsStore.results.length - depsStore.availableCount}
          </p>
          <p class="text-xs text-zinc-600 mt-1">not in PATH</p>
        </Card>
        <Card class="p-4">
          <p class="text-xs text-zinc-500 mb-1">Checked</p>
          <p class="text-2xl font-semibold text-zinc-100">{depsStore.results.length}</p>
          <p class="text-xs text-zinc-600 mt-1">total</p>
        </Card>
      </div>

      <!-- Tool list -->
      <Card>
        <div class="divide-y divide-border">
          {#each depsStore.results as dep}
            <div class="flex items-center gap-4 px-4 py-3">
              <div class="w-28 shrink-0">
                <p class="text-sm font-mono font-medium text-zinc-200">{dep.binary}</p>
              </div>

              <Badge variant={dep.available ? 'available' : 'missing'}>
                {dep.available ? 'Available' : 'Missing'}
              </Badge>

              {#if dep.available && dep.version}
                <p class="text-xs font-mono text-zinc-500 flex-1 truncate" data-selectable>
                  {dep.version}
                </p>
              {:else if dep.available && dep.path}
                <p class="text-xs font-mono text-zinc-600 flex-1 truncate" data-selectable>
                  {dep.path}
                </p>
              {:else}
                <p class="text-xs text-zinc-600 flex-1">Not found in PATH</p>
              {/if}
            </div>
          {/each}
        </div>
      </Card>

      <p class="text-xs text-zinc-600 text-center">
        Offlab checks the system PATH. Install missing tools via your package manager (brew, apt, conda, etc.)
      </p>
    {/if}
  </div>
</div>
