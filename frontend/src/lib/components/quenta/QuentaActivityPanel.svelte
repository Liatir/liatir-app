<!--
	Shows what Quenta is doing while it thinks.

	A local model can take a long while to answer, and a silent spinner tells the user nothing about whether
	it is working, stuck, or nearly done. So the phases are surfaced — reading context, selecting sources,
	generating — with a running clock, which turns dead waiting time into visible progress.

	The reasoning text is passed through `sanitizeQuentaReasoning` before display. That matters: a model's
	chain-of-thought is *unfiltered* output, and it is being rendered into the app's own UI.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@iconify/svelte';
  import type { LiatirQuentaGenerationTrace, LiatirQuentaIntent } from '@liatir/core';
  import type { QuentaActiveResponse, QuentaGenerationPhase } from '$lib/stores/quenta.svelte';
  import { sanitizeQuentaReasoning } from '$lib/quenta/reasoning-safety';

  interface ActivityStep {
    id: string;
    label: string;
    status: 'active' | 'complete';
  }

  interface Props {
    active?: QuentaActiveResponse | null;
    generation?: LiatirQuentaGenerationTrace | null;
    intent: LiatirQuentaIntent;
  }

  let { active = null, generation = null, intent }: Props = $props();
  let expanded = $state(false);
  // Not $state: these track *which* request the auto-expand/collapse has already reacted to. Nothing
  // renders them, and making them reactive would re-trigger the effect below on every write.
  let trackedRequestId = '';
  let collapsedForAnswer = false;
  /** Ticked once a second so the elapsed-time display advances while a request is in flight. */
  let clock = $state(Date.now());

  const reasoning = $derived(sanitizeQuentaReasoning(active?.reasoning ?? generation?.reasoning ?? ''));
  const durationMs = $derived(active ? Math.max(0, clock - active.startedAt) : generation?.durationMs);
  const steps = $derived(activitySteps(active, generation, intent));
  const statusLabel = $derived(activityLabel(active, generation, intent, durationMs));
  const isActive = $derived(Boolean(active));

  onMount(() => {
    // The clock only advances while a request is running, so an idle panel does not re-render every second.
    const timer = window.setInterval(() => {
      if (active) clock = Date.now();
    }, 1_000);
    return () => window.clearInterval(timer);
  });

  /**
   * Opens the panel when a new request starts, and closes it once the answer begins arriving.
   *
   * That is the whole interaction: the activity is what the user wants to watch *while waiting*, and the
   * answer is what they want to read once it comes — so the panel gets out of the way on its own rather
   * than requiring a click.
   *
   * `trackedRequestId` and `collapsedForAnswer` make each transition fire once. Without them this effect
   * would keep re-expanding the panel every time it re-ran, overriding a user who had collapsed it by hand.
   */
  $effect(() => {
    const requestId = active?.requestId ?? '';
    if (requestId && requestId !== trackedRequestId) {
      trackedRequestId = requestId;
      collapsedForAnswer = false;
      expanded = true;
    }
    if (active?.answerStartedAt && !collapsedForAnswer) {
      collapsedForAnswer = true;
      expanded = false;
    }
  });

  function phaseIndex(phase: QuentaGenerationPhase): number {
    switch (phase) {
      case 'reading-context': return 0;
      case 'selecting-sources': return 1;
      case 'thinking': return 2;
      case 'writing-response': return 3;
      case 'stopping': return 4;
    }
  }

  function stepStatus(currentPhase: QuentaGenerationPhase, stepPhase: number): 'active' | 'complete' {
    return phaseIndex(currentPhase) > stepPhase ? 'complete' : 'active';
  }

  function countLabel(count: number | undefined, singular: string, plural: string): string {
    if (count === undefined) return plural;
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function activitySteps(
    current: QuentaActiveResponse | null,
    completed: LiatirQuentaGenerationTrace | null,
    currentIntent: LiatirQuentaIntent,
  ): ActivityStep[] {
    if (!current) {
      if (!completed) return [];
      const finished: ActivityStep[] = [
        {
          id: 'context',
          label: `Read ${countLabel(completed.contextDocumentCount, 'local context item', 'local context items')}`,
          status: 'complete',
        },
        {
          id: 'sources',
          label: `Selected ${countLabel(completed.sourceCount, 'relevant source', 'relevant sources')}`,
          status: 'complete',
        },
      ];
      if (completed.reasoningDurationMs !== undefined) {
        finished.push({ id: 'reasoning', label: 'Reviewed the selected information', status: 'complete' });
      }
      finished.push({
        id: 'response',
        label: 'Generated the response',
        status: 'complete',
      });
      return finished;
    }

    if (current.phase === 'stopping') {
      return [{ id: 'stopping', label: 'Stopping the local model', status: 'active' }];
    }

    const currentPhase = phaseIndex(current.phase);
    const activeSteps: ActivityStep[] = [
      {
        id: 'context',
        label: current.contextDocumentCount === undefined
          ? 'Reading local context'
          : `Read ${countLabel(current.contextDocumentCount, 'local context item', 'local context items')}`,
        status: stepStatus(current.phase, 0),
      },
    ];
    if (currentPhase >= 1) {
      activeSteps.push({
        id: 'sources',
        label: current.sourceCount === undefined
          ? 'Selecting relevant sources'
          : `Selected ${countLabel(current.sourceCount, 'relevant source', 'relevant sources')}`,
        status: stepStatus(current.phase, 1),
      });
    }
    const hasReasoningStep = current.thinkingEnabled;
    if (currentPhase >= 2 && hasReasoningStep) {
      activeSteps.push({
        id: 'reasoning',
        label: 'Reviewing the selected information',
        status: current.phase === 'thinking' ? 'active' : 'complete',
      });
    }
    if (currentPhase >= 3 || (currentPhase >= 2 && !hasReasoningStep)) {
      activeSteps.push({
        id: 'response',
        label: 'Writing the response',
        status: currentPhase > 3 ? 'complete' : 'active',
      });
    }
    return activeSteps;
  }

  function formatDuration(duration: number | undefined): string {
    if (duration === undefined) return '';
    if (duration < 1_000) return '<1s';
    return `${Math.max(1, Math.round(duration / 1_000))}s`;
  }

  function activityLabel(
    current: QuentaActiveResponse | null,
    completed: LiatirQuentaGenerationTrace | null,
    currentIntent: LiatirQuentaIntent,
    duration: number | undefined,
  ): string {
    if (current) {
      switch (current.phase) {
        case 'reading-context': return 'Reading local context';
        case 'selecting-sources': return 'Selecting relevant evidence';
        case 'thinking': return 'Reviewing information';
        case 'writing-response': return 'Writing response';
        case 'stopping': return 'Stopping…';
      }
    }
    const elapsed = formatDuration(duration);
    if (completed?.reasoningDurationMs !== undefined) {
      const reasoningElapsed = formatDuration(completed.reasoningDurationMs);
      return reasoningElapsed ? `Information reviewed in ${reasoningElapsed}` : 'Information reviewed';
    }
    return elapsed ? `Response prepared in ${elapsed}` : 'Response prepared';
  }
</script>

<div
  class="max-w-3xl text-text-muted"
  data-testid="quenta-activity"
  data-state={isActive ? 'active' : 'complete'}
  data-request-id={active?.requestId}
>
  <button
    type="button"
    class="group flex items-center gap-2 rounded-lg py-1 pr-2 text-left transition hover:text-text-secondary"
    onclick={() => expanded = !expanded}
    aria-expanded={expanded}
    data-testid="quenta-activity-toggle"
  >
    <span class="flex h-6 w-6 items-center justify-center rounded-full {isActive ? 'bg-brand/10 text-brand' : 'bg-surface-2 text-text-muted'}">
      {#if isActive}
        <Icon icon="lucide:loader-circle" class="h-3.5 w-3.5 animate-spin" />
      {:else}
        <Icon icon="lucide:brain" class="h-3.5 w-3.5" />
      {/if}
    </span>
    <span class="text-xs font-medium" role="status" aria-live="polite" data-testid="quenta-activity-status">
      {statusLabel}
    </span>
    <Icon
      icon="lucide:chevron-down"
      class="h-3.5 w-3.5 text-text-subtle transition-transform {expanded ? 'rotate-180' : ''}"
    />
  </button>

  {#if expanded}
    <div class="ml-3 mt-1 space-y-3 border-l border-border pl-4" data-testid="quenta-activity-steps">
      <div class="space-y-1.5">
        {#each steps as step (step.id)}
          <div
            class="flex items-center gap-2 text-[11px] leading-5 {step.status === 'active' ? 'text-text-secondary' : 'text-text-subtle'}"
            data-testid="quenta-activity-step"
            data-phase={step.id}
            data-status={step.status}
          >
            {#if step.status === 'complete'}
              <Icon icon="lucide:check" class="h-3 w-3 shrink-0 text-emerald-500" />
            {:else}
              <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand animate-pulse"></span>
            {/if}
            <span>{step.label}</span>
          </div>
        {/each}
      </div>

      {#if reasoning}
        <div
          class="max-h-64 overflow-y-auto whitespace-pre-wrap border-l-2 border-brand/20 pl-3 text-xs leading-relaxed text-text-muted"
          data-testid="quenta-reasoning-content"
          data-selectable
          aria-live="off"
        >
          {reasoning}{#if active?.phase === 'thinking'}<span class="ml-1 inline-block h-3 w-1 animate-pulse rounded-full bg-text-subtle" data-testid="quenta-reasoning-cursor"></span>{/if}
        </div>
      {/if}

    </div>
  {/if}
</div>
