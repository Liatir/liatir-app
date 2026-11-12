<!--
  The ready-made pipelines, in a dialog opened from the Pipelines page so the user's own pipelines stay
  at the top of that page. Choosing one hands it back to the page, which creates and opens it.
-->
<script lang="ts">
  import Icon from '@iconify/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { pipelinePresets, type PipelinePreset } from '$lib/pipeline/presets';

  let { open, onclose, onuse }: {
    open: boolean;
    onclose: () => void;
    onuse: (preset: PipelinePreset) => void;
  } = $props();

  let query = $state('');
  const visible = $derived(pipelinePresets.filter((preset) => {
    const text = `${preset.name} ${preset.description} ${preset.outcome}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }));
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') onclose(); }} />

{#if open}
  <div
    role="presentation"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[2px]"
    onclick={onclose}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pipeline-presets-title"
      tabindex="-1"
      data-testid="pipeline-presets"
      class="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <p id="pipeline-presets-title" class="text-sm font-semibold text-text">Start from a preset</p>
          <p class="mt-0.5 text-xs text-text-subtle">
            Ready-made workflows with their steps already connected. You still choose your data and the scientific settings.
          </p>
        </div>
        <button type="button" aria-label="Close presets" class="text-text-subtle transition-colors hover:text-text-secondary" onclick={onclose}>
          <Icon icon="lucide:x" width="16" height="16" />
        </button>
      </div>

      <div class="border-b border-border px-5 py-3">
        <div class="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Icon icon="lucide:search" width="14" height="14" class="shrink-0 text-text-subtle" />
          <input bind:value={query} placeholder="Search presets…" class="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle" />
        </div>
      </div>

      <div class="overflow-y-auto p-5">
        {#if visible.length === 0}
          <p class="py-10 text-center text-sm text-text-muted">No preset matches this search.</p>
        {:else}
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            {#each visible as preset (preset.id)}
              <div class="flex flex-col rounded-xl border border-brand/20 bg-brand/3 p-4" data-testid="pipeline-preset-card" data-preset-id={preset.id}>
                <div class="flex flex-1 items-start gap-3">
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-surface text-brand">
                    <Icon icon="lucide:microscope" width="17" height="17" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-text">{preset.name}</p>
                    <p class="mt-1 text-xs leading-relaxed text-text-muted">{preset.description}</p>
                    <p class="mt-2 text-[11px] leading-relaxed text-text-subtle"><span class="font-medium text-text-muted">Produces:</span> {preset.outcome}</p>
                    {#if preset.requiredInputs}
                      <p class="mt-1 text-[11px] leading-relaxed text-text-subtle"><span class="font-medium text-text-muted">You choose:</span> {preset.requiredInputs}</p>
                    {/if}
                    {#if preset.requirements}
                      <p class="mt-1 text-[11px] leading-relaxed text-text-subtle" data-testid="pipeline-preset-requirements"><span class="font-medium text-text-muted">Requires:</span> {preset.requirements}</p>
                    {/if}
                  </div>
                </div>
                <Button class="mt-3 self-start" variant="secondary" size="sm" onclick={() => onuse(preset)}>
                  <Icon icon="lucide:workflow" width="13" height="13" />
                  Use preset
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
