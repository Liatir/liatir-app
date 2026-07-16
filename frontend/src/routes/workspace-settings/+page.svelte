<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import EnvVarTable from '$lib/components/ui/EnvVarTable.svelte';
  import TypeToConfirmDialog from '$lib/components/ui/TypeToConfirmDialog.svelte';
  import Icon from '@iconify/svelte';
  import { workspaceStore, type SandboxResetLevel } from '$lib/stores/workspace.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { confirm } from '$lib/stores/confirm.svelte';
	import PageContent from '$lib/components/layout/PageContent.svelte';

  let nameInput = $state(workspaceStore.active?.name ?? '');
  let nameSaving = $state(false);
  let nameSaved = $state(false);
  let resettingLevel = $state<SandboxResetLevel | null>(null);

  let typeConfirmOpen = $state(false);

  $effect(() => {
    const active = workspaceStore.active;
    if (active && nameInput === '') nameInput = active.name;
  });

  async function saveName() {
    if (!workspaceStore.activeId) return;
    nameSaving = true;
    await workspaceStore.rename(workspaceStore.activeId, nameInput);
    nameSaving = false;
    nameSaved = true;
    setTimeout(() => { nameSaved = false; }, 2000);
  }

  async function initiateDelete() {
    const ok = await confirm({
      title: 'Delete workspace',
      message: `Delete "${workspaceStore.active?.name}"? All workspace data will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Continue',
    });
    if (!ok) return;
    typeConfirmOpen = true;
  }

  async function onTypeConfirmed() {
    typeConfirmOpen = false;
    const id = workspaceStore.activeId;
    if (!id) return;
    await workspaceStore.delete(id);
    goto('/workspaces');
  }

  const sandboxResetCopy: Record<SandboxResetLevel, { title: string; message: string; label: string }> = {
    'demo-files': {
      title: 'Re-seed demo files',
      message: 'This will re-add any missing bundled demo files to the Sandbox. Existing data, pipelines, scripts, results, and settings will be kept.',
      label: 'Re-seed',
    },
    runs: {
      title: 'Clear Sandbox runs',
      message: 'This will clear Sandbox Results, Analysis Runs, completed Sandbox jobs, and pipeline run state. Pipelines, scripts, API connections, environment variables, and data files will be kept.',
      label: 'Clear runs',
    },
    full: {
      title: 'Reset Sandbox',
      message: 'This will clear all data in the Sandbox workspace (pipelines, scripts, API connections, data files, runs). Demo files will be re-seeded. This cannot be undone.',
      label: 'Reset',
    },
  };

  async function resetSandboxMode(level: SandboxResetLevel) {
    const copy = sandboxResetCopy[level];
    const ok = await confirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.label,
    });
    if (!ok) return;
    resettingLevel = level;
    try {
      await workspaceStore.resetSandboxMode(level);
      await pipelineStore.init();
      if (level === 'full') goto('/');
    } finally {
      resettingLevel = null;
    }
  }
</script>

<div class="flex flex-col h-full">
  <PageHeader
    title={workspaceStore.isSandboxMode ? 'Sandbox' : 'Workspace'}
    description={workspaceStore.isSandboxMode ? 'Sandbox workspace with demo files' : (workspaceStore.active?.name ?? '')}
  />

  <PageContent>
  <div class="flex-1 overflow-y-auto p-6 space-y-6">

    {#if workspaceStore.isSandboxMode}
      <!-- Sandbox info card -->
      <Card class="p-4 border-sandbox-200 bg-sandbox-50/40">
        <div class="flex items-start gap-3">
          <div class="h-8 w-8 rounded-lg bg-sandbox-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <Icon icon="lucide:flask-conical" width="16" height="16" class="text-sandbox-600" />
          </div>
          <div>
            <p class="text-sm font-medium text-sandbox-900">Sandbox workspace</p>
            <p class="text-xs text-sandbox-700/80 mt-0.5 leading-relaxed">
              This is a reserved sandbox workspace. It comes pre-loaded with demo files and can be reset at any time. It cannot be renamed or deleted.
            </p>
          </div>
        </div>
      </Card>

      <!-- Environment variables -->
      <section>
        <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Environment Variables</h2>
        <p class="text-xs text-text-subtle mb-3">
          Use <code class="font-mono text-text-secondary">{"{{KEY}}"}</code> to interpolate these variables in API requests, pipeline inputs, and tool parameters.
        </p>
        <EnvVarTable
          vars={workspaceStore.envVars}
          onchange={async (vars) => { await workspaceStore.updateEnvVars(vars); }}
        />
      </section>

      <!-- Reset -->
      <section>
        <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Sandbox Reset</h2>
        <div class="grid gap-3 lg:grid-cols-3">
        <Card class="p-4">
          <div class="flex h-full flex-col justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-text">Re-seed demo files</p>
              <p class="text-xs text-text-muted mt-0.5">
                Restore missing bundled demo files without touching your Sandbox work.
              </p>
            </div>
            <Button variant="sandbox" size="sm" loading={resettingLevel === 'demo-files'} disabled={resettingLevel !== null} onclick={() => resetSandboxMode('demo-files')}>
              Re-seed
            </Button>
          </div>
        </Card>

        <Card class="p-4">
          <div class="flex h-full flex-col justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-text">Clear runs and results</p>
              <p class="text-xs text-text-muted mt-0.5">
                Clear Results, Analysis Runs, completed jobs, and pipeline run state.
              </p>
            </div>
            <Button variant="warn" size="sm" loading={resettingLevel === 'runs'} disabled={resettingLevel !== null} onclick={() => resetSandboxMode('runs')}>
              Clear runs
            </Button>
          </div>
        </Card>

        <Card class="p-4">
          <div class="flex h-full flex-col justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-text">Full Sandbox reset</p>
              <p class="text-xs text-text-muted mt-0.5">
                Clear Sandbox data completely and re-seed bundled demo files.
              </p>
            </div>
            <Button variant="danger" size="sm" loading={resettingLevel === 'full'} disabled={resettingLevel !== null} onclick={() => resetSandboxMode('full')}>
              Reset all
            </Button>
          </div>
        </Card>
        </div>
      </section>

    {:else}
      <!-- General -->
      <section>
        <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">General</h2>
        <Card class="p-4 space-y-3">
          <div class="space-y-1.5">
            <label for="ws-name" class="text-sm text-text-secondary">Workspace name</label>
            <div class="flex gap-2">
              <input
                id="ws-name"
                type="text"
                bind:value={nameInput}
                placeholder="My workspace"
                class="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm
                       placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30"
                onkeydown={(e) => { if (e.key === 'Enter') saveName(); }}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={nameSaving}
                disabled={!nameInput.trim() || nameInput === workspaceStore.active?.name}
                onclick={saveName}
              >
                {nameSaved ? 'Saved' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <!-- Environment variables -->
      <section>
        <h2 class="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Environment Variables</h2>
        <p class="text-xs text-text-subtle mb-3">
          Use <code class="font-mono text-text-secondary">{"{{KEY}}"}</code> to interpolate these variables in API requests, pipeline inputs, and tool parameters.
        </p>
        <EnvVarTable
          vars={workspaceStore.envVars}
          onchange={async (vars) => { await workspaceStore.updateEnvVars(vars); }}
        />
      </section>

      <!-- Danger zone -->
      <section>
        <h2 class="text-xs font-medium text-red-400 uppercase tracking-wider mb-3">Danger Zone</h2>
        <Card class="p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-text">Delete this workspace</p>
              <p class="text-xs text-text-muted mt-0.5">
                Permanently delete this workspace and all its data. This action cannot be undone.
              </p>
            </div>
            <Button variant="danger" size="sm" onclick={initiateDelete}>
              Delete
            </Button>
          </div>
        </Card>
      </section>
    {/if}

  </div>
  </PageContent>
</div>

<TypeToConfirmDialog
  open={typeConfirmOpen}
  phrase="I UNDERSTAND"
  title="Delete workspace"
  message="All data in this workspace — pipelines, scripts, API connections, data files and analysis runs — will be permanently deleted."
  confirmLabel="Delete workspace"
  onconfirm={onTypeConfirmed}
  oncancel={() => { typeConfirmOpen = false; }}
/>
