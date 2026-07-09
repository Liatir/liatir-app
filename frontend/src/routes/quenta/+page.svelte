<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { liatir } from '$lib/api';
  import { quentaReportToMarkdown } from '$lib/quenta/report';
  import { quentaStore } from '$lib/stores/quenta.svelte';
  import type {
    LiatirQuentaConversation,
    LiatirQuentaFocus,
    LiatirQuentaIntent,
    LiatirQuentaMessage,
  } from '@liatir/core';
	import { HEADER_HEIGHT } from '$lib/_constants';

  let draft = $state('');
  let selectedIntent = $state<LiatirQuentaIntent>('chat');
  let baseUrlDraft = $state('http://127.0.0.1:11434');
  let modelDraft = $state('');
  let embeddingModelDraft = $state('');
  let temperatureDraft = $state(0.2);
  let savingSettings = $state(false);
  let handledDeepLink = $state<string | null>(null);
  let settingsCollapsed = $state(true);

  const currentConversation = $derived(quentaStore.currentConversation);
  const currentError = $derived(quentaStore.errorFor(currentConversation?.id));
  const sending = $derived(quentaStore.isSending(currentConversation?.id));
  const modelOptions = $derived([...new Map([
    ...(quentaStore.config.model ? [[quentaStore.config.model, quentaStore.config.model] as const] : []),
    ...quentaStore.providerModels.map((model) => [model.name, model.name] as const),
  ]).values()]);
  const modelSelectOptions = $derived(modelOptions.map((model) => ({
    value: model,
    label: model,
  })));
  const intentOptions = [
    {
      value: 'chat',
      label: 'Ask Quenta',
      description: 'Ask a question using the current workspace context.',
    },
    {
      value: 'explain-result',
      label: 'Explain result',
      description: 'Summarize observed outputs, limitations, and validation steps.',
    },
    {
      value: 'explain-failure',
      label: 'Explain failure',
      description: 'Interpret status, logs, and likely causes without running anything.',
    },
    {
      value: 'report',
      label: 'Structured report',
      description: 'Generate a cited scientific report from local evidence.',
    },
  ];

  function syncSettingsDrafts() {
    baseUrlDraft = quentaStore.config.baseUrl;
    modelDraft = quentaStore.config.model;
    embeddingModelDraft = quentaStore.config.embeddingModel ?? '';
    temperatureDraft = quentaStore.config.temperature;
  }

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function intentFromParam(value: string | null): LiatirQuentaIntent {
    if (value === 'explain-result' || value === 'explain-failure' || value === 'report') return value;
    return 'chat';
  }

  function focusFromUrl(): LiatirQuentaFocus | null {
    const runId = page.url.searchParams.get('run');
    if (runId) return { kind: 'result', entityId: runId };
    const jobId = page.url.searchParams.get('job');
    if (jobId) return { kind: 'job', entityId: jobId };
    return null;
  }

  async function handleDeepLink() {
    const key = page.url.searchParams.toString();
    if (!key || handledDeepLink === key) return;
    handledDeepLink = key;
    const focus = focusFromUrl();
    if (!focus) return;
    const intent = intentFromParam(
      page.url.searchParams.get('intent') ?? page.url.searchParams.get('mode'),
    );
    selectedIntent = intent;
    const autoSend = page.url.searchParams.get('auto') === '1';
    if (autoSend) {
      await quentaStore.startFocusedConversation(intent, focus, true);
      return;
    }
    await quentaStore.startFocusedConversation(intent, focus, false);
  }

  async function saveSettings() {
    savingSettings = true;
    try {
      await quentaStore.updateConfig({
        baseUrl: baseUrlDraft,
        model: modelDraft,
        embeddingModel: embeddingModelDraft,
        temperature: temperatureDraft,
      });
      await quentaStore.refreshProvider();
      syncSettingsDrafts();
    } finally {
      savingSettings = false;
    }
  }

  async function refreshProvider() {
    await quentaStore.refreshProvider();
    syncSettingsDrafts();
  }

  async function sendDraft() {
    const content = draft.trim();
    if (!content) return;
    const conversation = currentConversation;
    draft = '';
    await quentaStore.sendMessage(content, selectedIntent, {
      conversationId: conversation?.id,
      focus: conversation?.focus,
    });
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void sendDraft();
    }
  }

  async function exportReport(message: LiatirQuentaMessage) {
    if (!message.report) return;
    const api = liatir();
    if (!api) return;
    const safeTitle = message.report.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'quenta-report';
    const dest = await api.desktop.files.save(`liatir-${safeTitle}.md`);
    if (!dest) return;
    await api.invoke('lia_write_file_path', {
      path: dest,
      content: quentaReportToMarkdown(message.report),
    } as any);
  }

  function conversationSubtitle(conversation: LiatirQuentaConversation): string {
    const focus = conversation.focus ? `${conversation.focus.kind} ${conversation.focus.entityId}` : 'General context';
    return `${focus} · ${formatTime(conversation.updatedAt)}`;
  }

  onMount(async () => {
    await quentaStore.init();
    syncSettingsDrafts();
    await quentaStore.refreshProvider();
    syncSettingsDrafts();
    await handleDeepLink();
  });
</script>

<div class="flex h-full overflow-hidden">
  <aside class="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
    <div class="border-b border-border p-3" style="height: {HEADER_HEIGHT}px;">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-xs font-semibold text-zinc-800">Quenta</p>
          <p class="mt-0.5 text-[10px] text-zinc-400">Local read-only AI</p>
        </div>
        <Button variant="ghost" size="sm" onclick={() => quentaStore.newConversation()}>
          New
        </Button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-2">
      {#if quentaStore.conversations.length === 0}
        <p class="px-3 py-8 text-center text-xs leading-relaxed text-zinc-400">
          No conversations yet. Ask a question or explain a Result to start.
        </p>
      {:else}
        <div class="space-y-1">
          {#each quentaStore.conversations as conversation (conversation.id)}
            <button
              class="w-full rounded-lg px-3 py-2 text-left transition-colors {conversation.id === quentaStore.selectedConversationId ? 'bg-brand/10 text-brand' : 'text-zinc-600 hover:bg-surface-2'}"
              data-testid="quenta-conversation"
              onclick={() => quentaStore.selectConversation(conversation.id)}
            >
              <p class="truncate text-xs font-medium">{conversation.title}</p>
              <p class="mt-0.5 truncate text-[10px] text-zinc-400">{conversationSubtitle(conversation)}</p>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col">
    <PageHeader
      title="Quenta"
      description="Quenta is Liatir's local, read-only AI for explaining Results, Jobs, pipelines, and bioinformatics context."
    >
      {#snippet actions()}
        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-[10px] font-medium {quentaStore.providerStatus?.available ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'}"
            data-testid="quenta-provider-status"
          >
            {quentaStore.providerStatus?.available ? `Ollama ${quentaStore.providerStatus.version ?? ''}` : 'Ollama offline'}
          </span>
          <Button variant="ghost" size="sm" onclick={refreshProvider} loading={quentaStore.providerRefreshing}>
            Refresh
          </Button>
        </div>
      {/snippet}
    </PageHeader>

    <div class={settingsCollapsed
      ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_3.5rem] overflow-hidden'
      : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] overflow-hidden'}
    >
      <section class="flex min-w-0 flex-col overflow-hidden">
        {#if !currentConversation}
          <div class="flex h-full items-center justify-center p-8">
            <EmptyState
              title="No Quenta conversation selected"
              description="Start a conversation, explain a Result, or generate a cited report from local workspace evidence."
            />
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto p-6" data-testid="quenta-transcript">
            <div class="mx-auto max-w-4xl space-y-4">
              {#each currentConversation.messages as message (message.id)}
                <Card class={message.role === 'assistant' ? 'bg-white' : 'bg-brand/5 border-brand/15'}>
                  <div class="space-y-3 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="text-xs font-semibold uppercase tracking-wide {message.role === 'assistant' ? 'text-zinc-500' : 'text-brand'}">
                          {message.role === 'assistant' ? 'Quenta' : 'You'}
                        </p>
                        <p class="mt-0.5 text-[10px] text-zinc-400">
                          {formatTime(message.createdAt)}
                          {message.model ? ` · ${message.model}` : ''}
                        </p>
                      </div>
                      {#if message.report}
                        <Button variant="ghost" size="sm" onclick={() => exportReport(message)}>
                          Export report
                        </Button>
                      {/if}
                    </div>
                    <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-800" data-selectable>{message.content}</pre>

                    {#if message.citations?.length}
                      <div class="border-t border-border pt-3">
                        <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Sources
                        </p>
                        <div class="grid gap-2 md:grid-cols-2">
                          {#each message.citations as citation (citation.id)}
                            <div class="rounded-lg border border-border bg-surface-2 px-3 py-2">
                              <p class="truncate text-[11px] font-semibold text-zinc-700">[{citation.id}] {citation.title}</p>
                              <p class="truncate text-[10px] text-zinc-400">{citation.locator}</p>
                              {#if citation.excerpt}
                                <p class="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{citation.excerpt}</p>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </Card>
              {/each}

              {#if sending}
                <div class="flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-xs text-zinc-500">
                  <Spinner />
                  The local model is generating a response...
                </div>
              {/if}

              {#if currentError}
                <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="quenta-error">
                  {currentError}
                </div>
              {/if}
            </div>
          </div>

          <div class="border-t border-border bg-surface p-4">
            <div class="mx-auto max-w-4xl">
              <div class="mb-2 flex items-center gap-2">
                <Select
                  value={selectedIntent}
                  options={intentOptions}
                  onchange={(value) => selectedIntent = value as LiatirQuentaIntent}
                  disabled={sending}
                  placeholder="Choose task"
                  class="w-52"
                  searchable={false}
                />
                {#if currentConversation.focus}
                  <span class="rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500">
                    Focus: {currentConversation.focus.kind} {currentConversation.focus.entityId}
                  </span>
                {/if}
              </div>
              <textarea
                class="min-h-24 w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand"
                placeholder="Ask about a result, job log, pipeline, AI model, API Connector request, or bioinformatics concept. Press Cmd/Ctrl+Enter to send."
                bind:value={draft}
                onkeydown={handleComposerKeydown}
                disabled={sending}
                data-testid="quenta-input"
              ></textarea>
              <div class="mt-2 flex items-center justify-between gap-3">
                <p class="text-[10px] text-zinc-400">
                  Quenta is advisory only. It cannot run tools, pipelines, API calls, Plugins, shell commands, or mutate workspace state.
                </p>
                <Button variant="primary" size="sm" onclick={sendDraft} loading={sending} disabled={!draft.trim() || !quentaStore.config.model}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </section>

      <aside class="overflow-y-auto border-l border-border bg-surface {settingsCollapsed ? 'p-2' : 'p-4'}">
        {#if settingsCollapsed}
          <div class="flex h-full items-start justify-center pt-2">
            <button
              type="button"
              class="flex h-32 w-9 items-center justify-center rounded-xl border border-border bg-white text-[10px] font-semibold uppercase tracking-wider text-zinc-500 shadow-sm transition hover:border-brand hover:text-brand"
              onclick={() => settingsCollapsed = false}
              aria-label="Show AI settings"
              title="Show AI settings"
              data-testid="quenta-settings-expand"
            >
              <span style="writing-mode: vertical-rl;">AI settings</span>
            </button>
          </div>
        {:else}
          <div class="space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-zinc-800">Local AI settings</p>
                <p class="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Quenta uses Ollama running on this computer to write answers and reports. Your workspace context stays local.
                </p>
              </div>
              <Button variant="ghost" size="sm" onclick={() => settingsCollapsed = true}>
                Collapse
              </Button>
            </div>

            <Card>
              <div class="space-y-3 p-4">
                <div>
                  <p class="text-sm font-semibold text-zinc-800">Connection</p>
                  <p class="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                    Most users can keep the default address. Change it only if Ollama is running locally on a different port.
                  </p>
                </div>

                <div>
                  <LabelWithInfo
                    text="Ollama address"
                    targetId="quenta-base-url"
                    info="This is where Quenta reaches your local Ollama server. Liatir only accepts localhost or loopback HTTP addresses here, so this setting cannot point Quenta at a remote cloud service."
                  />
                  <input
                    id="quenta-base-url"
                    class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                    bind:value={baseUrlDraft}
                    placeholder="http://127.0.0.1:11434"
                  />
                </div>

                <div>
                  <LabelWithInfo
                    text="Answer model"
                    info="The local language model Quenta uses to write explanations and reports. If no model appears, start Ollama and install a chat model first."
                  />
                  <Select
                    value={modelDraft}
                    options={modelSelectOptions}
                    onchange={(value) => modelDraft = value}
                    placeholder="Select a local model"
                    emptyText="No local models found"
                    searchable={true}
                  />
                </div>

                <div>
                  <LabelWithInfo
                    text="Retrieval model"
                    targetId="quenta-embedding-model"
                    info="Optional. This model will be used later for semantic search over local context. Quenta can still use deterministic local retrieval when this field is empty."
                  />
                  <input
                    id="quenta-embedding-model"
                    class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                    bind:value={embeddingModelDraft}
                    placeholder="Optional, for example nomic-embed-text"
                  />
                </div>

                <div>
                  <LabelWithInfo
                    text="Creativity"
                    targetId="quenta-temperature"
                    info="Lower values make responses more consistent and conservative. Higher values may be more flexible but less predictable. Scientific reports should usually stay low."
                  />
                  <input
                    id="quenta-temperature"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                    bind:value={temperatureDraft}
                  />
                  <p class="mt-1 text-[10px] text-zinc-400">Recommended for reports: 0.1–0.3.</p>
                </div>

                {#if quentaStore.providerStatus?.error}
                  <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    {quentaStore.providerStatus.error}
                  </p>
                {/if}

                <div class="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onclick={refreshProvider} loading={quentaStore.providerRefreshing}>
                    Refresh models
                  </Button>
                  <Button variant="primary" size="sm" onclick={saveSettings} loading={savingSettings}>
                    Save
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <div class="space-y-2 p-4">
                <p class="text-sm font-semibold text-zinc-800">Safety boundary</p>
                <ul class="space-y-1 text-[11px] leading-relaxed text-zinc-500">
                  <li>• Local Ollama only.</li>
                  <li>• No tool calls are sent to the model.</li>
                  <li>• Logs, files, and results are treated as evidence, not instructions.</li>
                  <li>• Reports must cite local sources and state limitations.</li>
                </ul>
              </div>
            </Card>
          </div>
        {/if}
      </aside>
    </div>
  </main>
</div>
