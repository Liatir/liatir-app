<!--
  Picks Results to attach in Quenta: several for a presentation, one for a chat. A multiple choice works
  on a draft, so closing without "Use selected" leaves the caller's choice untouched; a single choice
  applies on click. Failed and cancelled Results are marked, since attaching one asks about the failure.
-->
<script lang="ts">
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { AnalysisRunMeta } from '$lib/stores/analysisRuns.svelte';

  let {
    open,
    results,
    selected,
    multiple = true,
    title = 'Choose Results',
    description = 'Completed Results of this workspace. Pick a few: Quenta reads a limited amount of data at once.',
    onclose,
    onconfirm,
  }: {
    open: boolean;
    results: AnalysisRunMeta[];
    selected: string[];
    multiple?: boolean;
    title?: string;
    description?: string;
    onclose: () => void;
    onconfirm: (ids: string[]) => void;
  } = $props();

  let draft = $state<string[]>([]);
  let query = $state('');
  const visible = $derived(results.filter((result) => result.label.toLowerCase().includes(query.trim().toLowerCase())));

  // Each opening starts from the caller's current choice.
  $effect(() => {
    if (open) {
      draft = [...selected];
      query = '';
    }
  });

  function choose(id: string) {
    if (!multiple) {
      onconfirm([id]);
      return;
    }
    draft = draft.includes(id) ? draft.filter((item) => item !== id) : [...draft, id];
  }
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') onclose(); }} />

{#if open}
  <div role="presentation" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]" onclick={onclose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-picker-title"
      tabindex="-1"
      data-testid="presentation-results-dialog"
      class="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p id="result-picker-title" class="text-sm font-semibold text-text">{title}</p>
          <p class="mt-0.5 text-xs text-text-subtle">{description}</p>
        </div>
        <button type="button" aria-label="Close" class="text-text-subtle transition-colors hover:text-text-secondary" onclick={onclose}>
          <Icon icon="lucide:x" width="16" height="16" />
        </button>
      </div>

      <div class="border-b border-border px-5 py-3">
        <div class="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Icon icon="lucide:search" width="14" height="14" class="shrink-0 text-text-subtle" />
          <input bind:value={query} placeholder="Search Results…" class="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle" />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        {#each visible as result (result.id)}
          {@const chosen = draft.includes(result.id)}
          {@const failed = result.status !== 'done'}
          <button
            type="button"
            role={multiple ? 'checkbox' : 'option'}
            aria-checked={multiple ? chosen : undefined}
            aria-selected={multiple ? undefined : chosen}
            data-testid="presentation-result-option"
            data-result-id={result.id}
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors {chosen ? 'bg-brand/8' : 'hover:bg-surface-2'}"
            onclick={() => choose(result.id)}
          >
            {#if multiple}
              <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors {chosen ? 'border-brand bg-brand text-white' : 'border-border-2 bg-surface'}">
                {#if chosen}<Icon icon="lucide:check" width="13" height="13" />{/if}
              </span>
            {:else}
              <Icon icon={failed ? 'lucide:triangle-alert' : 'lucide:chart-no-axes-combined'} width="16" height="16" class="shrink-0 {failed ? 'text-amber-600' : 'text-brand'}" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-text">{result.label}</span>
              <span class="block text-[11px] text-text-subtle">{new Date(result.endedAt).toLocaleString()}</span>
            </span>
            {#if failed}
              <span class="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-700">{result.status === 'cancelled' ? 'Cancelled' : 'Failed'}</span>
            {/if}
          </button>
        {:else}
          <p class="py-10 text-center text-sm text-text-muted">
            {results.length ? 'No Result matches this search.' : 'No Results yet.'}
          </p>
        {/each}
      </div>

      {#if multiple}
        <div class="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p class="text-xs text-text-muted">{draft.length} selected</p>
          <div class="flex gap-2">
            <Button variant="ghost" size="sm" onclick={onclose}>Cancel</Button>
            <Button variant="primary" size="sm" testId="presentation-results-confirm" onclick={() => onconfirm(draft)}>Use selected</Button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
