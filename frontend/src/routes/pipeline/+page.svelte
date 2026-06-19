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

  interface PrevOutputOption {
    stepLabel: string;
    fileLabel: string;
    ext: string;
    path: string | null;  // null = step hasn't run yet
    size?: number;
  }

  function prevStepOutputs(stepIndex: number, accept: string[] | undefined): PrevOutputOption[] {
    if (stepIndex === 0) return [];
    const result: PrevOutputOption[] = [];

    for (let pi = 0; pi < stepIndex; pi++) {
      const prev = pipelineStore.steps[pi];
      const prevDef = PIPELINE_REGISTRY[prev.stepId]?.definition;
      if (!prevDef) continue;
      const stepLabel = `Step ${pi + 1} · ${prevDef.label}`;

      if (prev.outputFiles.length > 0) {
        // Step has run — show actual output files
        for (const f of prev.outputFiles) {
          if (accept && accept.length > 0 && !accept.some(a => f.ext === a || f.path.endsWith(`.${a}`))) continue;
          result.push({ stepLabel, fileLabel: f.label, ext: f.ext, path: f.path, size: f.size });
        }
      } else {
        // Step hasn't run yet — show expected outputs from outputSchema
        for (const [, outSchema] of Object.entries(prevDef.outputSchema)) {
          if (outSchema.type !== 'file' || !outSchema.ext?.length) continue;
          if (accept && accept.length > 0 && !accept.some(a => outSchema.ext!.includes(a))) continue;
          result.push({ stepLabel, fileLabel: outSchema.label ?? 'Output file', ext: outSchema.ext[0], path: null });
        }
      }
    }
    return result;
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
            <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div class="flex items-center gap-2 flex-1 min-w-0">
                <span class="text-[10px] font-medium text-zinc-400 w-4 shrink-0">{i + 1}</span>
                <span class="h-2 w-2 rounded-full shrink-0 {statusColor(step.status)}"></span>
                <span class="text-sm font-medium text-zinc-800 truncate">{def?.label ?? step.stepId}</span>
                <span class="text-[10px] text-zinc-400 truncate hidden sm:block">{def?.description ?? ''}</span>
              </div>
              <span class="text-[10px] text-zinc-400 shrink-0">{statusLabel(step.status)}</span>
              {#if !pipelineStore.running}
                <!-- Reorder buttons -->
                <div class="flex items-center shrink-0">
                  <button
                    onclick={() => pipelineStore.moveStep(i, 'first')}
                    disabled={i === 0}
                    title="Move to top"
                    class="p-1 rounded text-zinc-300 hover:text-zinc-600 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>
                    </svg>
                  </button>
                  <button
                    onclick={() => pipelineStore.moveStep(i, 'up')}
                    disabled={i === 0}
                    title="Move up"
                    class="p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="18 15 12 9 6 15"/>
                    </svg>
                  </button>
                  <button
                    onclick={() => pipelineStore.moveStep(i, 'down')}
                    disabled={i === pipelineStore.steps.length - 1}
                    title="Move down"
                    class="p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  <button
                    onclick={() => pipelineStore.moveStep(i, 'last')}
                    disabled={i === pipelineStore.steps.length - 1}
                    title="Move to bottom"
                    class="p-1 rounded text-zinc-300 hover:text-zinc-600 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="17 6 12 11 7 6"/><polyline points="17 13 12 18 7 13"/>
                    </svg>
                  </button>
                  <div class="w-px h-3 bg-zinc-200 mx-1"></div>
                  <button
                    onclick={() => pipelineStore.removeStep(i)}
                    class="p-1 rounded text-zinc-400 hover:text-red-500 transition-colors"
                    aria-label="Remove step"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              {/if}
            </div>

            <!-- Step body: inputs -->
            {#if def && (step.status === 'pending' || step.status === 'error')}
              <div class="px-4 py-3 space-y-3">
                {#each Object.entries(def.inputSchema) as [key, schema]}
                  {#if schema.type === 'file'}
                    {@const prevOutputs = prevStepOutputs(i, schema.accept)}
                    <div class="space-y-2">
                      {#if prevOutputs.length > 0}
                        <div class="space-y-1">
                          <p class="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">From previous steps</p>
                          {#each prevOutputs as opt}
                            {#if opt.path !== null}
                              {@const selected = step.inputs[key] === opt.path}
                              <button
                                type="button"
                                onclick={() => pipelineStore.setInput(i, key, selected ? '' : opt.path!)}
                                disabled={pipelineStore.running}
                                class="w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors
                                  {selected ? 'border-brand/40 bg-brand/8 ring-1 ring-brand/20' : 'border-zinc-200 bg-zinc-50 hover:border-brand/30 hover:bg-brand/5'}"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={selected ? '#4f39f6' : '#a1a1aa'} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                                  {#if selected}<polyline points="20 6 9 17 4 12"/>{:else}<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>{/if}
                                </svg>
                                <div class="flex-1 min-w-0">
                                  <p class="text-[10px] font-medium {selected ? 'text-brand/70' : 'text-zinc-400'}">{opt.stepLabel}</p>
                                  <p class="text-xs truncate {selected ? 'text-brand font-medium' : 'text-zinc-700'}">{opt.fileLabel}</p>
                                </div>
                                <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500 border border-zinc-200">{opt.ext}</span>
                              </button>
                            {:else}
                              <div class="w-full flex items-center gap-3 rounded-lg border border-dashed border-zinc-200 px-3 py-2 opacity-50">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d4d4d8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                                </svg>
                                <div class="flex-1 min-w-0">
                                  <p class="text-[10px] font-medium text-zinc-400">{opt.stepLabel}</p>
                                  <p class="text-xs text-zinc-400 truncate">{opt.fileLabel} <span class="text-zinc-300">· run step first</span></p>
                                </div>
                                <span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-400 border border-zinc-200">{opt.ext}</span>
                              </div>
                            {/if}
                          {/each}
                          <p class="text-[10px] text-zinc-300 pt-0.5">— or pick from your data files —</p>
                        </div>
                      {/if}
                      <FilePickerPopup
                        files={filesForInput(schema.accept)}
                        value={prevOutputs.some(o => o.path !== null && o.path === step.inputs[key]) ? '' : (step.inputs[key] ?? '')}
                        label={schema.label ?? key}
                        emptyText="No matching files in Data yet."
                        disabled={pipelineStore.running}
                        onchange={(p) => pipelineStore.setInput(i, key, p)}
                      />
                    </div>
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

          </div>
        {/if}

      </div>
    {/if}
  </div>
</div>

{#if showAddMenu}
  <div class="fixed inset-0 z-10" role="presentation" onclick={() => showAddMenu = false}></div>
  <div class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 rounded-xl border border-border bg-white shadow-lg overflow-hidden w-64">
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
