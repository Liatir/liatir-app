<script lang="ts">
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import FilePickerPopup from '$lib/components/ui/FilePickerPopup.svelte';
  import TerminalOutput from '$lib/components/ui/TerminalOutput.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';

  const STEP_OPTIONS = Object.entries(PIPELINE_REGISTRY).map(([id, entry]) => ({
    id,
    label: entry.definition.label,
    description: entry.definition.description,
    category: entry.definition.category,
  }));

  let showAddMenu = $state(false);

  const canRun = $derived(
    pipelineStore.steps.length > 0 &&
    !pipelineStore.running &&
    pipelineStore.steps.every(s => {
      const def = PIPELINE_REGISTRY[s.stepId]?.definition;
      if (!def) return false;
      return Object.entries(def.inputSchema).every(([k, schema]) =>
        !schema.required || !!s.inputs[k]
      );
    })
  );

  const allDone = $derived(
    pipelineStore.steps.length > 0 &&
    pipelineStore.steps.every(s => s.status === 'done')
  );

  onMount(() => { dataFiles.init(); });

  function filesByExt(...exts: string[]) {
    return dataFiles.byExt(...exts);
  }

  function filesForInput(accept: string[] | undefined) {
    if (!accept || accept.length === 0) return dataFiles.files;
    return filesByExt(...accept);
  }

  function statusColor(status: string) {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    return 'bg-zinc-300';
  }

  function statusLabel(status: string) {
    if (status === 'done')    return 'Done';
    if (status === 'error')   return 'Error';
    if (status === 'running') return 'Running…';
    return 'Pending';
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PageHeader title="Pipeline" description="Chain tools with automatic data flow between steps">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        {#if pipelineStore.steps.length > 0}
          <Button variant="ghost" size="sm" onclick={pipelineStore.clear} disabled={pipelineStore.running}>
            Clear
          </Button>
        {/if}
        <Button
          variant="primary"
          disabled={!canRun}
          loading={pipelineStore.running}
          onclick={pipelineStore.run}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Run pipeline
        </Button>
      </div>
    {/snippet}
  </PageHeader>

  <div class="flex-1 overflow-y-auto p-6">

    {#if pipelineStore.steps.length === 0}
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center h-full gap-4 text-center">
        <div class="h-12 w-12 rounded-xl bg-zinc-100 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <div>
          <p class="text-sm font-medium text-zinc-700">No steps yet</p>
          <p class="text-xs text-zinc-400 mt-1">Add tools below to build your pipeline.</p>
        </div>
        <Button variant="primary" onclick={() => showAddMenu = true}>Add first step</Button>
      </div>

    {:else}
      <div class="max-w-2xl mx-auto space-y-3">

        {#each pipelineStore.steps as step, i (step.id)}
          {@const entry = PIPELINE_REGISTRY[step.stepId]}
          {@const def = entry?.definition}

          <!-- Connector arrow between steps -->
          {#if i > 0}
            <div class="flex justify-center">
              <svg width="16" height="20" viewBox="0 0 16 20" fill="none" stroke="#d4d4d8" stroke-width="1.5" stroke-linecap="round">
                <line x1="8" y1="0" x2="8" y2="14"/>
                <polyline points="3 9 8 14 13 9"/>
              </svg>
            </div>
          {/if}

          <Card class="overflow-hidden">
            <!-- Step header -->
            <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <span class="text-[10px] font-medium text-zinc-400 w-4 shrink-0">{i + 1}</span>
                <span class="h-2 w-2 rounded-full shrink-0 {statusColor(step.status)}"></span>
                <span class="text-sm font-medium text-zinc-800 truncate">{def?.label ?? step.stepId}</span>
                <span class="text-[10px] text-zinc-400 truncate hidden sm:block">{def?.description ?? ''}</span>
              </div>
              <span class="text-[10px] text-zinc-400 shrink-0">{statusLabel(step.status)}</span>
              {#if !pipelineStore.running}
                <button
                  onclick={() => pipelineStore.removeStep(i)}
                  class="shrink-0 text-zinc-400 hover:text-red-500 transition-colors p-1 rounded"
                  aria-label="Remove step"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              {/if}
            </div>

            <!-- Step body: inputs -->
            {#if def && (step.status === 'pending' || step.status === 'error')}
              <div class="px-4 py-3 space-y-3">
                {#each Object.entries(def.inputSchema) as [key, schema]}
                  {#if schema.type === 'file'}
                    <FilePickerPopup
                      files={filesForInput(schema.accept)}
                      value={step.inputs[key] ?? ''}
                      label={schema.label ?? key}
                      emptyText="No matching files in Data yet."
                      disabled={pipelineStore.running}
                      onchange={(p) => pipelineStore.setInput(i, key, p)}
                    />
                  {:else if schema.type === 'string'}
                    <div class="space-y-1">
                      <label class="text-[11px] text-zinc-500">{schema.label ?? key}{schema.required ? '' : ' (optional)'}</label>
                      <input
                        type="text"
                        value={step.inputs[key] ?? (schema.default as string ?? '')}
                        oninput={(e) => pipelineStore.setInput(i, key, (e.target as HTMLInputElement).value)}
                        class="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-mono placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    </div>
                  {/if}
                {/each}

                {#if step.status === 'error' && step.error}
                  <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 font-mono">
                    {step.error}
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Live terminal during run -->
            {#if step.status === 'running' || step.logs.length > 0}
              <div class="px-4 pb-3">
                <TerminalOutput lines={step.logs} running={step.status === 'running'} />
              </div>
            {/if}

            <!-- Output files after done -->
            {#if step.status === 'done' && step.outputFiles.length > 0}
              <div class="px-4 pb-3 flex flex-wrap gap-1.5">
                {#each step.outputFiles as f}
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] text-emerald-700">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
                    </svg>
                    {f.label}
                    {#if f.size}
                      <span class="text-emerald-500">· {(f.size / 1_048_576).toFixed(1)} MB</span>
                    {/if}
                  </span>
                {/each}
              </div>
            {/if}
          </Card>
        {/each}

        <!-- Success banner -->
        {#if allDone}
          <div class="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <p class="text-sm text-emerald-800 font-medium">Pipeline complete — output files added to Data.</p>
          </div>
        {/if}

        <!-- Add step button -->
        {#if !pipelineStore.running}
          <div class="relative">
            <button
              onclick={() => showAddMenu = !showAddMenu}
              class="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200
                     py-3 text-sm text-zinc-400 hover:border-brand/40 hover:text-brand transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add step
            </button>

            {#if showAddMenu}
              <!-- Click outside to close -->
              <div class="fixed inset-0 z-10" role="presentation" onclick={() => showAddMenu = false}></div>

              <div class="absolute bottom-full mb-2 left-0 right-0 z-20 rounded-xl border border-border bg-white shadow-lg overflow-hidden">
                {#each [...new Set(STEP_OPTIONS.map(s => s.category))] as category}
                  <div>
                    <p class="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{category}</p>
                    {#each STEP_OPTIONS.filter(s => s.category === category) as opt}
                      <button
                        onclick={() => { pipelineStore.addStep(opt.id); showAddMenu = false; }}
                        class="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-zinc-50 transition-colors"
                      >
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium text-zinc-800">{opt.label}</p>
                          <p class="text-[11px] text-zinc-400 truncate">{opt.description}</p>
                        </div>
                      </button>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

      </div>
    {/if}
  </div>
</div>
