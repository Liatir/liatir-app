<script lang="ts">
  // Editable node title shown in a step's header. Displays the node's type/tool name
  // by default; double-click (or the pencil) lets the user set a custom name, which
  // then becomes the title with the type shown as a subtitle. Locked during a run.
  import { tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import { pipelineStore } from '$lib/stores/pipeline.svelte';
  import { commitNodeDataAfterUpdate, getPipelineNodeDataContext } from './node-data-commit';

  let {
    id,
    label,
    typeName,
    nameClass = 'text-sm font-semibold text-zinc-800',
    typeClass = 'text-sm font-semibold text-zinc-800',
  }: {
    id: string;
    /** Current custom name (node data.label). */
    label: string | undefined;
    /** Fallback shown when no custom name is set (tool/type name). */
    typeName: string;
    /** Class for the custom name (main title). */
    nameClass?: string;
    /** Class for the type name when no custom name is set. */
    typeClass?: string;
  } = $props();

  const { updateNodeData, getNodes, getEdges } = useSvelteFlow();
  const ctx = getPipelineNodeDataContext();
  const readOnly = $derived(pipelineStore.running);
  const custom = $derived((label ?? '').trim());
  const hasCustom = $derived(custom.length > 0);

  let editing = $state(false);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  async function startEdit(event?: Event) {
    if (readOnly) return;
    event?.stopPropagation();
    draft = custom;
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  async function commit() {
    if (!editing) return;
    editing = false;
    const next = draft.trim();
    if (next === custom) return;
    updateNodeData(id, { label: next });
    await commitNodeDataAfterUpdate(ctx, getNodes, getEdges);
  }

  function onKeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
    }
  }
</script>

<div class="flex min-w-0 flex-1 flex-col">
  {#if editing}
    <input
      bind:this={inputEl}
      bind:value={draft}
      onblur={commit}
      onkeydown={onKeydown}
      onclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
      placeholder={typeName}
      class="nodrag nopan w-full rounded border border-brand/40 bg-white px-1.5 py-0.5 text-xs text-zinc-800 outline-none focus:ring-1 focus:ring-brand/30"
    />
  {:else}
    <div class="group/lbl flex min-w-0 items-center gap-1" ondblclick={startEdit} role="presentation">
      <span class="truncate {hasCustom ? nameClass : typeClass}">{hasCustom ? custom : typeName}</span>
      {#if !readOnly}
        <button
          type="button"
          onclick={startEdit}
          title="Rename node"
          aria-label="Rename node"
          class="nodrag nopan shrink-0 text-zinc-300 opacity-0 transition-opacity hover:text-brand group-hover/lbl:opacity-100"
        >
          <Icon icon="lucide:pencil" width="10" height="10" />
        </button>
      {/if}
    </div>
    {#if hasCustom}
      <!-- Renamed indicator: tag icon + the original type/tool name as a subtitle. -->
      <span class="flex min-w-0 items-center gap-1 text-[10px] font-medium leading-tight text-zinc-400" title="Renamed · {typeName}">
        <Icon icon="lucide:tag" width="8" height="8" class="shrink-0" />
        <span class="truncate">{typeName}</span>
      </span>
    {/if}
  {/if}
</div>
