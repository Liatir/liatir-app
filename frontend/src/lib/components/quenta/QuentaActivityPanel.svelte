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
  let trackedRequestId = '';
  let collapsedForAnswer = false;
  let clock = $state(Date.now());

  const reasoning = $derived(sanitizeQuentaReasoning(active?.reasoning ?? generation?.reasoning ?? ''));
  const durationMs = $derived(active ? Math.max(0, clock - active.startedAt) : generation?.durationMs);
  const steps = $derived(activitySteps(active, generation, intent));
  const statusLabel = $derived(activityLabel(active, generation, intent, durationMs));
  const isActive = $derived(Boolean(active));

  onMount(() => {
    const timer = window.setInterval(() => {
      if (active) clock = Date.now();
    }, 1_000);
    return () => window.clearInterval(timer);
  });

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
      case 'validating-report': return 4;
      case 'repairing-report': return 5;
      case 'finalizing-report': return 6;
      case 'stopping': return 7;
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
        label: currentIntent === 'report' ? 'Drafted the structured report' : 'Generated the response',
        status: 'complete',
      });
      if (currentIntent === 'report') {
        finished.push({ id: 'validation', label: 'Validated the report structure', status: 'complete' });
        if (completed.reportRepairAttempted) {
          finished.push({ id: 'repair', label: 'Repaired the report format', status: 'complete' });
        }
      }
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
        label: currentIntent === 'report' ? 'Drafting the structured report' : 'Writing the response',
        status: currentPhase > 3 ? 'complete' : 'active',
      });
    }
    if (currentIntent === 'report' && currentPhase >= 4) {
      activeSteps.push({
        id: 'validation',
        label: 'Validating the report structure',
        status: currentPhase > 4 ? 'complete' : 'active',
      });
    }
    if (currentIntent === 'report' && current.reportRepairAttempted) {
      activeSteps.push({
        id: 'repair',
        label: 'Repairing the report format',
        status: currentPhase > 5 ? 'complete' : 'active',
      });
    }
    if (currentIntent === 'report' && currentPhase >= 6) {
      activeSteps.push({ id: 'finalizing', label: 'Finalizing the report', status: 'active' });
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
        case 'writing-response': return currentIntent === 'report' ? 'Drafting report' : 'Writing response';
        case 'validating-report': return 'Validating report';
        case 'repairing-report': return 'Repairing report format';
        case 'finalizing-report': return 'Finalizing report';
        case 'stopping': return 'Stopping…';
      }
    }
    const elapsed = formatDuration(duration);
    if (completed?.reasoningDurationMs !== undefined) {
      const reasoningElapsed = formatDuration(completed.reasoningDurationMs);
      return reasoningElapsed ? `Information reviewed in ${reasoningElapsed}` : 'Information reviewed';
    }
    if (currentIntent === 'report') return elapsed ? `Report prepared in ${elapsed}` : 'Report prepared';
    return elapsed ? `Response prepared in ${elapsed}` : 'Response prepared';
  }
</script>

<div
  class="max-w-3xl text-zinc-500"
  data-testid="quenta-activity"
  data-state={isActive ? 'active' : 'complete'}
  data-request-id={active?.requestId}
>
  <button
    type="button"
    class="group flex items-center gap-2 rounded-lg py-1 pr-2 text-left transition hover:text-zinc-700"
    onclick={() => expanded = !expanded}
    aria-expanded={expanded}
    data-testid="quenta-activity-toggle"
  >
    <span class="flex h-6 w-6 items-center justify-center rounded-full {isActive ? 'bg-brand/10 text-brand' : 'bg-surface-2 text-zinc-500'}">
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
      class="h-3.5 w-3.5 text-zinc-400 transition-transform {expanded ? 'rotate-180' : ''}"
    />
  </button>

  {#if expanded}
    <div class="ml-3 mt-1 space-y-3 border-l border-border pl-4" data-testid="quenta-activity-steps">
      <div class="space-y-1.5">
        {#each steps as step (step.id)}
          <div
            class="flex items-center gap-2 text-[11px] leading-5 {step.status === 'active' ? 'text-zinc-700' : 'text-zinc-400'}"
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
          class="max-h-64 overflow-y-auto whitespace-pre-wrap border-l-2 border-brand/20 pl-3 text-xs leading-relaxed text-zinc-500"
          data-testid="quenta-reasoning-content"
          data-selectable
          aria-live="off"
        >
          {reasoning}{#if active?.phase === 'thinking'}<span class="ml-1 inline-block h-3 w-1 animate-pulse rounded-full bg-zinc-400" data-testid="quenta-reasoning-cursor"></span>{/if}
        </div>
      {/if}

    </div>
  {/if}
</div>
