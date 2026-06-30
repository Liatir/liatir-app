<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node, Edge } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { ApiRequestNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';
  import { upstreamOptions } from '$lib/tools/pipeline-io';
  import { sanitizeLocalPathsForDisplay } from '$lib/utils';
  import ValueRefInput from './ValueRefInput.svelte';
  import NodeDeleteButton from './NodeDeleteButton.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let { id, data }: NodeProps<Node<ApiRequestNodeData>> = $props();
  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const nodeDataContext = getPipelineNodeDataContext();
  const runState = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(runState?.status ?? 'pending');
  const disabled = $derived(pipelineStore.running);

  const req = $derived(data.requestId ? apiConnections.requestById(data.requestId) : null);

  const METHOD_COLORS: Record<string, string> = {
    GET: 'text-emerald-600', POST: 'text-blue-600', PUT: 'text-amber-600',
    PATCH: 'text-violet-600', DELETE: 'text-red-600', HEAD: 'text-zinc-500', OPTIONS: 'text-zinc-500',
  };

  let showPicker = $state(false);
  let pickerQuery = $state('');
  let pickerSearchInput = $state<HTMLInputElement | null>(null);
  let showParams = $state(false);

  const filteredRequests = $derived(
    apiConnections.requests.filter(r => {
      if (!pickerQuery.trim()) return true;
      const q = pickerQuery.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
    })
  );

  async function updateApiRequestData(patch: Partial<ApiRequestNodeData>) {
    updateNodeData(id, patch);
    await commitNodeDataAfterUpdate(nodeDataContext, getNodes, getEdges);
  }

  function selectRequest(rid: string, rname: string) {
    void updateApiRequestData({ requestId: rid, requestName: rname });
    showPicker = false;
    pickerQuery = '';
  }

  function statusColor() {
    if (status === 'done')    return 'bg-emerald-500';
    if (status === 'error')   return 'bg-red-500';
    if (status === 'running') return 'bg-brand animate-pulse';
    if (status === 'skipped') return 'bg-zinc-200';
    return 'bg-zinc-300';
  }

  // Non-private params that may be overridden from upstream (call overrides provider).
  const overridableParams = $derived.by(() => {
    if (!req) return [] as string[];
    const provider = apiConnections.collectionById(req.collectionId);
    const keys: string[] = [];
    for (const p of provider?.sharedParams ?? []) if (!p.private && p.enabled && p.key) keys.push(p.key);
    for (const p of req.params) if (!p.private && p.enabled && p.key) keys.push(p.key);
    return [...new Set(keys)];
  });

  // Connected upstream value outputs, usable as param overrides.
  const valueOptions = $derived.by(() => {
    void runState;
    return upstreamOptions(id, getNodes(), getEdges() as Edge[], 'value');
  });

  // Output fields the request exposes (status + extracted schema fields).
  const outputFields = $derived([
    { key: 'status', label: 'HTTP status' },
    ...Object.entries(req?.outputSchema ?? {}).map(([k, f]) => ({ key: k, label: f.label || k })),
  ]);

  function setOverride(key: string, value: string) {
    void updateApiRequestData({ paramOverrides: { ...(data.paramOverrides ?? {}), [key]: value } });
  }

  $effect(() => {
    if (showPicker && pickerSearchInput) setTimeout(() => pickerSearchInput?.focus(), 30);
  });
</script>

<!-- Single input handle — wire upstream value nodes in, then map them to params below. -->
<Handle type="target" position={Position.Left} id="input" />

<div class="min-w-60 max-w-72 rounded-xl border border-border bg-white shadow-md overflow-visible">
  <div class="flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-border bg-rose-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <Icon icon="lucide:plug" width="11" height="11" class="text-rose-500 shrink-0" />
    <span class="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">API Request</span>
    <NodeDeleteButton {id} class="ml-auto" />
  </div>

  <div class="px-3 py-2.5 nodrag nopan space-y-2">
    {#if req}
      <div class="flex items-center gap-2">
        <span class="text-[10px] font-bold font-mono {METHOD_COLORS[req.method] ?? 'text-zinc-500'}">{req.method}</span>
        <span class="flex-1 text-xs text-zinc-700 truncate">{req.name}</span>
        {#if !disabled}
          <button onclick={() => showPicker = true} class="text-[10px] text-zinc-400 hover:text-brand">Change</button>
        {/if}
      </div>
      <div class="text-[10px] text-zinc-400 font-mono truncate">{req.url}</div>

      {#if overridableParams.length > 0}
        <div class="border-t border-border/60 pt-1.5">
          <button
            onclick={() => showParams = !showParams}
            class="w-full flex items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-700"
          >
            <span>Parameter overrides{(() => { const n = Object.values(data.paramOverrides ?? {}).filter(v => v).length; return n ? ` (${n})` : ''; })()}</span>
            <Icon icon={showParams ? 'lucide:chevron-up' : 'lucide:chevron-down'} width="12" height="12" />
          </button>
          {#if showParams}
            <div class="mt-1.5 space-y-1.5">
              {#each overridableParams as key}
                <div>
                  <span class="block text-[10px] text-zinc-400 mb-0.5 font-mono">{key}</span>
                  <ValueRefInput
                    value={data.paramOverrides?.[key] ?? ''}
                    options={valueOptions}
                    type="text"
                    placeholder="default — or override / link →"
                    {disabled}
                    accentClass="focus:ring-rose-400/40"
                    onchange={(v) => setOverride(key, v)}
                  />
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if outputFields.length > 0}
        <div class="border-t border-border/60 pt-1.5">
          <p class="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Outputs</p>
          <div class="flex flex-wrap gap-1">
            {#each outputFields as f}
              <span class="inline-flex items-center rounded-full bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">{f.label}</span>
            {/each}
            <span class="inline-flex items-center gap-1 rounded-full bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">
              <Icon icon="lucide:file" width="8" height="8" /> Response body
            </span>
          </div>
        </div>
      {/if}
    {:else}
      <button
        onclick={() => showPicker = true}
        {disabled}
        class="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-rose-300 px-3 py-2
               text-[11px] text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Icon icon="lucide:plus" width="10" height="10" />
        Select request
      </button>
    {/if}

    {#if status === 'running'}
      <div class="text-[10px] font-mono text-zinc-400">{sanitizeLocalPathsForDisplay(runState?.logs?.[0] ?? 'Sending…', 2)}</div>
    {/if}
    {#if status === 'error' && runState?.error}
      <div class="text-[10px] text-red-500 font-mono">{sanitizeLocalPathsForDisplay(runState.error, 2)}</div>
    {/if}
    {#if status === 'done'}
      <div class="text-[10px] text-emerald-600">
        {runState?.outputValues?.status ? `HTTP ${runState.outputValues.status}` : 'Done'}
        · {runState?.outputFiles?.length ?? 0} file{(runState?.outputFiles?.length ?? 0) !== 1 ? 's' : ''}
      </div>
    {/if}
  </div>
</div>

<!-- Single output handle — wire downstream, then pick which field/body to use there. -->
<Handle type="source" position={Position.Right} id="output" />

{#if showPicker}
  <div class="fixed inset-0 z-50" role="presentation" onclick={() => { showPicker = false; pickerQuery = ''; }}></div>
  <div class="absolute left-full top-0 ml-2 z-50 w-64 rounded-xl border border-border bg-white shadow-xl overflow-hidden nodrag nopan">
    <div class="px-3 py-2 border-b border-border bg-surface flex items-center gap-2">
      <Icon icon="lucide:search" width="11" height="11" class="text-zinc-400 shrink-0" />
      <input
        bind:this={pickerSearchInput}
        bind:value={pickerQuery}
        placeholder="Search requests…"
        class="flex-1 text-xs bg-transparent outline-none text-zinc-800 placeholder:text-zinc-400"
        onclick={(e) => e.stopPropagation()}
      />
    </div>
    <div class="max-h-52 overflow-y-auto">
      {#each filteredRequests as r (r.id)}
        <button
          onclick={() => selectRequest(r.id, r.name)}
          class="w-full text-left px-3 py-2 hover:bg-rose-50 transition-colors border-b border-border/50 last:border-0"
        >
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold font-mono {METHOD_COLORS[r.method] ?? 'text-zinc-500'}">{r.method}</span>
            <span class="flex-1 text-xs text-zinc-700 truncate">{r.name}</span>
          </div>
          <div class="text-[10px] text-zinc-400 font-mono truncate">{r.url}</div>
        </button>
      {:else}
        <div class="px-3 py-4 text-center text-xs text-zinc-400">No requests found</div>
      {/each}
    </div>
  </div>
{/if}
