<script lang="ts">
  import { onMount } from 'svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { toolRuntimesStore } from '$lib/stores/toolRuntimes.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { fmtBytes } from '$lib/utils';
  import type { LiatirToolRuntimeRecord } from '@liatir/core';

  onMount(() => {
    void toolRuntimesStore.init();
  });

  const toolRuntimes = $derived(toolRuntimesStore.runtimes);
  const toolOperations = $derived(toolRuntimesStore.operations);
  const toolUpdates = $derived(toolRuntimesStore.updates);

  function progressLabel(bytesDownloaded: number, bytesTotal: number | null): string {
    return bytesTotal && bytesTotal > 0
      ? `${fmtBytes(bytesDownloaded)} / ${fmtBytes(bytesTotal)}`
      : fmtBytes(bytesDownloaded);
  }

  async function installToolRuntime(runtime: LiatirToolRuntimeRecord) {
    try {
      const updating = toolUpdates[runtime.id]?.updateAvailable;
      await toolRuntimesStore.install(runtime.id);
      toast.success(updating ? 'Tool Runtime updated' : 'Tool Runtime installed');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Runtime Box installation failed'); }
  }

  async function checkToolUpdate(runtime: LiatirToolRuntimeRecord) {
    const state = await toolRuntimesStore.checkUpdate(runtime.id);
    if (state.error) toast.error(state.error);
    else if (state.updateAvailable) toast.info(`Update ${state.availableVersion ?? ''} is available`);
    else toast.info('This Tool Runtime is up to date');
  }

  async function removeToolRuntime(runtime: LiatirToolRuntimeRecord) {
    const approved = await confirm({
      title: 'Remove Tool Runtime',
      message: `Remove ${runtime.name} from this device? Existing Results are kept.`,
      confirmLabel: 'Remove',
    });
    if (!approved) return;
    try { await toolRuntimesStore.remove(runtime.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Removal failed'); }
  }

  async function rollbackToolRuntime(runtime: LiatirToolRuntimeRecord) {
    try {
      const restored = await toolRuntimesStore.rollback(runtime.id);
      toast.info(restored ? 'Previous Runtime Box restored' : 'No previous Runtime Box is available');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Rollback failed'); }
  }
</script>

<Card>
  <div class="border-b border-border px-4 py-3">
    <p class="text-sm font-semibold text-text">Tool Runtimes</p>
    <p class="mt-1 text-xs text-text-subtle">
      Installable scientific command environments, kept separate from AI Models and their files.
    </p>
  </div>
  {#if toolRuntimes.length === 0}
    <p class="px-4 py-4 text-xs text-text-subtle">No Tool Runtime has passed its component-specific release gate yet.</p>
  {:else}
    <div class="divide-y divide-border">
      {#each toolRuntimes as runtime (runtime.id)}
        {@const operation = toolOperations[runtime.id]}
        {@const update = toolUpdates[runtime.id]}
        <div class="flex items-center gap-3 px-4 py-3" data-testid={`runtime-component-tool-runtime-${runtime.id}`}>
          <span class="h-2 w-2 shrink-0 rounded-full {runtime.status === 'installed' ? 'bg-emerald-500' : runtime.status === 'error' ? 'bg-red-400' : 'bg-border-2'}"></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-text">{runtime.name}</p>
              <span class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">Tool Runtime</span>
            </div>
            <p class="mt-1 text-xs text-text-muted">{runtime.description}</p>
            {#if operation}
              <p class="mt-1 text-xs text-brand">{progressLabel(operation.bytesDownloaded, operation.bytesTotal)}</p>
            {:else if update?.updateAvailable}
              <p class="mt-1 text-xs text-amber-600">Version {update.availableVersion} is available. Nothing has been downloaded.</p>
            {:else if update?.checkedAt}
              <p class="mt-1 text-[10px] text-text-subtle">Up to date · checked by explicit request</p>
            {:else if runtime.error}
              <p class="mt-1 text-xs text-red-500">{runtime.error}</p>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-2">
            {#if operation}
              <Button size="sm" variant="secondary" onclick={() => toolRuntimesStore.cancelInstall(runtime.id)}>Cancel</Button>
            {:else if runtime.status === 'installed'}
              {#if update?.updateAvailable}<Button size="sm" variant="primary" onclick={() => installToolRuntime(runtime)}>Update</Button>{/if}
              <Button size="sm" variant="secondary" loading={update?.checking} onclick={() => checkToolUpdate(runtime)}>Check update</Button>
              <Button size="sm" variant="ghost" onclick={() => rollbackToolRuntime(runtime)}>Rollback</Button>
              <Button size="sm" variant="ghost" onclick={() => removeToolRuntime(runtime)}>Remove</Button>
            {:else}
              <Button size="sm" variant="primary" onclick={() => installToolRuntime(runtime)}>Install</Button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Card>
