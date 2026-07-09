import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import { buildTutorContextDocuments, requiredContextIdsForFocus } from '$lib/tutor/context';
import { buildTutorMessages } from '$lib/tutor/prompt';
import { citedSources, retrieveTutorContext } from '$lib/tutor/retrieval';
import { TUTOR_REPORT_SCHEMA, parseTutorReport, tutorReportToMarkdown } from '$lib/tutor/report';
import { createTutorRuntime } from '$lib/tutor/runtime';
import type {
  LiatirTutorCitation,
  LiatirTutorConversation,
  LiatirTutorFocus,
  LiatirTutorIntent,
  LiatirTutorMessage,
  LiatirTutorProviderConfig,
  LiatirTutorProviderModel,
  LiatirTutorProviderStatus,
  LiatirTutorRuntimeMessage,
} from '@liatir/core';

const SETTINGS_FILE = 'tutor/settings.json';
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONVERSATION = 120;

interface TutorSettingsFile {
  config: LiatirTutorProviderConfig;
}

interface TutorConversationsFile {
  conversations: LiatirTutorConversation[];
}

const DEFAULT_CONFIG: LiatirTutorProviderConfig = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  embeddingModel: '',
  temperature: 0.2,
};

function conversationsPath() {
  return `${getDataPrefix()}tutor/conversations.json`;
}

function now() {
  return Date.now();
}

function id(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function titleForIntent(intent: LiatirTutorIntent, focus?: LiatirTutorFocus): string {
  if (intent === 'report') return focus ? `Report for ${focus.kind} ${focus.entityId}` : 'Scientific report';
  if (intent === 'explain-failure') return focus ? `Failure explanation for ${focus.kind} ${focus.entityId}` : 'Failure explanation';
  if (intent === 'explain-result') return focus ? `Result explanation for ${focus.entityId}` : 'Result explanation';
  return 'Tutor chat';
}

function promptForFocus(intent: LiatirTutorIntent, focus: LiatirTutorFocus): string {
  if (intent === 'report') {
    return `Generate a cited structured scientific report for ${focus.kind} ${focus.entityId}. Use observed evidence only, separate interpretation from limitations, and include recommended validation steps.`;
  }
  if (intent === 'explain-failure') {
    return `Explain why ${focus.kind} ${focus.entityId} failed or was cancelled. Use the recorded status, logs, metadata, and outputs. Give safe troubleshooting steps without executing anything.`;
  }
  if (intent === 'explain-result') {
    return `Explain result ${focus.entityId}. Summarize what was observed, what the output means, limitations, and sensible next validation steps.`;
  }
  return `Explain ${focus.kind} ${focus.entityId}. Summarize the relevant evidence and limitations.`;
}

function messagesForHistory(messages: LiatirTutorMessage[]): LiatirTutorRuntimeMessage[] {
  return messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function citationsFromIds(ids: string[], available: LiatirTutorCitation[]): LiatirTutorCitation[] {
  const wanted = new Set(ids);
  return available.filter((citation) => wanted.has(citation.id));
}

function normalizeSettings(value: Partial<TutorSettingsFile> | null): TutorSettingsFile {
  const temperature = Number(value?.config?.temperature ?? DEFAULT_CONFIG.temperature);
  return {
    config: {
      ...DEFAULT_CONFIG,
      ...(value?.config ?? {}),
      provider: 'ollama',
      baseUrl: (value?.config?.baseUrl ?? DEFAULT_CONFIG.baseUrl).trim() || DEFAULT_CONFIG.baseUrl,
      model: value?.config?.model?.trim() ?? '',
      embeddingModel: value?.config?.embeddingModel?.trim() ?? '',
      temperature: Number.isFinite(temperature)
        ? Math.min(2, Math.max(0, temperature))
        : DEFAULT_CONFIG.temperature,
    },
  };
}

function createTutorStore() {
  let settings = $state<TutorSettingsFile>(normalizeSettings(null));
  let settingsLoaded = false;
  let conversations = $state<LiatirTutorConversation[]>([]);
  let selectedConversationId = $state<string | null>(null);
  let loadedWorkspaceId = $state<string | null>(null);
  let initializing = $state(false);
  let providerStatus = $state<LiatirTutorProviderStatus | null>(null);
  let providerModels = $state<LiatirTutorProviderModel[]>([]);
  let providerRefreshing = $state(false);
  let sendingByConversation = $state<Record<string, boolean>>({});
  let errorByConversation = $state<Record<string, string>>({});

  async function persistSettings() {
    await appStorage.writeText(SETTINGS_FILE, JSON.stringify(settings, null, 2), { createDirs: true });
  }

  async function loadSettings() {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try {
      if (await appStorage.exists(SETTINGS_FILE)) {
        const raw = await appStorage.readText(SETTINGS_FILE);
        settings = normalizeSettings(JSON.parse(raw) as TutorSettingsFile);
      }
    } catch {
      settings = normalizeSettings(null);
    }
  }

  async function persistConversations() {
    const ordered = [...conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS);
    await appStorage.writeText(
      conversationsPath(),
      JSON.stringify({ conversations: ordered }, null, 2),
      { createDirs: true },
    );
  }

  async function loadConversationsForActiveWorkspace() {
    const workspaceId = workspaceStore.activeId;
    if (loadedWorkspaceId === workspaceId) return;
    loadedWorkspaceId = workspaceId;
    conversations = [];
    selectedConversationId = null;
    errorByConversation = {};
    sendingByConversation = {};
    if (!workspaceId) return;

    try {
      if (await appStorage.exists(conversationsPath())) {
        const raw = await appStorage.readText(conversationsPath());
        const parsed = JSON.parse(raw) as TutorConversationsFile;
        conversations = (parsed.conversations ?? [])
          .filter((conversation) => conversation.workspaceId === workspaceId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CONVERSATIONS);
        selectedConversationId = conversations[0]?.id ?? null;
      }
    } catch {
      conversations = [];
      selectedConversationId = null;
    }
  }

  function updateConversation(
    conversationId: string,
    mapper: (conversation: LiatirTutorConversation) => LiatirTutorConversation,
  ) {
    conversations = conversations
      .map((conversation) => conversation.id === conversationId ? mapper(conversation) : conversation)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function createConversation(input: {
    title?: string;
    focus?: LiatirTutorFocus;
  } = {}): LiatirTutorConversation {
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) throw new Error('Open a workspace before using the Local Tutor');
    const timestamp = now();
    const conversation: LiatirTutorConversation = {
      id: id('tutor-conversation'),
      workspaceId,
      title: input.title ?? 'Tutor chat',
      createdAt: timestamp,
      updatedAt: timestamp,
      focus: input.focus,
      messages: [],
    };
    conversations = [conversation, ...conversations].slice(0, MAX_CONVERSATIONS);
    selectedConversationId = conversation.id;
    void persistConversations();
    return conversation;
  }

  function currentConversation(): LiatirTutorConversation | null {
    return conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  }

  function setConversationSending(conversationId: string, sending: boolean) {
    if (sending) {
      sendingByConversation = { ...sendingByConversation, [conversationId]: true };
      return;
    }
    const { [conversationId]: _done, ...rest } = sendingByConversation;
    sendingByConversation = rest;
  }

  function setConversationError(conversationId: string, error: string | null) {
    if (error) {
      errorByConversation = { ...errorByConversation, [conversationId]: error };
      return;
    }
    const { [conversationId]: _done, ...rest } = errorByConversation;
    errorByConversation = rest;
  }

  async function sendMessage(
    content: string,
    intent: LiatirTutorIntent = 'chat',
    options: { conversationId?: string; focus?: LiatirTutorFocus } = {},
  ): Promise<void> {
    await tutorStore.init();
    const query = content.trim();
    if (!query) return;
    if (!settings.config.model.trim()) {
      throw new Error('Select an installed Ollama model before asking the Local Tutor');
    }

    const existing = options.conversationId
      ? conversations.find((conversation) => conversation.id === options.conversationId)
      : currentConversation();
    const conversation = existing ?? createConversation({
      title: titleForIntent(intent, options.focus),
      focus: options.focus,
    });
    selectedConversationId = conversation.id;
    setConversationError(conversation.id, null);

    const timestamp = now();
    const userMessage: LiatirTutorMessage = {
      id: id('tutor-message'),
      role: 'user',
      intent,
      content: query,
      createdAt: timestamp,
    };
    const priorMessages = conversation.messages;
    updateConversation(conversation.id, (item) => ({
      ...item,
      focus: options.focus ?? item.focus,
      updatedAt: timestamp,
      messages: [...item.messages, userMessage].slice(-MAX_MESSAGES_PER_CONVERSATION),
    }));
    await persistConversations();

    setConversationSending(conversation.id, true);
    try {
      const focus = options.focus ?? conversation.focus;
      const documents = await buildTutorContextDocuments(focus);
      const retrieval = retrieveTutorContext(query, documents, {
        requiredIds: requiredContextIdsForFocus(focus),
      });
      const history = messagesForHistory(priorMessages);
      const runtime = createTutorRuntime(settings.config);
      const response = await runtime.chat({
        model: settings.config.model,
        messages: buildTutorMessages(query, retrieval.context, history, intent),
        temperature: settings.config.temperature,
        format: intent === 'report' ? TUTOR_REPORT_SCHEMA : undefined,
      });

      let assistantContent = response.content;
      let citations = citedSources(response.content, retrieval.citations);
      let report: LiatirTutorMessage['report'];
      if (intent === 'report') {
        report = parseTutorReport(response.content);
        assistantContent = tutorReportToMarkdown(report);
        citations = citationsFromIds(report.citationIds, retrieval.citations);
      }
      if (citations.length === 0) citations = retrieval.citations.slice(0, 4);

      const assistantMessage: LiatirTutorMessage = {
        id: id('tutor-message'),
        role: 'assistant',
        intent,
        content: assistantContent,
        createdAt: now(),
        citations,
        model: response.model,
        report,
      };
      updateConversation(conversation.id, (item) => ({
        ...item,
        updatedAt: assistantMessage.createdAt,
        messages: [...item.messages, assistantMessage].slice(-MAX_MESSAGES_PER_CONVERSATION),
      }));
      await persistConversations();
    } catch (error) {
      setConversationError(conversation.id, error instanceof Error ? error.message : String(error));
    } finally {
      setConversationSending(conversation.id, false);
    }
  }

  const tutorStore = {
    get settings() { return settings; },
    get config() { return settings.config; },
    get conversations() { return conversations; },
    get selectedConversationId() { return selectedConversationId; },
    get currentConversation() { return currentConversation(); },
    get initializing() { return initializing; },
    get providerStatus() { return providerStatus; },
    get providerModels() { return providerModels; },
    get providerRefreshing() { return providerRefreshing; },

    isSending(conversationId: string | null | undefined) {
      return conversationId ? Boolean(sendingByConversation[conversationId]) : false;
    },

    errorFor(conversationId: string | null | undefined) {
      return conversationId ? errorByConversation[conversationId] ?? null : null;
    },

    async init() {
      if (initializing) return;
      initializing = true;
      try {
        await workspaceStore.init();
        await loadSettings();
        await loadConversationsForActiveWorkspace();
      } finally {
        initializing = false;
      }
    },

    async updateConfig(patch: Partial<LiatirTutorProviderConfig>) {
      settings = normalizeSettings({
        config: {
          ...settings.config,
          ...patch,
        },
      });
      await persistSettings();
    },

    async refreshProvider() {
      await tutorStore.init();
      providerRefreshing = true;
      try {
        const runtime = createTutorRuntime(settings.config);
        const [status, models] = await Promise.all([
          runtime.status(),
          runtime.models().catch(() => [] as LiatirTutorProviderModel[]),
        ]);
        providerStatus = status;
        providerModels = models;
        if (!settings.config.model && models.length === 1) {
          settings = normalizeSettings({ config: { ...settings.config, model: models[0].name } });
          await persistSettings();
        }
      } finally {
        providerRefreshing = false;
      }
    },

    selectConversation(conversationId: string) {
      if (conversations.some((conversation) => conversation.id === conversationId)) {
        selectedConversationId = conversationId;
      }
    },

    async newConversation() {
      await tutorStore.init();
      createConversation({ title: 'Tutor chat' });
    },

    async deleteConversation(conversationId: string) {
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (selectedConversationId === conversationId) selectedConversationId = conversations[0]?.id ?? null;
      await persistConversations();
    },

    async startFocusedConversation(intent: LiatirTutorIntent, focus: LiatirTutorFocus, autoSend = true) {
      await tutorStore.init();
      const conversation = createConversation({
        title: titleForIntent(intent, focus),
        focus,
      });
      if (autoSend) {
        await sendMessage(promptForFocus(intent, focus), intent, {
          conversationId: conversation.id,
          focus,
        });
      }
      return conversation;
    },

    sendMessage,
  };

  return tutorStore;
}

export const tutorStore = createTutorStore();
