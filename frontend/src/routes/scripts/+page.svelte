<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import type { LiatirPythonScript } from '@liatir/core';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import { pythonScripts } from '$lib/stores/python-scripts.svelte';
  import { savedScripts } from '$lib/stores/savedScripts.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  const ALL_FOLDERS = '\u0000all';

  let query = $state('');
  let folder = $state(ALL_FOLDERS);
  let archiveOpen = $state(false);

  onMount(() => {
    void Promise.all([pythonScripts.init(), savedScripts.init()])
      .catch((error) => toast.error(`Could not load scripts: ${String(error)}`));
  });

  const folders = $derived([...new Set(pythonScripts.scripts.map((script) => script.folder).filter(Boolean))].sort());
  const folderOptions = $derived([
    { value: ALL_FOLDERS, label: 'All folders' },
    ...folders.map((name) => ({ value: name, label: name })),
  ]);
  const visible = $derived(pythonScripts.scripts.filter((script) =>
    (folder === ALL_FOLDERS || script.folder === folder)
    && script.name.toLowerCase().includes(query.trim().toLowerCase())));
  const destinations = $derived(workspaceStore.workspaces
    .filter((workspace) => workspace.id !== workspaceStore.activeId)
    .map((workspace) => ({ value: workspace.id, label: workspace.name })));

  function fieldCount(schema: Record<string, unknown>): string {
    const count = Object.keys(schema).length;
    return `${count} ${count === 1 ? 'field' : 'fields'}`;
  }

  async function copy(script: LiatirPythonScript, workspaceId: string) {
    const name = workspaceStore.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? 'the other workspace';
    try {
      await pythonScripts.copyTo(script.id, workspaceId);
      toast.success(`"${script.name}" was copied to ${name}. The copy can be edited on its own.`);
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function remove(script: LiatirPythonScript) {
    const ok = await confirm({
      title: 'Delete script',
      message: `Delete "${script.name}"? Results it already produced are kept.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try { await pythonScripts.remove(script.id); } catch (error) { toast.error(String(error)); }
  }
</script>

<div class="flex h-full flex-col">
  <PageHeader
    title="Scripts"
    description="Python scripts of this workspace, runnable on their own or as pipeline steps"
    info="A script is a small Python program that you write. You decide what information it receives (inputs) and what results it gives back (outputs), and Liatir checks both every time it runs. Run a script on its own or add it as a step to a pipeline. Scripts belong to this workspace; Copy to workspace makes a separate copy for another project."
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" testId="scripts-new" onclick={() => goto('/code')}>New script</Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 space-y-4 overflow-y-auto p-6">
    {#if pythonScripts.scripts.length === 0}
      <Card>
        <EmptyState
          title="No Python scripts yet"
          description="Write a script with its inputs and outputs, run it here, then add it to any pipeline of this workspace."
        >
          {#snippet icon()}<Icon icon="lucide:file-code" width="28" height="28" />{/snippet}
          {#snippet action()}<Button variant="secondary" size="sm" onclick={() => goto('/code')}>Write a script</Button>{/snippet}
        </EmptyState>
      </Card>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex min-w-60 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <Icon icon="lucide:search" width="14" height="14" class="shrink-0 text-text-subtle" />
          <input bind:value={query} placeholder="Search scripts…" class="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle" />
        </div>
        {#if folders.length > 0}
          <Select value={folder} options={folderOptions} onchange={(value) => folder = value} />
        {/if}
      </div>

      {#if visible.length === 0}
        <p class="py-10 text-center text-sm text-text-muted">No scripts match this search.</p>
      {:else}
        <Card>
          <div class="divide-y divide-border">
            {#each visible as script (script.id)}
              <div class="flex items-center gap-4 px-4 py-3" data-testid="script-row">
                <button type="button" class="min-w-0 flex-1 text-left" onclick={() => goto(`/code?script=${script.id}`)}>
                  <p class="truncate text-sm font-medium text-text">{script.name}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-text-subtle">
                    {#if script.folder}<Badge hideDot size="xs">{script.folder}</Badge>{/if}
                    <span>Inputs: {fieldCount(script.inputSchema)}</span>
                    <span>·</span>
                    <span>Outputs: {fieldCount(script.outputSchema)}</span>
                    <span>·</span>
                    <span>Saved {new Date(script.savedAt).toLocaleString()}</span>
                  </div>
                </button>
                <Button variant="secondary" size="sm" onclick={() => goto(`/code?script=${script.id}`)}>Open</Button>
                {#if destinations.length > 0}
                  <Select value="" options={destinations} placeholder="Copy to workspace…" onchange={(id) => copy(script, id)} />
                {/if}
                <button
                  type="button"
                  class="text-text-faint transition-colors hover:text-red-500"
                  aria-label="Delete {script.name}"
                  onclick={() => remove(script)}
                >
                  <Icon icon="lucide:trash-2" width="15" height="15" />
                </button>
              </div>
            {/each}
          </div>
        </Card>
      {/if}
    {/if}

    {#if savedScripts.scripts.length > 0}
      <Card>
        <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onclick={() => archiveOpen = !archiveOpen}>
          <div>
            <p class="text-sm font-medium text-text">Older JavaScript scripts ({savedScripts.scripts.length})</p>
            <p class="mt-0.5 text-xs text-text-muted">Written for an earlier version of Liatir. They no longer run, but you can read and export them.</p>
          </div>
          <Icon icon={archiveOpen ? 'lucide:chevron-up' : 'lucide:chevron-down'} width="16" height="16" class="shrink-0 text-text-subtle" />
        </button>
        {#if archiveOpen}
          <div class="divide-y divide-border border-t border-border">
            {#each savedScripts.scripts as script (script.id)}
              <details class="px-4 py-3">
                <summary class="flex cursor-pointer items-center justify-between gap-3 text-sm text-text-secondary">
                  <span class="truncate">{script.folder ? `${script.folder} / ` : ''}{script.name}</span>
                  <Button variant="ghost" size="sm" onclick={(event) => { event.preventDefault(); void savedScripts.exportScript(script.id); }}>Export</Button>
                </summary>
                <pre class="mt-3 max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-text-secondary">{script.code}</pre>
              </details>
            {/each}
          </div>
        {/if}
      </Card>
    {/if}
  </div>
</div>
