<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { Node } from '@xyflow/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import Icon from '@iconify/svelte';
  import type { ApiRequestNodeData } from '$lib/types/pipeline';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { apiConnections } from '$lib/stores/apiConnections.svelte';

  let { id, data }: NodeProps<Node<ApiRequestNodeData>> = $props();
  const { updateNodeData } = useSvelteFlow();
  const state = $derived(pipelineStore.nodeStates.get(id));
  const status = $derived(state?.status ?? 'pending');
  const disabled = $derived(pipelineStore.running || status === 'done');

  const req = $derived(data.requestId ? apiConnections.requestById(data.requestId) : null);

  const METHOD_COLORS: Record<string, string> = {
    GET: 'text-emerald-600', POST: 'text-blue-600', PUT: 'text-amber-600',
    PATCH: 'text-violet-600', DELETE: 'text-red-600', HEAD: 'text-zinc-500', OPTIONS: 'text-zinc-500',
  };

  let showPicker = $state(false);
  let pickerQuery = $state('');

  const filteredRequests = $derived(
    apiConnections.requests.filter(r => {
      if (!pickerQuery.trim()) return true;
      const q = pickerQuery.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
    })
  );

  function selectRequest(rid: string, rname: string) {
    updateNodeData(id, { requestId: rid, requestName: rname });
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

  // Output handles: responseBody always + one per outputSchema field
  const outputHandles = $derived([
    { id: 'responseBody', label: 'Response' },
    ...Object.entries(req?.outputSchema ?? {}).map(([k, f]) => ({ id: k, label: f.label || k })),
  ]);

  // Input handles: one per non-private parameter (call + provider shared)
  const inputHandles = $derived.by(() => {
    if (!req) return [] as { id: string; label: string }[];
    const provider = apiConnections.collectionById(req.collectionId);
    const params = [
      ...(provider?.sharedParams ?? []).filter(p => !p.private && p.enabled && p.key),
      ...req.params.filter(p => !p.private && p.enabled && p.key),
    ];
    // de-dupe by key (call overrides provider)
    const seen = new Map<string, { id: string; label: string }>();
    for (const p of params) seen.set(p.key, { id: p.key, label: p.key });
    return [...seen.values()];
  });
</script>

<!-- Input handles (non-private parameters) -->
{#each inputHandles as h, idx}
  <Handle type="target" position={Position.Left} id={h.id} style="top: {52 + idx * 24}px" />
{/each}

<!-- Output handles -->
{#each outputHandles as h, idx}
  <Handle type="source" position={Position.Right} id={h.id} style="top: {52 + idx * 24}px" />
{/each}

<div class="min-w-56 max-w-72 rounded-xl border border-border bg-white shadow-md overflow-hidden">
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-rose-50 cursor-grab active:cursor-grabbing">
    <span class="h-2 w-2 rounded-full shrink-0 {statusColor()}"></span>
    <Icon icon="lucide:plug" width="11" height="11" class="text-rose-500 shrink-0" />
    <span class="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">API Request</span>
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

      {#if inputHandles.length > 0}
        <div class="flex flex-col gap-0.5 border-t border-border/60 pt-1.5">
          {#each inputHandles as h}
            <div class="flex items-center gap-1.5">
              <div class="w-2 h-2 rounded-full border border-zinc-300 bg-white"></div>
              <span class="text-[10px] text-zinc-400">{h.label}</span>
            </div>
          {/each}
        </div>
      {/if}

      {#if outputHandles.length > 1}
        <div class="flex flex-col gap-0.5">
          {#each outputHandles as h}
            <div class="flex items-center justify-between">
              <span class="text-[10px] text-zinc-400">{h.label}</span>
              <div class="w-2 h-2 rounded-full border border-zinc-300 bg-white"></div>
            </div>
          {/each}
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
      <div class="text-[10px] font-mono text-zinc-400">{state?.logs?.[0] ?? 'Sending…'}</div>
    {/if}
    {#if status === 'error' && state?.error}
      <div class="text-[10px] text-red-500 font-mono">{state.error}</div>
    {/if}
    {#if status === 'done'}
      <div class="text-[10px] text-emerald-600">
        {state?.outputValues?.status ? `HTTP ${state.outputValues.status}` : 'Done'}
        · {state?.outputFiles?.length ?? 0} file{(state?.outputFiles?.length ?? 0) !== 1 ? 's' : ''}
      </div>
    {/if}
  </div>
</div>

{#if showPicker}
  <div class="fixed inset-0 z-50" role="presentation" onclick={() => { showPicker = false; pickerQuery = ''; }}></div>
  <div class="absolute left-full top-0 ml-2 z-50 w-64 rounded-xl border border-border bg-white shadow-xl overflow-hidden nodrag nopan">
    <div class="px-3 py-2 border-b border-border bg-surface flex items-center gap-2">
      <Icon icon="lucide:search" width="11" height="11" class="text-zinc-400 shrink-0" />
      <input
        bind:value={pickerQuery}
        placeholder="Search requests…"
        autofocus
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
