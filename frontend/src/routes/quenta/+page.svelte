<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { replaceState } from '$app/navigation';
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
  import QuentaActivityPanel from '$lib/components/quenta/QuentaActivityPanel.svelte';
  import QuentaMarkdown from '$lib/components/quenta/QuentaMarkdown.svelte';
  import { consumedQuentaUrl, quentaLaunchRequest, type QuentaLaunchRequest } from '$lib/quenta/navigation';
  import { openQuentaWindow } from '$lib/quenta/window';
  import { quentaReportToMarkdown } from '$lib/quenta/report';
  import { quentaPromptForFocus, quentaStore } from '$lib/stores/quenta.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import type {
    LiatirQuentaConversation,
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
  let enterToSendDraft = $state(true);
  let autoScrollToBottom = $state(true);
  let savingSettings = $state(false);
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
  let transcriptEl = $state<HTMLDivElement | null>(null);
  let lastAutoScrollKey = '';
  let composerConversationId: string | null = null;
  let showScrollToBottomButton = $state(false);

  const SCROLL_TO_BOTTOM_OFFSET = 120;
  const CHATS_SIDEBAR_STATE_LOCAL_STORAGE_KEY = 'quenta-chats-sidebar-collapsed'!;

  const currentConversation = $derived(quentaStore.currentConversation);
  const currentError = $derived(quentaStore.errorFor(currentConversation?.id));
  const canRetry = $derived(quentaStore.canRetry(currentConversation?.id));
  const sending = $derived(quentaStore.isSending(currentConversation?.id));
  const stopping = $derived(quentaStore.isStopping(currentConversation?.id));
  const activeResponse = $derived(quentaStore.activeResponseFor(currentConversation?.id));
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
      ? quentaStore.composerSettings.enterToSend
        ? 'Ask about a result, job log, pipeline, AI model, API Connector request, or bioinformatics concept. Press Enter to send, Shift+Enter for a new line.'
        : 'Ask about a result, job log, pipeline, AI model, API Connector request, or bioinformatics concept. Press Cmd/Ctrl+Enter to send; Enter adds a new line.'
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


  function updateScrollToBottomButtonVisibility() {
    const el = transcriptEl;
    if (!el) {
      showScrollToBottomButton = false;
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    showScrollToBottomButton = distanceFromBottom > SCROLL_TO_BOTTOM_OFFSET;
  }

  function syncSettingsDrafts() {
    baseUrlDraft = quentaStore.config.baseUrl;
    modelDraft = quentaStore.config.model;
    embeddingModelDraft = quentaStore.config.embeddingModel ?? '';
    temperatureDraft = quentaStore.config.temperature;
    thinkingEnabledDraft = quentaStore.config.thinkingEnabled ?? false;
    enterToSendDraft = quentaStore.composerSettings.enterToSend;
    autoScrollToBottom = quentaStore.autoScrollToBottomSettings ?? false;
  }

  function setChatsCollapsedState(state: boolean|null = null) {
    if(state===null) chatsCollapsed=!chatsCollapsed;
    else chatsCollapsed=state;
    localStorage.setItem(CHATS_SIDEBAR_STATE_LOCAL_STORAGE_KEY,String(chatsCollapsed));
  }

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function scrollTranscriptToBottom(behavior: ScrollBehavior) {
    if(!autoScrollToBottom) return;
    await tick();
    transcriptEl?.scrollTo({
      top: transcriptEl.scrollHeight,
      behavior,
    });
    updateScrollToBottomButtonVisibility();
  }

  $effect(() => {
    const conversation = currentConversation;
    const lastMessageId = conversation?.messages.at(-1)?.id ?? 'empty';
    const scrollKey = conversation
      ? `${conversation.id}:${lastMessageId}:${activeResponse?.revision ?? 'idle'}:${currentError ? 'error' : 'ok'}`
      : '';
    if (!scrollKey || scrollKey === lastAutoScrollKey) return;
    const behavior: ScrollBehavior = activeResponse ? 'auto' : lastAutoScrollKey ? 'smooth' : 'auto';
    lastAutoScrollKey = scrollKey;
    if(!autoScrollToBottom) void scrollTranscriptToBottom(behavior);
    else void tick().then(updateScrollToBottomButtonVisibility);
  });

  async function prepareDeepLink(launch: QuentaLaunchRequest) {
    selectedIntent = launch.intent;
    const conversation = await quentaStore.startFocusedConversation(
      launch.intent,
      launch.focus,
      false,
    );
    syncComposerFromConversation(conversation);
    return conversation;
  }

  function syncComposerFromConversation(conversation = currentConversation) {
    composerConversationId = conversation?.id ?? null;
    draft = conversation?.draft ?? '';
    selectedIntent = conversation?.draftIntent
      ?? conversation?.messages.at(-1)?.intent
      ?? 'chat';
  }

  $effect(() => {
    const conversation = currentConversation;
    if ((conversation?.id ?? null) === composerConversationId) return;
    syncComposerFromConversation(conversation);
  });

  function selectConversation(conversationId: string) {
    resetConversationEditing();
    quentaStore.selectConversation(conversationId);
    syncComposerFromConversation();
  }

  async function persistCurrentDraft() {
    if (!currentConversation) return;
    if (
      currentConversation.draft === draft
      && currentConversation.draftIntent === selectedIntent
    ) return;
    await quentaStore.updateConversationDraft(currentConversation.id, draft, selectedIntent);
  }

  async function changeIntent(value: string) {
    selectedIntent = value as LiatirQuentaIntent;
    await persistCurrentDraft();
  }

  async function openInSeparateWindow() {
    try {
      await persistCurrentDraft();
      const params = new URLSearchParams();
      if (currentConversation) params.set('conversation', currentConversation.id);
      await openQuentaWindow(`/quenta${params.size ? `?${params.toString()}` : ''}`);
    } catch {
      toast.error('Quenta could not open in a separate window.');
    }
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
      await quentaStore.updateComposerSettings({
        enterToSend: enterToSendDraft,
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

  async function stopResponse() {
    if (!currentConversation) return;
    await quentaStore.stopMessage(currentConversation.id);
  }

  async function retryResponse() {
    if (!currentConversation) return;
    await quentaStore.retryLastMessage(currentConversation.id);
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    const shortcutSend = event.metaKey || event.ctrlKey;
    const plainEnterSend = quentaStore.composerSettings.enterToSend && !event.shiftKey && !event.altKey;
    if (shortcutSend || plainEnterSend) {
      event.preventDefault();
      if (!sending && localAIReady) void sendDraft();
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
    const launch = quentaLaunchRequest(page.url);
    const requestedConversationId = page.url.searchParams.get('conversation');
    if (launch) {
      selectedIntent = launch.intent;
      replaceState(consumedQuentaUrl(page.url), page.state);
    }
    await quentaStore.init();
    let launchConversation: LiatirQuentaConversation | null = null;
    if (launch) {
      launchConversation = await prepareDeepLink(launch);
    } else {
      if (requestedConversationId) quentaStore.selectConversation(requestedConversationId);
      syncComposerFromConversation();
    }
    syncSettingsDrafts();
    await quentaStore.bootstrapProvider();
    syncSettingsDrafts();
    if (launch?.autoSend && launchConversation) {
      await quentaStore.sendMessage(
        launchConversation.draft ?? quentaPromptForFocus(launch.intent, launch.focus),
        launch.intent,
        {
          conversationId: launchConversation.id,
          focus: launch.focus,
        },
      );
      syncComposerFromConversation();
    }
    const chatsSidebarState = localStorage.getItem(CHATS_SIDEBAR_STATE_LOCAL_STORAGE_KEY);
    setChatsCollapsedState(chatsSidebarState==='true'?true:false);
  });
</script>

<div class="flex h-full overflow-hidden">
  {#if !chatsCollapsed || !((quentaStore?.selectedConversationId)?.trim())}
  <aside class="flex w-80 shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150">
    <div class="border-b border-border p-3" style="height: {HEADER_HEIGHT}px;">
      <div class="flex items-center justify-between gap-2">
        <div>
          <p class="text-xs font-semibold text-zinc-800">Quenta</p>
          <p class="mt-0.5 text-[10px] text-zinc-400">Local read-only AI</p>
        </div>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="sm" onclick={() => quentaStore.newConversation()}>
            New
          </Button>
          {#if (quentaStore?.selectedConversationId)?.trim()}
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
              onclick={() => setChatsCollapsedState(true)}
              aria-label="Collapse conversations"
              title="Collapse conversations"
              data-testid="quenta-chat-sidebar-collapse"
            >
              <Icon icon="lucide:panel-left-close" class="h-5 w-5" />
            </button>
          {/if}
        </div>
      </div>
    </div>
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
                data-conversation-id={conversation.id}
              >
                <div class="flex items-start gap-1 px-2 py-2">
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left"
                    onclick={() => selectConversation(conversation.id)}
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
  </aside>
  {/if}

  <main class="flex min-w-0 flex-1 flex-col">
    <!-- svelte-ignore attribute_quoted -->
    <PageHeader
      title="{(quentaStore.currentConversation?.title)??'Quenta'}"
      description="Quenta is Liatir's local, read-only AI for explaining Results, Jobs, pipelines, and bioinformatics context."
    >
      {#snippet titleActions()}
        {#if chatsCollapsed && (quentaStore?.selectedConversationId)?.trim()}
        <div class="flex flex-col gap-1 pr-3 border-r border-r-border transition">
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center rounded-lg text-zinc-500 hover:bg-surface-2 hover:text-zinc-800"
            onclick={() => setChatsCollapsedState(false)}
            aria-label="Show conversations"
            title="Show conversations"
            data-testid="quenta-chat-sidebar-expand"
          >
            <Icon icon="lucide:panel-left-open" class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center rounded-lg text-zinc-500 hover:bg-surface-2 hover:text-zinc-800"
            onclick={() => quentaStore.newConversation()}
            aria-label="New conversation"
            title="New conversation"
            data-testid="quenta-new-conversation-header"
          >
            <Icon icon="lucide:plus" class="h-4 w-4" />
          </button>
          </div>
        {/if}
      {/snippet}
      {#snippet actions()}
        <div class="flex items-center gap-3">
          <span
            class="rounded-full px-2 py-1 text-[10px] font-medium {quentaStatusClass}"
            data-testid="quenta-provider-status"
          >
            {quentaStatusLabel}
          </span>
          
          <button
            class="h-7 w-7 hover:opacity-50 flex items-center justify-center"
            title="Refresh Quenta local AI"
            onclick={refreshProvider}
            disabled={quentaStore.providerRefreshing}
          >
            <Icon icon="lucide:refresh-cw" class="h-4 w-4 {quentaStore.providerRefreshing ? 'animate-spin' : ''}" />
          </button>
          <div
            class="relative"
            use:clickOutside={{ enabled: settingsOpen, onOutside: () => settingsOpen = false }}
          >
            <button
              class="h-5 w-5 hover:opacity-50 flex items-center justify-center"
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
                    <Icon icon="lucide:x" class="h-5 w-5" />
                  </button>
                </div>

                <div class="max-h-[min(70vh,38rem)] overflow-y-auto p-4">
                  <div class="space-y-3">
                    <div class="rounded-xl border border-border bg-white p-3">
                      <div class="flex items-start gap-3">
                        <div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full {localAIReady ? 'bg-emerald-50 text-emerald-600' : preparingQuenta ? 'bg-brand/10 text-brand' : 'bg-amber-50 text-amber-600'}">
                          {#if localAIReady}
                            <Icon icon="lucide:check" class="h-5 w-5" />
                          {:else if preparingQuenta}
                            <Icon icon="lucide:loader-circle" class="h-5 w-5 animate-spin" />
                          {:else}
                            <Icon icon="lucide:triangle-alert" class="h-5 w-5" />
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

                    <div class="rounded-xl border border-border bg-white px-3 py-2">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <LabelWithInfo
                            text="Enter sends"
                            targetId="quenta-enter-to-send"
                            info="When enabled, Enter sends the message and Shift+Enter adds a new line. Turn it off if you prefer Enter to add a new line and Cmd/Ctrl+Enter to send."
                          />
                          <p class="mt-1 text-[11px] leading-relaxed text-zinc-500">
                            {enterToSendDraft
                              ? 'Enter sends the message. Shift+Enter adds a new line.'
                              : 'Enter adds a new line. Cmd/Ctrl+Enter sends the message.'}
                          </p>
                        </div>
                        <button
                          id="quenta-enter-to-send"
                          type="button"
                          role="switch"
                          aria-checked={enterToSendDraft}
                          class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {enterToSendDraft ? 'bg-brand' : 'bg-zinc-300'}"
                          onclick={() => enterToSendDraft = !enterToSendDraft}
                          title={enterToSendDraft ? 'Enter sends messages' : 'Enter adds new lines'}
                          data-testid="quenta-enter-to-send-toggle"
                        >
                          <span class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform {enterToSendDraft ? 'translate-x-5' : 'translate-x-0.5'}"></span>
                        </button>
                      </div>
                    </div>

                    <div class="rounded-xl border border-border bg-white px-3 py-2">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <LabelWithInfo
                            text="Auto scroll to bottom"
                            targetId="quenta-auto-scroll-to-bottom"
                            info="When enabled, new messages cause the chat to automatically scroll to latest message."
                          />
                          <p class="mt-1 text-[11px] leading-relaxed text-zinc-500">
                            {autoScrollToBottom
                              ? 'Auto scroll to bottom enabled. New messages will scroll the chat to latest message automatically.'
                              : 'Auto scroll to bottom disabled. New messages will not scroll the chat to latest message automatically.'}
                          </p>
                        </div>
                        <button
                          id="quenta-auto-scroll-to-bottom"
                          type="button"
                          role="switch"
                          aria-checked={autoScrollToBottom}
                          class="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {enterToSendDraft ? 'bg-brand' : 'bg-zinc-300'}"
                          onclick={() => autoScrollToBottom = !autoScrollToBottom}
                          title={autoScrollToBottom ? 'Auto scroll to bottom enabled' : 'Auto scroll to bottom disabled'}
                          data-testid="quenta-auto-scroll-to-bottom-toggle"
                        >
                          <span class="inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform {enterToSendDraft ? 'translate-x-5' : 'translate-x-0.5'}"></span>
                        </button>
                      </div>
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
          <div class="w-fit h-fit pl-2 border-l border-l-border">
          <button
            type="button"
            class="inline-flex h-7 w-7 items-center group justify-center rounded-lg text-zinc-500 transition hover:bg-surface-2 hover:text-zinc-800"
            onclick={openInSeparateWindow}
            aria-label="Open Quenta in a separate window"
            title="Open Quenta in a separate window"
            data-testid="quenta-open-window"
          >
            <Icon icon="fluent:window-new-24-regular" class="h-5 w-5 group-hover:hidden" />
            <Icon icon="fluent:window-new-24-filled" class="h-5 w-5 hidden group-hover:inline" />
          </button>
        </div>
        </div>
      {/snippet}
    </PageHeader>

    <div class="min-h-0 flex-1 overflow-hidden">
      <section class="flex h-full min-w-0 flex-col overflow-hidden">
        {#if !currentConversation}
          <div class="flex h-full items-center justify-center p-8" data-testid="quenta-empty-state">
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
                  <p class="text-base font-semibold text-zinc-800">
                    {localAIReady && quentaStore.conversations.length > 0 ? 'Choose a chat' : quentaStatusLabel}
                  </p>
                  <p class="mt-2 text-sm leading-relaxed text-zinc-500">
                    {localAIReady
                      ? quentaStore.conversations.length > 0
                        ? 'Select a saved chat from the sidebar, or start a new one.'
                        : 'Ask Quenta about Results, Jobs, pipelines, or bioinformatics context.'
                      : preparingQuenta
                        ? `Quenta is preparing the recommended local model (${quentaStore.defaultModel}).`
                        : 'Quenta could not prepare local AI yet. Check the setup message and refresh.'}
                  </p>
                </div>
                {#if localAIReady}
                  <Button
                    variant="primary"
                    size="sm"
                    onclick={() => quentaStore.newConversation()}
                    testId="quenta-empty-new-chat"
                  >
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
          <div bind:this={transcriptEl} onscroll={updateScrollToBottomButtonVisibility} class="flex-1 overflow-y-auto p-6 relative" data-testid="quenta-transcript">
            <div class="mx-auto max-w-4xl space-y-6">
              {#each currentConversation.messages as message (message.id)}
                <Card class={message.role === 'assistant' ? 'bg-transparent border-none rounded-none' : 'bg-brand/5 border-brand/15'}>
                  <div class="space-y-3 {message.role === 'assistant' ? 'p-0' : 'p-4'}">
                    {#if message.role === 'assistant' && message.generation}
                      <QuentaActivityPanel generation={message.generation} intent={message.intent} />
                    {/if}
                    <QuentaMarkdown content={message.content} />
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <!-- <p class="text-[11px] font-semibold uppercase tracking-wide {message.role === 'assistant' ? 'text-zinc-500' : 'text-brand'}">
                          {message.role === 'assistant' ? 'Quenta' : 'You'}
                        </p> -->
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

              {#if activeResponse}
                <div class="space-y-3" data-testid="quenta-streaming-response">
                  <QuentaActivityPanel active={activeResponse} intent={activeResponse.intent} />
                  {#if activeResponse.content && activeResponse.intent !== 'report'}
                    <div
                      data-testid="quenta-streaming-content"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <QuentaMarkdown content={activeResponse.content} />
                      <span
                        class="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-zinc-400 align-text-bottom"
                        data-testid="quenta-streaming-cursor"
                        aria-hidden="true"
                      ></span>
                    </div>
                  {/if}
                </div>
              {:else if sending}
                <div class="flex items-center gap-2 text-xs text-zinc-500">
                  <Spinner size={14} />
                  Preparing response…
                </div>
              {/if}

              {#if currentError}
                <div class="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="quenta-error">
                  <span class="min-w-0 flex-1">{currentError}</span>
                  {#if canRetry}
                    <Button variant="ghost" size="sm" onclick={retryResponse} disabled={sending || !localAIReady} testId="quenta-retry">
                      Retry
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>
            {#if showScrollToBottomButton}
              <button id="scrollToBottomButton" class="w-fit h-fit bg-white border border-border hover:bg-zinc-50 shadow-xl cursor-pointer rounded-full p-2 absolute right-1/2 bottom-5 text-zinc-500" onclick={()=>{
                  scrollTranscriptToBottom('smooth');
                }}>
                <Icon icon="mingcute:arrow-down-line" class="h-4.5 w-4.5"/>
              </button>
            {/if}
          </div>

          <div class="border-t border-border bg-surface p-4 flex justify-center w-full">
            <div class="max-w-4xl w-full">
              <div class="rounded-2xl border border-border bg-white shadow-sm transition-colors focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/10">
                {#if currentConversation.focus}
                  <div class="px-3 pt-3" data-testid="quenta-focus-context">
                    <div class="inline-flex max-w-full items-center gap-2 rounded-full bg-brand/8 px-2.5 py-1 text-[10px] text-brand">
                      <Icon icon={currentConversation.focus.kind === 'result' ? 'lucide:chart-no-axes-combined' : 'lucide:terminal'} class="h-3.5 w-3.5 shrink-0" />
                      <span class="shrink-0 font-semibold">
                        {currentConversation.focus.kind === 'result' ? 'Result' : 'Job'}
                      </span>
                      <span class="truncate text-zinc-500">{currentConversation.focus.entityId}</span>
                    </div>
                  </div>
                {/if}
                <textarea
                  class="min-h-14 w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
                  rows="2"
                  placeholder={composerPlaceholder}
                  bind:value={draft}
                  onkeydown={handleComposerKeydown}
                  onblur={() => void persistCurrentDraft()}
                  disabled={sending || !localAIReady}
                  data-testid="quenta-input"
                ></textarea>
                <div class="flex items-center gap-2 px-2 pb-2 pt-1">
                  <Select
                    value={selectedIntent}
                    options={intentOptions}
                    onchange={(value) => void changeIntent(value)}
                    disabled={sending}
                    placeholder="Choose task"
                    class="w-44"
                    buttonClass="!rounded-full !border-0 !bg-surface-2 !px-2.5 !py-1 !shadow-none focus:!ring-0"
                    searchable={false}
                  />
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition {thinkingEnabledDraft ? 'bg-brand/10 text-brand' : 'text-zinc-500 hover:bg-surface-2'}"
                    onclick={() => void setThinkingEnabled(!thinkingEnabledDraft)}
                    disabled={sending}
                    aria-pressed={thinkingEnabledDraft}
                    title={thinkingEnabledDraft ? 'Thinking mode is on' : 'Thinking mode is off'}
                    data-testid="quenta-thinking-toggle"
                  >
                    <Icon icon="lucide:brain" class="h-3.5 w-3.5" />
                    {thinkingEnabledDraft ? 'Thinking' : 'Standard'}
                  </button>
                  <div class="ml-auto">
                    {#if sending}
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onclick={stopResponse}
                        disabled={stopping}
                        aria-label={stopping ? 'Stopping Quenta response' : 'Stop Quenta response'}
                        title={stopping ? 'Stopping response' : 'Stop response'}
                        data-testid="quenta-stop"
                      >
                        {#if stopping}
                          <Icon icon="lucide:loader-circle" class="h-5 w-5 animate-spin" />
                        {:else}
                          <Icon icon="lucide:square" class="h-3.5 w-3.5 fill-current" />
                        {/if}
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm shadow-brand-shadow/30 transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
                        onclick={sendDraft}
                        disabled={!draft.trim() || !localAIReady}
                        aria-label="Send message"
                        title="Send message"
                        data-testid="quenta-send"
                      >
                        <Icon icon="lucide:arrow-up" class="h-5 w-5" />
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
              <p class="mt-2 px-2 text-center text-[10px] text-zinc-400">
                Quenta is advisory only and cannot run or modify workspace resources.
              </p>
            </div>
          </div>
        {/if}
      </section>
    </div>
  </main>
</div>
