<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import { mcpController } from '$lib/mcp/mcp-controller.svelte';
  import { dataFiles } from '$lib/stores/dataFiles.svelte';
  import type { LiatirMcpPipelineInputDescriptor, LiatirMcpPipelineInputValue } from '@liatir/core';

  function inputValue(
    input: LiatirMcpPipelineInputDescriptor,
    value: LiatirMcpPipelineInputValue | undefined,
  ): string {
    if (value === undefined) return 'Keep the saved pipeline value';
    if (typeof value === 'object') {
      const file = dataFiles.files.find((candidate) => candidate.id === value.artifactId);
      return file?.name ?? `Artifact ${value.artifactId}`;
    }
    const text = String(value);
    const option = input.options?.find((candidate) => candidate.value === text);
    return option ? `${option.label} (${text})` : text;
  }

  function onKeydown(event: KeyboardEvent) {
    if (!mcpController.current || mcpController.resolving) return;
    if (event.key === 'Escape') void mcpController.deny();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if mcpController.current}
  {@const request = mcpController.current}
  <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" data-testid="mcp-authorization-backdrop">
    <div
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="mcp-authorization-title"
      class="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      data-testid="mcp-authorization-dialog"
    >
      <div class="border-b border-border px-6 py-5">
        <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">External MCP request</p>
        <h2 id="mcp-authorization-title" class="mt-1 text-lg font-semibold text-text">Run this saved pipeline?</h2>
        <p class="mt-2 text-sm leading-relaxed text-text-muted">
          <span class="font-medium text-text">{request.client.name}</span>{request.client.version ? ` ${request.client.version}` : ''}
          is asking Liatir to run one exact saved revision. Nothing starts until you approve it here.
        </p>
      </div>

      <dl class="grid gap-3 px-6 py-5 text-sm">
        <div class="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <dt class="text-xs text-text-subtle">Pipeline</dt>
          <dd class="mt-0.5 font-medium text-text" data-testid="mcp-request-pipeline">{request.pipelineName}</dd>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <dt class="text-xs text-text-subtle">Workspace</dt>
            <dd class="mt-0.5 text-text-secondary">{request.workspaceName}</dd>
          </div>
          <div>
            <dt class="text-xs text-text-subtle">Run ID</dt>
            <dd class="mt-0.5 truncate font-mono text-xs text-text-secondary" title={request.runId}>{request.runId}</dd>
          </div>
        </div>
      </dl>

      <div class="mx-6 space-y-2">
        <div>
          <p class="text-xs font-medium text-text-muted">Pipeline inputs</p>
          <p class="text-[11px] text-text-subtle">Review every value the client supplied. Omitted fields keep the saved pipeline configuration.</p>
        </div>
        {#if request.inputSchema.length === 0}
          <p class="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-text-subtle">This pipeline has no run-time inputs.</p>
        {:else}
          <div class="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border" data-testid="mcp-request-inputs">
            {#each request.inputSchema as input (input.id)}
              {@const supplied = request.inputs[input.id]}
              <div class="bg-surface-2 px-4 py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-xs font-medium text-text-secondary">{input.nodeLabel} · {input.label}</p>
                    <p class="mt-0.5 text-[10px] uppercase tracking-wide text-text-subtle">{input.type}{input.required ? ' · required' : ''}</p>
                  </div>
                  <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] {supplied === undefined ? 'bg-surface text-text-subtle' : 'bg-brand/10 text-brand'}">
                    {supplied === undefined ? 'Saved' : 'From client'}
                  </span>
                </div>
                <p class="mt-1.5 break-all font-mono text-[11px] text-text" title={inputValue(input, supplied)}>{inputValue(input, supplied)}</p>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="mx-6 mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs leading-relaxed text-text-muted">
        The client can change only the inputs listed above. It cannot edit the saved pipeline, access arbitrary paths, choose undeclared scientific settings, or run shell commands. You can cancel the run later from the client or Liatir.
      </div>

      {#if mcpController.lastError}
        <p class="mx-6 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" data-testid="mcp-authorization-error">
          {mcpController.lastError}
        </p>
      {/if}

      <div class="flex items-center justify-between px-6 py-5">
        <span class="text-xs text-text-subtle">
          {mcpController.pendingCount > 1 ? `${mcpController.pendingCount - 1} more request${mcpController.pendingCount === 2 ? '' : 's'} waiting` : 'Esc denies'}
        </span>
        <div class="flex gap-2">
          <Button variant="secondary" disabled={mcpController.resolving} testId="mcp-deny" onclick={() => void mcpController.deny()}>
            Deny
          </Button>
          <Button variant="primary" loading={mcpController.resolving} testId="mcp-approve" onclick={() => void mcpController.approve()}>
            Approve and run
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}
