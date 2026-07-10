<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Card from '$lib/components/ui/Card.svelte';
  import LabelWithInfo from '$lib/components/ui/LabelWithInfo.svelte';
  import Select from '$lib/components/ui/Select.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import Icon from '@iconify/svelte';
  import { liatir } from '$lib/api';
  import { clickOutside } from '$lib/actions/clickOutside';
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
  let temperatureDraft = $state(0.1);
  let thinkingEnabledDraft = $state(false);
  let savingSettings = $state(false);
  let handledDeepLink = $state<string | null>(null);
  let settingsOpen = $state(false);
  let chatsCollapsed = $state(false);
  let conversationSearch = $state('');
  let selectedTagFilters = $state<string[]>([]);
  let editingConversationId = $state<string | null>(null);
  let renameDraft = $state('');
  let renameInputEl = $state<HTMLInputElement | null>(null);
  let editingTagsConversationId = $state<string | null>(null);
  let tagDraft = $state('');
  let tagInputEl = $state<HTMLInputElement | null>(null);
  let deleteConfirmConversationId = $state<string | null>(null);

  const currentConversation = $derived(quentaStore.currentConversation);
  const currentError = $derived(quentaStore.errorFor(currentConversation?.id));
  const sending = $derived(quentaStore.isSending(currentConversation?.id));
  const preparingQuenta = $derived(
    quentaStore.setupPhase === 'preparing'
    || quentaStore.setupPhase === 'downloading'
    || quentaStore.providerRefreshing,
  );
  const localAIReady = $derived(Boolean(
    quentaStore.providerStatus?.available
    && quentaStore.config.model
    && quentaStore.setupPhase !== 'failed',
  ));
  const quentaStatusLabel = $derived(
    localAIReady
      ? 'Quenta ready'
      : preparingQuenta
        ? 'Preparing Quenta'
        : 'Quenta needs attention',
  );
  const quentaStatusClass = $derived(
    localAIReady
      ? 'bg-emerald-50 text-emerald-600'
      : preparingQuenta
        ? 'bg-brand/10 text-brand'
        : 'bg-amber-50 text-amber-600',
  );
  const composerPlaceholder = $derived(
    localAIReady
      ? 'Ask about a result, job log, pipeline, AI model, API Connector request, or bioinformatics concept. Press Cmd/Ctrl+Enter to send.'
      : preparingQuenta
        ? `Quenta is preparing the recommended local model (${quentaStore.defaultModel}). You can chat when it is ready.`
        : 'Quenta could not prepare local AI yet. Check the setup message and refresh.',
  );
  const modelOptions = $derived([...new Map([
    ...(quentaStore.config.model ? [[quentaStore.config.model, quentaStore.config.model] as const] : []),
    ...quentaStore.providerModels.map((model) => [model.name, model.name] as const),
  ]).values()]);
  const modelSelectOptions = $derived(modelOptions.map((model) => ({
    value: model,
    label: model,
  })));
  const availableConversationTags = $derived(
    [...new Set(quentaStore.conversations.flatMap((conversation) => conversation.tags ?? []))]
      .sort((a, b) => a.localeCompare(b)),
  );
  const filteredConversations = $derived(
    quentaStore.conversations.filter((conversation) => conversationMatchesFilters(conversation)),
  );
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
    thinkingEnabledDraft = quentaStore.config.thinkingEnabled ?? false;
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
        thinkingEnabled: thinkingEnabledDraft,
      });
      await quentaStore.bootstrapProvider();
      syncSettingsDrafts();
      settingsOpen = false;
    } finally {
      savingSettings = false;
    }
  }

  async function refreshProvider() {
    await quentaStore.bootstrapProvider();
    syncSettingsDrafts();
  }

  async function setThinkingEnabled(enabled: boolean) {
    thinkingEnabledDraft = enabled;
    await quentaStore.updateConfig({ thinkingEnabled: enabled });
    syncSettingsDrafts();
  }

  async function ensureDefaultConversation() {
    if (quentaStore.conversations.length > 0 || currentConversation) return;
    await quentaStore.newConversation();
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

  function conversationMatchesFilters(conversation: LiatirQuentaConversation): boolean {
    const conversationTags = conversation.tags ?? [];
    if (selectedTagFilters.length > 0) {
      const tagSet = new Set(conversationTags.map((tag) => tag.toLocaleLowerCase()));
      if (!selectedTagFilters.every((tag) => tagSet.has(tag.toLocaleLowerCase()))) return false;
    }

    const query = conversationSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    const focus = conversation.focus ? `${conversation.focus.kind} ${conversation.focus.entityId}` : '';
    const messageText = conversation.messages.map((message) => message.content).join(' ');
    const haystack = [
      conversation.title,
      conversationTags.join(' '),
      focus,
      messageText,
    ].join(' ').toLocaleLowerCase();
    return haystack.includes(query);
  }

  function toggleTagFilter(tag: string) {
    selectedTagFilters = selectedTagFilters.includes(tag)
      ? selectedTagFilters.filter((selected) => selected !== tag)
      : [...selectedTagFilters, tag];
  }

  function resetConversationEditing() {
    editingConversationId = null;
    renameDraft = '';
    editingTagsConversationId = null;
    tagDraft = '';
    deleteConfirmConversationId = null;
  }

  async function startRenameConversation(conversation: LiatirQuentaConversation) {
    editingConversationId = conversation.id;
    renameDraft = conversation.title;
    editingTagsConversationId = null;
    deleteConfirmConversationId = null;
    await tick();
    renameInputEl?.focus();
    renameInputEl?.select();
  }

  async function saveRenameConversation() {
    if (!editingConversationId) return;
    const conversationId = editingConversationId;
    await quentaStore.renameConversation(conversationId, renameDraft);
    editingConversationId = null;
    renameDraft = '';
  }

  async function startTagEdit(conversation: LiatirQuentaConversation) {
    editingTagsConversationId = conversation.id;
    tagDraft = (conversation.tags ?? []).join(', ');
    editingConversationId = null;
    deleteConfirmConversationId = null;
    await tick();
    tagInputEl?.focus();
    tagInputEl?.select();
  }

  async function saveConversationTags() {
    if (!editingTagsConversationId) return;
    const conversationId = editingTagsConversationId;
    const tags = tagDraft
      .split(/[,;\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3);
    await quentaStore.updateConversationTags(conversationId, tags);
    editingTagsConversationId = null;
    tagDraft = '';
  }

  async function deleteConversation(conversationId: string) {
    await quentaStore.deleteConversation(conversationId);
    if (editingConversationId === conversationId) editingConversationId = null;
    if (editingTagsConversationId === conversationId) editingTagsConversationId = null;
    if (deleteConfirmConversationId === conversationId) deleteConfirmConversationId = null;
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveRenameConversation();
    }
    if (event.key === 'Escape') {
      editingConversationId = null;
      renameDraft = '';
    }
  }

  function handleTagKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveConversationTags();
    }
    if (event.key === 'Escape') {
      editingTagsConversationId = null;
      tagDraft = '';
    }
  }

  onMount(async () => {
    await quentaStore.init();
    syncSettingsDrafts();
    await quentaStore.bootstrapProvider();
    syncSettingsDrafts();
    if (page.url.searchParams.toString()) {
      await handleDeepLink();
    } else {
      await ensureDefaultConversation();
    }
  });
</script>

<div class="flex h-full overflow-hidden">
  <aside class="{chatsCollapsed ? 'w-0 hide' : 'w-80 flex flex-col'} shrink-0 border-r border-border bg-surface transition-[width] duration-150">
    <div class="border-b border-border p-3" style="height: {HEADER_HEIGHT}px;">
      {#if chatsCollapsed}
        <!-- <div class="flex h-full flex-col items-center justify-center gap-2">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
            onclick={() => chatsCollapsed = false}
            aria-label="Show conversations"
            title="Show conversations"
            data-testid="quenta-chat-sidebar-expand"
          >
            <Icon icon="lucide:panel-left-open" class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
            onclick={() => quentaStore.newConversation()}
            aria-label="New conversation"
            title="New conversation"
          >
            <Icon icon="lucide:plus" class="h-4 w-4" />
          </button>
        </div> -->
      {:else}
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold text-zinc-800">Quenta</p>
            <p class="mt-0.5 text-[10px] text-zinc-400">Local read-only AI</p>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="sm" onclick={() => quentaStore.newConversation()}>
              New
            </Button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
              onclick={() => chatsCollapsed = true}
              aria-label="Collapse conversations"
              title="Collapse conversations"
              data-testid="quenta-chat-sidebar-collapse"
            >
              <Icon icon="lucide:panel-left-close" class="h-4 w-4" />
            </button>
          </div>
        </div>
      {/if}
    </div>
    {#if !chatsCollapsed}
      <div class="flex-1 overflow-y-auto p-2">
        <div class="mb-2 space-y-2 px-1">
          <div class="relative">
            <Icon icon="lucide:search" class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              class="w-full rounded-lg border border-border bg-white py-1.5 pl-7 pr-2 text-xs text-zinc-700 outline-none transition focus:border-brand"
              bind:value={conversationSearch}
              placeholder="Search chats"
              aria-label="Search conversations"
              data-testid="quenta-conversation-search"
            />
          </div>

          {#if availableConversationTags.length > 0 || selectedTagFilters.length > 0}
            <div class="flex flex-wrap gap-1" aria-label="Conversation tag filters">
              {#each availableConversationTags as tag}
                <button
                  type="button"
                  class="rounded-full border px-2 py-0.5 text-[10px] transition {selectedTagFilters.includes(tag) ? 'border-brand/30 bg-brand/10 text-brand' : 'border-border bg-white text-zinc-500 hover:bg-surface-2'}"
                  onclick={() => toggleTagFilter(tag)}
                  aria-pressed={selectedTagFilters.includes(tag)}
                  data-testid="quenta-tag-filter"
                >
                  #{tag}
                </button>
              {/each}
              {#if selectedTagFilters.length > 0}
                <button
                  type="button"
                  class="rounded-full px-2 py-0.5 text-[10px] text-zinc-400 transition hover:bg-surface-2 hover:text-zinc-700"
                  onclick={() => selectedTagFilters = []}
                  aria-label="Clear tag filters"
                >
                  Clear
                </button>
              {/if}
            </div>
          {/if}
        </div>

        {#if quentaStore.conversations.length === 0}
          <p class="px-3 py-8 text-center text-xs leading-relaxed text-zinc-400">
            No conversations yet. Ask a question or explain a Result to start.
          </p>
        {:else if filteredConversations.length === 0}
          <p class="px-3 py-8 text-center text-xs leading-relaxed text-zinc-400">
            No chats match the current search or tag filters.
          </p>
        {:else}
          <div class="space-y-1.5">
            {#each filteredConversations as conversation (conversation.id)}
              <div
                class="rounded-lg border transition-colors {conversation.id === quentaStore.selectedConversationId ? 'border-brand/20 bg-brand/10' : 'border-transparent text-zinc-600 hover:border-border hover:bg-surface-2'}"
                data-testid="quenta-conversation"
              >
                <div class="flex items-start gap-1 px-2 py-2">
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    onclick={() => {
                      resetConversationEditing();
                      quentaStore.selectConversation(conversation.id);
                    }}
                    aria-label={`Open ${conversation.title}`}
                  >
                    <p class="truncate text-xs font-medium {conversation.id === quentaStore.selectedConversationId ? 'text-brand' : 'text-zinc-700'}">
                      {conversation.title}
                    </p>
                    <p class="mt-0.5 truncate text-[10px] text-zinc-400">{conversationSubtitle(conversation)}</p>
                  </button>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white hover:text-zinc-700"
                      onclick={() => void startRenameConversation(conversation)}
                      aria-label={`Rename ${conversation.title}`}
                      title="Rename chat"
                      data-testid="quenta-rename-conversation"
                    >
                      <Icon icon="lucide:pencil" class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white hover:text-zinc-700"
                      onclick={() => void startTagEdit(conversation)}
                      aria-label={`Edit tags for ${conversation.title}`}
                      title="Edit tags"
                      data-testid="quenta-edit-conversation-tags"
                    >
                      <Icon icon="lucide:tag" class="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                      onclick={() => {
                        deleteConfirmConversationId = deleteConfirmConversationId === conversation.id ? null : conversation.id;
                        editingConversationId = null;
                        editingTagsConversationId = null;
                      }}
                      aria-label={`Delete ${conversation.title}`}
                      title="Delete chat"
                      data-testid="quenta-delete-conversation"
                    >
                      <Icon icon="lucide:trash-2" class="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {#if conversation.tags?.length}
                  <div class="flex flex-wrap gap-1 px-2 pb-2">
                    {#each conversation.tags as tag}
                      <button
                        type="button"
                        class="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-zinc-500 transition hover:bg-brand/10 hover:text-brand"
                        onclick={() => toggleTagFilter(tag)}
                        aria-label={`Filter by ${tag}`}
                      >
                        #{tag}
                      </button>
                    {/each}
                  </div>
                {/if}

                {#if editingConversationId === conversation.id}
                  <div class="space-y-2 border-t border-border/70 px-2 py-2">
                    <input
                      bind:this={renameInputEl}
                      bind:value={renameDraft}
                      onkeydown={handleRenameKeydown}
                      class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                      maxlength="96"
                      aria-label="Chat name"
                      data-testid="quenta-rename-input"
                    />
                    <div class="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onclick={() => {
                        editingConversationId = null;
                        renameDraft = '';
                      }}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onclick={saveRenameConversation}
                        disabled={!renameDraft.trim()}
                        testId="quenta-rename-save"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                {/if}

                {#if editingTagsConversationId === conversation.id}
                  <div class="space-y-2 border-t border-border/70 px-2 py-2">
                    <input
                      bind:this={tagInputEl}
                      bind:value={tagDraft}
                      onkeydown={handleTagKeydown}
                      class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                      placeholder="Tags, comma separated"
                      aria-label="Chat tags"
                      data-testid="quenta-tags-input"
                    />
                    <p class="text-[10px] leading-relaxed text-zinc-400">Up to 3 tags. Separate them with commas.</p>
                    <div class="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onclick={() => {
                        editingTagsConversationId = null;
                        tagDraft = '';
                      }}>
                        Cancel
                      </Button>
                      <Button variant="primary" size="sm" onclick={saveConversationTags} testId="quenta-tags-save">
                        Save tags
                      </Button>
                    </div>
                  </div>
                {/if}

                {#if deleteConfirmConversationId === conversation.id}
                  <div class="border-t border-red-100 bg-red-50/70 px-2 py-2">
                    <p class="text-[11px] leading-relaxed text-red-700">Delete this chat? This only removes the saved conversation.</p>
                    <div class="mt-2 flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onclick={() => deleteConfirmConversationId = null}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onclick={() => void deleteConversation(conversation.id)}
                        testId="quenta-delete-confirm"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </aside>

  <main class="flex min-w-0 flex-1 flex-col">
    <!-- svelte-ignore attribute_quoted -->
    <PageHeader
      title="{(quentaStore.currentConversation?.title)??'Quenta'}"
      description="Quenta is Liatir's local, read-only AI for explaining Results, Jobs, pipelines, and bioinformatics context."
    >
      {#snippet actions()}
        <div class="flex items-center gap-2">
          <span
            class="rounded-full px-2 py-1 text-[10px] font-medium {quentaStatusClass}"
            data-testid="quenta-provider-status"
          >
            {quentaStatusLabel}
          </span>
          
          <button
            class="h-3.5 w-3.5 hover:opacity-50 flex items-center justify-center mr-2"
            title="Refresh Quenta local AI"
            onclick={refreshProvider}
            disabled={quentaStore.providerRefreshing}
          >
            <Icon icon="lucide:refresh-cw" class="h-full w-full {quentaStore.providerRefreshing ? 'animate-spin' : ''}" />
          </button>
          <div
            class="relative"
            use:clickOutside={{ enabled: settingsOpen, onOutside: () => settingsOpen = false }}
          >
            <button
              class="h-4 w-4 hover:opacity-50 flex items-center justify-center"
              title="Open local AI settings"
              onclick={() => settingsOpen = !settingsOpen}
            >
              <Icon icon="lucide:settings" class="h-full w-full" />
            </button>

            {#if settingsOpen}
              <div
                class="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[24rem] overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
                data-testid="quenta-settings-popover"
              >
                <div class="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <p class="text-sm font-semibold text-zinc-800">Quenta settings</p>
                    <p class="mt-1 text-[11px] leading-relaxed text-zinc-500">
                      Quenta prepares a default local model automatically. Advanced users can change it here.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-surface-2 hover:text-zinc-700"
                    onclick={() => settingsOpen = false}
                    aria-label="Close local AI settings"
                  >
                    <Icon icon="lucide:x" class="h-4 w-4" />
                  </button>
                </div>

                <div class="max-h-[min(70vh,38rem)] overflow-y-auto p-4">
                  <div class="space-y-3">
                    <div class="rounded-xl border border-border bg-white p-3">
                      <div class="flex items-start gap-3">
                        <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {localAIReady ? 'bg-emerald-50 text-emerald-600' : preparingQuenta ? 'bg-brand/10 text-brand' : 'bg-amber-50 text-amber-600'}">
                          {#if localAIReady}
                            <Icon icon="lucide:check" class="h-4 w-4" />
                          {:else if preparingQuenta}
                            <Icon icon="lucide:loader-circle" class="h-4 w-4 animate-spin" />
                          {:else}
                            <Icon icon="lucide:triangle-alert" class="h-4 w-4" />
                          {/if}
                        </div>
                        <div>
                          <p class="text-xs font-semibold text-zinc-800">{quentaStatusLabel}</p>
                          <p class="mt-1 text-[11px] leading-relaxed text-zinc-500">
                            Default model: {quentaStore.defaultModel}. Quenta keeps workspace context local.
                          </p>
                          {#if quentaStore.setupError}
                            <p class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                              {quentaStore.setupError}
                            </p>
                          {/if}
                        </div>
                      </div>
                    </div>

                    <div>
                      <LabelWithInfo
                        text="Model"
                        info="The local language model Quenta uses to write explanations and reports. Liatir prepares the recommended default automatically; advanced users can choose another installed model."
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

                    <details class="rounded-xl border border-border bg-surface-2">
                      <summary class="cursor-pointer px-3 py-2 text-xs font-semibold text-zinc-700">
                        Advanced settings
                      </summary>
                      <div class="space-y-3 border-t border-border p-3">
                        <div>
                          <LabelWithInfo
                            text="Ollama address"
                            targetId="quenta-base-url"
                            info="This is where Quenta reaches the local Ollama server. Liatir only accepts localhost or loopback HTTP addresses here, so this setting cannot point Quenta at a remote cloud service."
                          />
                          <input
                            id="quenta-base-url"
                            class="w-full rounded-lg border border-border bg-white px-2 py-1.5 text-xs text-zinc-700 outline-none focus:border-brand"
                            bind:value={baseUrlDraft}
                            placeholder="http://127.0.0.1:11434"
                          />
                          <p class="mt-1 text-[10px] text-zinc-400">Most users should keep the default address.</p>
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

                        <div class="rounded-xl border border-border bg-white px-3 py-2">
                          <p class="text-xs font-semibold text-zinc-700">Safety boundary</p>
                          <ul class="mt-1 space-y-1 text-[11px] leading-relaxed text-zinc-500">
                            <li>• Local AI only.</li>
                            <li>• No tool calls are sent to the model.</li>
                            <li>• Logs, files, and results are treated as evidence, not instructions.</li>
                          </ul>
                        </div>
                      </div>
                    </details>

                    <div class="flex justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onclick={refreshProvider} loading={quentaStore.providerRefreshing}>
                        Refresh
                      </Button>
                      <Button variant="primary" size="sm" onclick={saveSettings} loading={savingSettings}>
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/snippet}
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-hidden">
      <section class="flex h-full min-w-0 flex-col overflow-hidden">
        {#if !currentConversation}
          <div class="flex h-full items-center justify-center p-8">
            <Card class="max-w-xl">
              <div class="space-y-4 p-6 text-center">
                <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
                  {#if preparingQuenta}
                    <Icon icon="lucide:loader-circle" class="h-5 w-5 animate-spin" />
                  {:else}
                    <Icon icon="lucide:sparkles" class="h-5 w-5" />
                  {/if}
                </div>
                <div>
                  <p class="text-base font-semibold text-zinc-800">{quentaStatusLabel}</p>
                  <p class="mt-2 text-sm leading-relaxed text-zinc-500">
                    {localAIReady
                      ? 'Ask Quenta about Results, Jobs, pipelines, or bioinformatics context.'
                      : preparingQuenta
                        ? `Quenta is preparing the recommended local model (${quentaStore.defaultModel}).`
                        : 'Quenta could not prepare local AI yet. Check the setup message and refresh.'}
                  </p>
                </div>
                {#if localAIReady}
                  <Button variant="primary" size="sm" onclick={() => quentaStore.newConversation()}>
                    New chat
                  </Button>
                {:else if !preparingQuenta}
                  <Button variant="ghost" size="sm" onclick={() => settingsOpen = true}>
                    Open settings
                  </Button>
                {/if}
              </div>
            </Card>
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
                  Quenta is generating a response...
                </div>
              {/if}

              {#if currentError}
                <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="quenta-error">
                  {currentError}
                </div>
              {/if}
            </div>
          </div>

          <div class="border-t border-border bg-surface p-4 flex">
            {#if chatsCollapsed}
              <div class="flex h-full flex-col items-center justify-center gap-2 transition-[width] duration-150">
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
                  onclick={() => chatsCollapsed = false}
                  aria-label="Show conversations"
                  title="Show conversations"
                  data-testid="quenta-chat-sidebar-expand"
                >
                  <Icon icon="lucide:panel-left-open" class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
                  onclick={() => quentaStore.newConversation()}
                  aria-label="New conversation"
                  title="New conversation"
                >
                  <Icon icon="lucide:plus" class="h-4 w-4" />
                </button>
              </div>
            {/if}
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
                <button
                  type="button"
                  class="ml-auto inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[10px] font-medium transition {thinkingEnabledDraft ? 'border-brand/30 bg-brand/10 text-brand' : 'border-border bg-white text-zinc-500 hover:bg-surface-2'}"
                  onclick={() => void setThinkingEnabled(!thinkingEnabledDraft)}
                  disabled={sending}
                  aria-pressed={thinkingEnabledDraft}
                  title={thinkingEnabledDraft ? 'Thinking mode is on' : 'Thinking mode is off'}
                  data-testid="quenta-thinking-toggle"
                >
                  <span class="relative inline-flex h-3.5 w-6 items-center rounded-full {thinkingEnabledDraft ? 'bg-brand' : 'bg-zinc-300'}">
                    <span class="inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform {thinkingEnabledDraft ? 'translate-x-3' : 'translate-x-0.5'}"></span>
                  </span>
                  <Icon icon="lucide:brain" class="h-3 w-3" />
                  {thinkingEnabledDraft ? 'Thinking' : 'Standard'}
                </button>
              </div>
              <textarea
                class="min-h-24 w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:border-brand"
                placeholder={composerPlaceholder}
                bind:value={draft}
                onkeydown={handleComposerKeydown}
                disabled={sending || !localAIReady}
                data-testid="quenta-input"
              ></textarea>
              <div class="mt-2 flex items-center justify-between gap-3">
                <p class="text-[10px] text-zinc-400">
                  Quenta is advisory only. It cannot run tools, pipelines, API calls, Plugins, shell commands, or mutate workspace state.
                </p>
                <Button variant="primary" size="sm" onclick={sendDraft} loading={sending} disabled={!draft.trim() || !localAIReady}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>
