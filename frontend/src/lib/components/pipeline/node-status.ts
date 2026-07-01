import type { StepStatus } from '$lib/types/pipeline';

// Single source of truth for how a pipeline node's run status is shown in the
// canvas (status dot color + human label). Shared by every node component so the
// look stays consistent.

export function statusDotClass(status: StepStatus | undefined): string {
  switch (status) {
    case 'done':    return 'bg-emerald-500';
    case 'error':   return 'bg-red-500';
    case 'running': return 'bg-brand animate-pulse';
    case 'skipped': return 'bg-zinc-200';
    default:        return 'bg-zinc-300';
  }
}

export function statusLabel(status: StepStatus | undefined): string {
  switch (status) {
    case 'running': return 'Running…';
    case 'done':    return 'Done';
    case 'error':   return 'Error';
    case 'skipped': return 'Skipped';
    default:        return 'Pending';
  }
}
