<script lang="ts">
  import { Handle, Position, useSvelteFlow } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import type { ToolNodeData } from '$lib/types/pipeline';
  import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import OptionPicker from '$lib/components/ui/OptionPicker.svelte';
  import type { PickerGroup } from '$lib/components/ui/OptionPicker.svelte';
  import { fmtBytes } from '$lib/utils';

  let { id, data }: NodeProps<Node<ToolNodeData>> = $props();

  const { updateNodeData } = useSvelteFlow();

  const entry = $derived(PIPELINE_REGISTRY[data.stepId]);
  const def = $derived(entry?.definition);
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');

  const fileInputKeys = $derived(
    def ? Object.entries(def.inputSchema).filter(([, s]) => s.type === 'file') : []
  );
  const otherInputKeys = $derived(
    def ? Object.entries(def.inputSchema).filter(([, s]) => s.type !== 'file') : []
  );
  const fileOutputKeys = $derived(
    def ? Object.entries(def.outputSchema).filter(([, s]) => s.type === 'file') : []
  );

  function truncatePath(path: string, max = 40): string {
    if (path.length <= max) return path;
    const parts = path.split(/[\\/]/);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '…' + path.slice(-(max - 1));
  }

  function buildGroups(accept: string[] | undefined): PickerGroup[] {
    const files = accept?.length ? dataFiles.byExt(...accept) : dataFiles.files;
    return [{
      items: files.map(f => ({
        value: f.path,
        label: f.name,
        sublabel: truncatePath(f.path),
        badge: f.ext || '?',
        meta: f.size != null ? fmtBytes(f.size) : undefined,
      })),
    }];
  }

  function setInput(key: string, value: string) {
    updateNodeData(id, { inputs: { ...data.inputs, [key]: value } });
  }

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    return 'bg-zinc-300';
  }

  const showBody = $derived(status === 'pending' || status === 'error' || status === 'running');
</script>

<!-- Input handles — one per file input -->
{#each fileInputKeys as [key, schema], idx}
  <Handle
    type="target"
    position={Position.Left}
    id={key}
    style="top: {60 + idx * 28}px"
  />
{/each}

<!-- Node card -->
<div class="min-w-[280px] max-w-[320px] rounded-xl border border-border bg-white shadow-md overflow-hidden nodrag">

  <!-- Header -->
  <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-surface">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <span class="flex-1 text-sm font-semibold text-zinc-800 truncate">{def?.label ?? data.stepId}</span>
    <span class="text-[10px] text-zinc-400 font-medium">
      {status === 'running' ? 'Running…' : status === 'done' ? 'Done' : status === 'error' ? 'Error' : 'Pending'}
    </span>
  </div>

  <!-- Body: inputs -->
  {#if showBody && def}
    <div class="px-3 py-2.5 space-y-2.5">

      <!-- File inputs — show via OptionPicker OR connected handle indicator -->
      {#each fileInputKeys as [key, schema]}
        {@const connected = false}
        <div>
          <OptionPicker
            value={data.inputs[key] ?? ''}
            groups={buildGroups(schema.accept)}
            label="{schema.label ?? key}{schema.required ? '' : ' (optional)'}"
            placeholder="Select or connect…"
            emptyText="No matching files."
            emptyHref="/data"
            disabled={pipelineStore.running}
            onchange={(v) => setInput(key, v)}
          />
        </div>
      {/each}

      <!-- String inputs -->
      {#each otherInputKeys as [key, schema]}
        {#if schema.type === 'string' || schema.type === 'number'}
          <div>
            <label class="block text-[11px] text-zinc-500 mb-1">
              {schema.label ?? key}{schema.required ? '' : ' (optional)'}
            </label>
            <input
              type={schema.type === 'number' ? 'number' : 'text'}
              value={data.inputs[key] ?? (schema.default as string ?? '')}
              oninput={(e) => setInput(key, (e.target as HTMLInputElement).value)}
              disabled={pipelineStore.running}
              class="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-mono
                     placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
          </div>
        {/if}
      {/each}

      <!-- Error message -->
      {#if status === 'error' && state?.error}
        <div class="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 font-mono">
          {state.error}
        </div>
      {/if}

    </div>
  {/if}

  <!-- Running: log preview -->
  {#if status === 'running' && state?.logs && state.logs.length > 0}
    <div class="px-3 pb-2 text-[10px] font-mono text-zinc-400 truncate">
      {state.logs[state.logs.length - 1]}
    </div>
  {/if}

  <!-- Done: output files -->
  {#if status === 'done' && state?.outputFiles && state.outputFiles.length > 0}
    <div class="px-3 pb-2.5 flex flex-wrap gap-1">
      {#each state.outputFiles as f}
        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200
                     px-2 py-0.5 text-[10px] text-emerald-700">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
          </svg>
          {f.label}
        </span>
      {/each}
    </div>
  {/if}

</div>

<!-- Output handles — one per file output -->
{#each fileOutputKeys as [key, schema], idx}
  <Handle
    type="source"
    position={Position.Right}
    id={key}
    style="top: {60 + idx * 28}px"
  />
{/each}
