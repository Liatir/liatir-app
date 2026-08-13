<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icon from '@iconify/svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import PageContent from '$lib/components/layout/PageContent.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import { externalWorkflowsStore } from '$lib/stores/externalWorkflows.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
  import { liatir } from '$lib/api';
  import type { ExternalWorkflowRuntimeInfo } from '../../../../../src-ts/modules/rs/externalWorkflows/_types';

  let nextflowReady = $state<boolean | null>(null);
  let javaReady = $state<boolean | null>(null);
  let runtime = $state<ExternalWorkflowRuntimeInfo | null>(null);

  onMount(async () => {
    await externalWorkflowsStore.init();
    const api = liatir();
    if (!api) return;
    try {
      runtime = await api.externalWorkflows.runtimeInfo();
      nextflowReady = runtime.nextflow.available;
      javaReady = runtime.java.available;
    } catch {
      nextflowReady = false;
      javaReady = false;
    }
  });

  async function removeDefinition(id: string, name: string) {
    const accepted = await confirm({
      title: 'Delete External Workflow',
      message: `Delete “${name}”? Existing pipeline nodes that reference it will need another saved definition. Past Results are kept.`,
      confirmLabel: 'Delete',
    });
    if (accepted) await externalWorkflowsStore.remove(id);
  }

  function sourceLabel(kind: 'local' | 'repository'): string {
    return kind === 'local' ? 'Local snapshot' : 'Pinned repository';
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title="External Workflows"
    description="Run saved scientific workflows directly or reuse them as pipeline nodes"
  >
    {#snippet actions()}
      <Button variant="primary" size="sm" testId="new-external-workflow" onclick={() => goto('/tools/external-workflows/new')}>
        <Icon icon="lucide:plus" width="14" height="14" /> New workflow
      </Button>
    {/snippet}
  </PageHeader>

  <PageContent>
    <div class="flex-1 overflow-y-auto p-6 space-y-5">
      <Card class="p-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-semibold text-text">Nextflow adapter</p>
            <p class="mt-1 text-xs leading-relaxed text-text-muted max-w-2xl">
              Liatir uses Nextflow and Java from the supported local backend{runtime?.backend === 'wsl2' ? `: WSL2 (${runtime.distribution ?? 'default distribution'})` : ''}. Each run stages its own inputs and
              exposes only the exact outputs declared in the saved definition.
            </p>
          </div>
          <div class="flex gap-2 shrink-0">
            <Badge variant={nextflowReady === true ? 'available' : nextflowReady === false ? 'failed' : 'neutral'}>
              Nextflow {nextflowReady === true ? 'ready' : nextflowReady === false ? 'missing' : 'checking'}
            </Badge>
            <Badge variant={javaReady === true ? 'available' : javaReady === false ? 'failed' : 'neutral'}>
              Java {javaReady === true ? 'ready' : javaReady === false ? 'missing' : 'checking'}
            </Badge>
          </div>
        </div>
      </Card>

      {#if externalWorkflowsStore.definitions.length === 0}
        <div class="rounded-xl border border-dashed border-border py-16 text-center" data-testid="external-workflow-empty">
          <div class="mx-auto mb-3 h-11 w-11 rounded-xl bg-surface-2 flex items-center justify-center text-text-subtle">
            <Icon icon="lucide:workflow" width="22" height="22" />
          </div>
          <p class="text-sm font-medium text-text-secondary">No External Workflows yet</p>
          <p class="mt-1 text-xs text-text-subtle">Save a local Nextflow script or a version-pinned repository.</p>
          <Button class="mt-4" variant="primary" size="sm" onclick={() => goto('/tools/external-workflows/new')}>
            Create the first workflow
          </Button>
        </div>
      {:else}
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {#each externalWorkflowsStore.definitions as definition (definition.id)}
            <Card class="p-4" testId="external-workflow-card">
              <div class="flex items-start gap-3">
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left"
                  onclick={() => goto(`/tools/external-workflows/${definition.id}`)}
                >
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-semibold text-text truncate">{definition.name}</p>
                    <Badge variant="available">Nextflow</Badge>
                  </div>
                  <p class="mt-1 text-xs text-text-muted line-clamp-2">
                    {definition.description || 'Saved External Workflow'}
                  </p>
                  <div class="mt-3 flex flex-wrap gap-1.5 text-[10px] text-text-subtle">
                    <span class="rounded border border-border bg-surface-2 px-2 py-0.5">{sourceLabel(definition.source.kind)}</span>
                    <span class="rounded border border-border bg-surface-2 px-2 py-0.5">{definition.inputs.length} inputs</span>
                    <span class="rounded border border-border bg-surface-2 px-2 py-0.5">{definition.outputs.length} outputs</span>
                    {#if definition.source.kind === 'repository'}
                      <span class="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono">{definition.source.revision}</span>
                    {/if}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Delete External Workflow"
                  class="p-2 rounded-lg text-text-subtle hover:bg-red-50 hover:text-red-600 transition-colors"
                  onclick={() => removeDefinition(definition.id, definition.name)}
                >
                  <Icon icon="lucide:trash-2" width="14" height="14" />
                </button>
              </div>
            </Card>
          {/each}
        </div>
      {/if}
    </div>
  </PageContent>
</div>
