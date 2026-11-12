<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import QuentaModeSwitch from '$lib/components/quenta/QuentaModeSwitch.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
  import { FIELD_INPUT_CLASS } from '$lib/components/ui/field-styles';
  import { analysisRuns } from '$lib/stores/analysisRuns.svelte';
  import { executionRuns } from '$lib/stores/executionRuns.svelte';
  import { quentaStore } from '$lib/stores/quenta.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { toast } from '$lib/stores/toast.svelte';

  const PRESENTATION_TOOL = 'quenta-presentation';

  let selected = $state<string[]>([]);
  let loaded = $state(false);
  let instruction = $state('');
  // The workspace a generation started in; its result is saved there even after a switch.
  let generatingWorkspace = $state<string | null>(null);

  const busy = $derived(generatingWorkspace !== null && generatingWorkspace === workspaceStore.activeId);
  const results = $derived(analysisRuns.runs.filter((run) => run.status === 'done' && run.tool !== PRESENTATION_TOOL));
  const presentations = $derived(analysisRuns.runs.filter((run) => run.tool === PRESENTATION_TOOL));
  const active = $derived(executionRuns.active.filter((run) => run.identity.entityId === PRESENTATION_TOOL));
  const hasModel = $derived(!!quentaStore.config.model);

  onMount(async () => {
    try {
      await Promise.all([analysisRuns.init(), executionRuns.init(), quentaStore.init()]);
      loaded = true;
    } catch (error) {
      toast.error(String(error));
    }
  });

  // A link such as "Create presentation" on a Result preselects it. Follow the link even when this page
  // is already open, but not later changes to the Results list, which would undo the user's own choice.
  $effect(() => {
    const requested = page.url.searchParams.getAll('result');
    if (!loaded) return;
    untrack(() => { selected = requested.filter((id) => results.some((run) => run.id === id)); });
  });

  async function generate() {
    const workspace = workspaceStore.activeId;
    generatingWorkspace = workspace;
    try {
      const { generatePresentation } = await import('$lib/quenta/presentations');
      const id = await generatePresentation([...selected], instruction, { ...quentaStore.config });
      if (workspaceStore.activeId === workspace) await goto(`/results?run=${id}`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      if (generatingWorkspace === workspace) generatingWorkspace = null;
    }
  }
</script>

<div class="flex h-full flex-col">
  <PageHeader
    title="Quenta presentations"
    description="An interactive page written by Quenta, about your Results or any topic"
    info="Quenta writes an interactive page: about the Results you tick, using a copy of their data, or about any topic you describe. The page runs inside Liatir without internet, external resources, or access to your files and app commands. It is saved as a new Result; the original Results are not changed."
  >
    {#snippet actions()}
      <QuentaModeSwitch active="presentations" />
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">
    <div class="mx-auto max-w-3xl space-y-4">
      {#if !hasModel}
        <Card class="flex items-center justify-between gap-3 p-4">
          <p class="text-sm text-text-secondary">Quenta needs a local model before it can write a presentation.</p>
          <Button variant="secondary" size="sm" onclick={() => goto('/quenta')}>Choose a model</Button>
        </Card>
      {/if}

      <Card class="space-y-3 p-4">
        <LabelWithInfo text="Results to present (optional)" info="Tick Results to build the page on their real data. Only completed Results of this workspace are listed; choose a few, as Quenta can read a limited amount of data at once. Leave them all unticked for a page about any topic you describe below." />
        {#each results as result (result.id)}
          <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-surface-2/60
            {selected.includes(result.id) ? 'border-brand bg-brand/5' : ''}">
            <input type="checkbox" bind:group={selected} value={result.id} disabled={busy} />
            <span class="min-w-0">
              <span class="block truncate text-sm text-text">{result.label}</span>
              <span class="block text-[11px] text-text-subtle">{new Date(result.endedAt).toLocaleString()}</span>
            </span>
          </label>
        {:else}
          <EmptyState title="No completed Results yet" description="You can still create a page about any topic: describe it below." />
        {/each}
      </Card>

      <Card class="space-y-2 p-4">
        <LabelWithInfo text="What should the page show?" info="Describe the page in your own words. With Results ticked, say how to show them, e.g. compare the scores. With none, say what the page is about, e.g. how molecular docking works, explained simply with a diagram. Without Results, Quenta explains from general knowledge and marks any numbers as examples." />
        <textarea class="{FIELD_INPUT_CLASS} h-24" bind:value={instruction} placeholder={selected.length ? 'e.g. compare these results and explain their limitations' : 'e.g. explain how molecular docking works, simply, with a diagram'} disabled={busy}></textarea>
        <p class="text-[11px] text-text-muted">The interpretation is AI-generated. Check its figures against the original Results.</p>
      </Card>

      <div class="flex items-center gap-3">
        <Button variant="primary" loading={busy} disabled={busy || (!selected.length && !instruction.trim()) || !hasModel} onclick={generate}>Create presentation</Button>
        {#each active as run (run.identity.runId)}
          <Button variant="ghost" size="sm" onclick={() => executionRuns.cancel(run.identity.runId)}>Cancel</Button>
        {/each}
      </div>

      {#if presentations.length}
        <Card class="p-4">
          <p class="mb-2 text-sm font-medium text-text">Saved presentations</p>
          <div class="divide-y divide-border">
            {#each presentations as result (result.id)}
              <button type="button" class="flex w-full items-center justify-between gap-3 py-2 text-left text-sm text-text-secondary hover:text-text" onclick={() => goto(`/results?run=${result.id}`)}>
                <span class="truncate">{result.label}</span>
                <span class="shrink-0 text-[11px] text-text-subtle">{result.status} · {new Date(result.endedAt).toLocaleString()}</span>
              </button>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  </div>
</div>
