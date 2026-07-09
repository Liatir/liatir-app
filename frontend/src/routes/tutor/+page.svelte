<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { liatir } from '$lib/api';
  import { tutorReportToMarkdown } from '$lib/tutor/report';
  import { tutorStore } from '$lib/stores/tutor.svelte';
  import type {
    LiatirTutorConversation,
    LiatirTutorFocus,
    LiatirTutorIntent,
    LiatirTutorMessage,
  } from '@liatir/core';

  let draft = $state('');
  let selectedIntent = $state<LiatirTutorIntent>('chat');
  let baseUrlDraft = $state('http://127.0.0.1:11434');
  let modelDraft = $state('');
  let embeddingModelDraft = $state('');
  let temperatureDraft = $state(0.2);
  let savingSettings = $state(false);
  let handledDeepLink = $state<string | null>(null);

  const currentConversation = $derived(tutorStore.currentConversation);
  const currentError = $derived(tutorStore.errorFor(currentConversation?.id));
  const sending = $derived(tutorStore.isSending(currentConversation?.id));
  const modelOptions = $derived([...new Map([
    ...(tutorStore.config.model ? [[tutorStore.config.model, tutorStore.config.model] as const] : []),
    ...tutorStore.providerModels.map((model) => [model.name, model.name] as const),
  ]).values()]);

  function syncSettingsDrafts() {
    baseUrlDraft = tutorStore.config.baseUrl;
    modelDraft = tutorStore.config.model;
    embeddingModelDraft = tutorStore.config.embeddingModel ?? '';
    temperatureDraft = tutorStore.config.temperature;
  }

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function intentFromParam(value: string | null): LiatirTutorIntent {
    if (value === 'explain-result' || value === 'explain-failure' || value === 'report') return value;
    return 'chat';
  }

  function focusFromUrl(): LiatirTutorFocus | null {
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
      await tutorStore.startFocusedConversation(intent, focus, true);
      return;
    }
    await tutorStore.startFocusedConversation(intent, focus, false);
  }

  async function saveSettings() {
    savingSettings = true;
    try {
      await tutorStore.updateConfig({
        baseUrl: baseUrlDraft,
        model: modelDraft,
        embeddingModel: embeddingModelDraft,
        temperature: temperatureDraft,
      });
      await tutorStore.refreshProvider();
      syncSettingsDrafts();
    } finally {
      savingSettings = false;
    }
  }

  async function refreshProvider() {
    await tutorStore.refreshProvider();
    syncSettingsDrafts();
  }

  async function sendDraft() {
    const content = draft.trim();
    if (!content) return;
    const conversation = currentConversation;
    draft = '';
    await tutorStore.sendMessage(content, selectedIntent, {
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

  async function exportReport(message: LiatirTutorMessage) {
    if (!message.report) return;
    const api = liatir();
    if (!api) return;
    const safeTitle = message.report.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'tutor-report';
    const dest = await api.desktop.files.save(`liatir-${safeTitle}.md`);
    if (!dest) return;
    await api.invoke('lia_write_file_path', {
      path: dest,
      content: tutorReportToMarkdown(message.report),
    } as any);
  }

  function conversationSubtitle(conversation: LiatirTutorConversation): string {
    const focus = conversation.focus ? `${conversation.focus.kind} ${conversation.focus.entityId}` : 'General context';
    return `${focus} · ${formatTime(conversation.updatedAt)}`;
  }

  onMount(async () => {
    await tutorStore.init();
    syncSettingsDrafts();
    await tutorStore.refreshProvider();
    syncSettingsDrafts();
    await handleDeepLink();
  });
</script>

<div class="flex h-full overflow-hidden">
  <aside class="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
    <div class="border-b border-border p-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-xs font-semibold text-zinc-800">Local Tutor</p>
          <p class="mt-0.5 text-[10px] text-zinc-400">Read-only Ollama assistant</p>
        </div>
        <Button variant="ghost" size="sm" onclick={() => tutorStore.newConversation()}>
          New
        </Button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      {#if tutorStore.conversations.length === 0}
        <p class="px-3 py-8 text-center text-xs leading-relaxed text-zinc-400">
          No conversations yet. Ask a question or explain a Result to start.
        </p>
      {:else}
        <div class="space-y-1">
          {#each tutorStore.conversations as conversation (conversation.id)}
            <button
              class="w-full rounded-lg px-3 py-2 text-left transition-colors {conversation.id === tutorStore.selectedConversationId ? 'bg-brand/10 text-brand' : 'text-zinc-600 hover:bg-surface-2'}"
              data-testid="tutor-conversation"
              onclick={() => tutorStore.selectConversation(conversation.id)}
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
      title="Local Tutor"
      description="Ask local, read-only questions about Liatir, workspace state, Results, Jobs, pipelines, and bioinformatics context"
    >
      {#snippet actions()}
        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-[10px] font-medium {tutorStore.providerStatus?.available ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-500'}"
            data-testid="tutor-provider-status"
          >
            {tutorStore.providerStatus?.available ? `Ollama ${tutorStore.providerStatus.version ?? ''}` : 'Ollama offline'}
          </span>
          <Button variant="ghost" size="sm" onclick={refreshProvider} loading={tutorStore.providerRefreshing}>
            Refresh
          </Button>
        </div>
      {/snippet}
    </PageHeader>

    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] overflow-hidden">
      <section class="flex min-w-0 flex-col overflow-hidden">
        {#if !currentConversation}
          <div class="flex h-full items-center justify-center p-8">
            <EmptyState
              title="No Tutor conversation selected"
              description="Start a conversation, explain a Result, or generate a report from the Results page."
            />
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto p-6" data-testid="tutor-transcript">
            <div class="mx-auto max-w-4xl space-y-4">
              {#each currentConversation.messages as message (message.id)}
                <Card class={message.role === 'assistant' ? 'bg-white' : 'bg-brand/5 border-brand/15'}>
                  <div class="space-y-3 p-4">
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <p class="text-xs font-semibold uppercase tracking-wide {message.role === 'assistant' ? 'text-zinc-500' : 'text-brand'}">
                          {message.role === 'assistant' ? 'Tutor' : 'You'}
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
                <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="tutor-error">
                  {currentError}
                </div>
              {/if}
            </div>
          </div>

          <div class="border-t border-border bg-surface p-4">
            <div class="mx-auto max-w-4xl">
              <div class="mb-2 flex items-center gap-2">
                <select
                  class="rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700"
                  value={selectedIntent}
                  onchange={(event) => selectedIntent = (event.currentTarget as HTMLSelectElement).value as LiatirTutorIntent}
                  disabled={sending}
                >
                  <option value="chat">Tutor answer</option>
                  <option value="explain-result">Explain result</option>
                  <option value="explain-failure">Explain failure</option>
                  <option value="report">Structured report</option>
                </select>
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
                data-testid="tutor-input"
              ></textarea>
              <div class="mt-2 flex items-center justify-between gap-3">
                <p class="text-[10px] text-zinc-400">
                  The Tutor is advisory only. It cannot run tools, pipelines, API calls, Plugins, shell commands, or mutate workspace state.
                </p>
                <Button variant="primary" size="sm" onclick={sendDraft} loading={sending} disabled={!draft.trim() || !tutorStore.config.model}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </section>

      <aside class="overflow-y-auto border-l border-border bg-surface p-4">
        <div class="space-y-4">
          <Card>
            <div class="space-y-3 p-4">
              <div>
                <p class="text-sm font-semibold text-zinc-800">Ollama settings</p>
                <p class="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                  Only loopback HTTP endpoints are accepted by the native bridge.
                </p>
              </div>

              <label class="block">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Base URL</span>
                <input
                  class="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                  bind:value={baseUrlDraft}
                  placeholder="http://127.0.0.1:11434"
                />
              </label>

              <label class="block">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Chat model</span>
                <select
                  class="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                  bind:value={modelDraft}
                >
                  <option value="">Select a local model</option>
                  {#each modelOptions as model}
                    <option value={model}>{model}</option>
                  {/each}
                </select>
              </label>

              <label class="block">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Embedding model (optional)</span>
                <input
                  class="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                  bind:value={embeddingModelDraft}
                  placeholder="nomic-embed-text"
                />
              </label>

              <label class="block">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Temperature</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                  bind:value={temperatureDraft}
                />
              </label>

              {#if tutorStore.providerStatus?.error}
                <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                  {tutorStore.providerStatus.error}
                </p>
              {/if}

              <div class="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onclick={refreshProvider} loading={tutorStore.providerRefreshing}>
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
              <p class="text-sm font-semibold text-zinc-800">Trust boundary</p>
              <ul class="space-y-1 text-[11px] leading-relaxed text-zinc-500">
                <li>• Local Ollama only.</li>
                <li>• No tool calls are sent to the model.</li>
                <li>• Retrieved logs and results are treated as data, not instructions.</li>
                <li>• Reports must cite local sources and state limitations.</li>
              </ul>
            </div>
          </Card>
        </div>
      </aside>
    </div>
  </main>
</div>
