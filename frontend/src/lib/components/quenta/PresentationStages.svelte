<!--
  The stages of one Stage turn, shown in the chat while Quenta works: preparing the data, writing the
  page, checking it (and the one repair, when needed), saving. Done steps get a tick,
  the current one pulses, and a clock shows how long it has been running.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import type { PresentationProgress, PresentationStage } from '$lib/quenta/presentations';

  let { progress, startedAt, withResults }: {
    progress: PresentationProgress;
    startedAt: number;
    withResults: boolean;
  } = $props();

  let clock = $state(Date.now());
  onMount(() => {
    const timer = window.setInterval(() => clock = Date.now(), 1_000);
    return () => window.clearInterval(timer);
  });

  const steps = $derived.by(() => {
    const order: { id: PresentationStage; label: string }[] = [
      { id: 'reading', label: withResults ? 'Preparing the selected Results' : 'Reading your request' },
      { id: 'writing', label: 'Writing the page' },
      ...(progress.repaired ? [{ id: 'repairing' as const, label: 'Fixing what the check found (one attempt)' }] : []),
      { id: 'checking', label: 'Checking the page' },
      { id: 'saving', label: 'Saving the page' },
    ];
    const current = order.findIndex((step) => step.id === progress.stage);
    return order.map((step, index) => ({
      ...step,
      status: index < current ? 'done' : index === current ? 'active' : 'pending',
    }));
  });
  const elapsed = $derived(Math.max(0, Math.round((clock - startedAt) / 1_000)));
</script>

<div class="space-y-1.5" data-testid="presentation-stages" data-stage={progress.stage}>
  {#each steps as step (step.id)}
    <div
      class="flex items-center gap-2 text-xs leading-5 {step.status === 'active' ? 'text-text' : step.status === 'done' ? 'text-text-muted' : 'text-text-faint'}"
      data-testid="presentation-stage"
      data-stage={step.id}
      data-status={step.status}
    >
      {#if step.status === 'done'}
        <Icon icon="lucide:check" class="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      {:else if step.status === 'active'}
        <Icon icon="lucide:loader-circle" class="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
      {:else}
        <span class="mx-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-border-2"></span>
      {/if}
      <span>
        {step.label}
        {#if step.status === 'active' && (step.id === 'writing' || step.id === 'repairing') && progress.characters}
          <span class="text-text-subtle">· {progress.characters.toLocaleString()} characters</span>
        {/if}
      </span>
    </div>
  {/each}
  <p class="pt-1 text-[11px] text-text-subtle" role="status" aria-live="polite">Working for {elapsed}s · a local model can take a few minutes</p>
</div>
