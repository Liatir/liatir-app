import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import { buildQuentaContextDocuments, requiredContextIdsForFocus } from '$lib/quenta/context';
import { buildQuentaMessages } from '$lib/quenta/prompt';
import { citedSources, retrieveQuentaContext } from '$lib/quenta/retrieval';
import { QUENTA_REPORT_SCHEMA, parseQuentaReport, quentaReportToMarkdown } from '$lib/quenta/report';
import { createQuentaRuntime } from '$lib/quenta/runtime';
import type {
  LiatirQuentaCitation,
  LiatirQuentaConversation,
  LiatirQuentaFocus,
  LiatirQuentaIntent,
  LiatirQuentaMessage,
  LiatirQuentaProviderConfig,
  LiatirQuentaProviderModel,
  LiatirQuentaProviderStatus,
  LiatirQuentaRuntimeMessage,
} from '@liatir/core';

const SETTINGS_FILE = 'quenta/settings.json';
const LEGACY_SETTINGS_FILE = 'tutor/settings.json';
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const MAX_CONVERSATION_TAGS = 3;
const MAX_CONVERSATION_TAG_LENGTH = 28;
const MAX_CONVERSATION_TITLE_LENGTH = 96;
export const QUENTA_DEFAULT_MODEL = 'qwen3.5:9b';
type QuentaSetupPhase = 'idle' | 'preparing' | 'downloading' | 'ready' | 'failed';

interface QuentaSettingsFile {
  config: LiatirQuentaProviderConfig;
}

interface QuentaConversationsFile {
  conversations: LiatirQuentaConversation[];
}

const DEFAULT_CONFIG: LiatirQuentaProviderConfig = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  embeddingModel: '',
  temperature: 0.2,
  thinkingEnabled: false,
};
const DEFAULT_CONVERSATION_TITLE = 'New chat';

function conversationsPath() {
  return `${getDataPrefix()}quenta/conversations.json`;
}

function legacyConversationsPath() {
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

function titleForIntent(intent: LiatirQuentaIntent, focus?: LiatirQuentaFocus): string {
  if (intent === 'report') return focus ? `Report for ${focus.kind} ${focus.entityId}` : 'Scientific report';
  if (intent === 'explain-failure') return focus ? `Failure explanation for ${focus.kind} ${focus.entityId}` : 'Failure explanation';
  if (intent === 'explain-result') return focus ? `Result explanation for ${focus.entityId}` : 'Result explanation';
  return DEFAULT_CONVERSATION_TITLE;
}

function promptForFocus(intent: LiatirQuentaIntent, focus: LiatirQuentaFocus): string {
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

function messagesForHistory(messages: LiatirQuentaMessage[]): LiatirQuentaRuntimeMessage[] {
  return messages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function citationsFromIds(ids: string[], available: LiatirQuentaCitation[]): LiatirQuentaCitation[] {
  const wanted = new Set(ids);
  return available.filter((citation) => wanted.has(citation.id));
}

function normalizeSettings(value: Partial<QuentaSettingsFile> | null): QuentaSettingsFile {
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
      thinkingEnabled: Boolean(value?.config?.thinkingEnabled ?? DEFAULT_CONFIG.thinkingEnabled),
    },
  };
}

function normalizeConversationName(value: string): string {
  return value
    .replace(/\bLocal Tutor\b/g, 'Quenta')
    .replace(/\bTutor\b/g, 'Quenta')
    .replace(/^Quenta chat$/, DEFAULT_CONVERSATION_TITLE);
}

function normalizeConversationTitle(value: string): string {
  const clean = normalizeConversationName(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONVERSATION_TITLE_LENGTH);
  return clean || DEFAULT_CONVERSATION_TITLE;
}

function normalizeConversationTag(value: unknown): string {
  return String(value ?? '')
    .replace(/[#,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONVERSATION_TAG_LENGTH);
}

function normalizeConversationTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const clean = normalizeConversationTag(tag);
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= MAX_CONVERSATION_TAGS) break;
  }
  return normalized;
}

function ollamaStatusErrorMessage(baseUrl: string, error: unknown): string {
  const detail = String(error);
  if (detail.includes('invalid Ollama URL')) {
    return 'The Ollama address is invalid. Use a local address like http://127.0.0.1:11434.';
  }
  if (detail.includes('must use a local http:// endpoint')) {
    return 'Quenta only supports a local http:// Ollama endpoint.';
  }
  if (detail.includes('must resolve to localhost') || detail.includes('loopback IP')) {
    return 'Quenta only supports Ollama on localhost or a loopback IP.';
  }
  return `Quenta could not prepare the local AI engine at ${baseUrl}.`;
}

function quentaSetupErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (
    detail.includes('cannot download the managed local AI runtime') ||
    detail.includes('Request failed') ||
    detail.includes('Download stalled') ||
    detail.includes('Not enough disk space')
  ) {
    return 'Quenta needs to download its local AI engine the first time it runs. Check the internet connection and available disk space, then refresh.';
  }
  if (
    detail.includes('cannot start the local AI engine') ||
    detail.includes('did not become ready in time') ||
    detail.includes('Ollama is unavailable') ||
    detail.includes('error sending request')
  ) {
    return 'Quenta prepared the local AI engine but it is not ready yet. Keep Liatir open and refresh in a moment.';
  }
  if (
    detail.includes('cannot download the recommended local AI model') ||
    detail.includes('was not found after setup')
  ) {
    return 'Quenta needs to download the recommended local model before the first chat. Check the internet connection and available disk space, then refresh.';
  }
  return 'Quenta could not prepare local AI automatically. Check the internet connection and available disk space, then refresh.';
}

function quentaChatErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes('Ollama chat failed') || detail.includes('error sending request')) {
    return 'Local AI is not running yet. Quenta is preparing it automatically; try again in a moment.';
  }
  return detail;
}

function normalizeLegacyConversation(conversation: LiatirQuentaConversation): LiatirQuentaConversation {
  return {
    ...conversation,
    id: conversation.id.replace(/^tutor-/, 'quenta-'),
    title: normalizeConversationTitle(conversation.title),
    tags: normalizeConversationTags(conversation.tags),
    messages: conversation.messages.map((message) => ({
      ...message,
      id: message.id.replace(/^tutor-/, 'quenta-'),
      content: normalizeConversationName(message.content),
    })),
  };
}

function createQuentaStore() {
  let settings = $state<QuentaSettingsFile>(normalizeSettings(null));
  let settingsLoaded = false;
  let conversations = $state<LiatirQuentaConversation[]>([]);
  let selectedConversationId = $state<string | null>(null);
  let loadedWorkspaceId = $state<string | null>(null);
  let initializing = $state(false);
  let providerStatus = $state<LiatirQuentaProviderStatus | null>(null);
  let providerModels = $state<LiatirQuentaProviderModel[]>([]);
  let providerRefreshing = $state(false);
  let setupPhase = $state<QuentaSetupPhase>('idle');
  let setupError = $state<string | null>(null);
  let sendingByConversation = $state<Record<string, boolean>>({});
  let errorByConversation = $state<Record<string, string>>({});
  let bootstrapPromise: Promise<void> | null = null;

  async function persistSettings() {
    await appStorage.writeText(SETTINGS_FILE, JSON.stringify(settings, null, 2), { createDirs: true });
  }

  async function loadSettings() {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try {
      const legacyOnly = !(await appStorage.exists(SETTINGS_FILE)) && (await appStorage.exists(LEGACY_SETTINGS_FILE));
      const settingsPath = legacyOnly ? LEGACY_SETTINGS_FILE : SETTINGS_FILE;
      if (await appStorage.exists(settingsPath)) {
        const raw = await appStorage.readText(settingsPath);
        settings = normalizeSettings(JSON.parse(raw) as QuentaSettingsFile);
        if (legacyOnly) await persistSettings();
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
      const currentPath = conversationsPath();
      const legacyPath = legacyConversationsPath();
      const legacyOnly = !(await appStorage.exists(currentPath)) && (await appStorage.exists(legacyPath));
      const sourcePath = legacyOnly ? legacyPath : currentPath;
      if (await appStorage.exists(sourcePath)) {
        const raw = await appStorage.readText(sourcePath);
        const parsed = JSON.parse(raw) as QuentaConversationsFile;
        conversations = (parsed.conversations ?? [])
          .map((conversation) => {
            const normalized = legacyOnly ? normalizeLegacyConversation(conversation) : conversation;
            return {
              ...normalized,
              title: normalizeConversationTitle(normalized.title),
              tags: normalizeConversationTags(normalized.tags),
            };
          })
          .filter((conversation) => conversation.workspaceId === workspaceId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CONVERSATIONS);
        selectedConversationId = conversations[0]?.id ?? null;
        if (legacyOnly) await persistConversations();
      }
    } catch {
      conversations = [];
      selectedConversationId = null;
    }
  }

  function updateConversation(
    conversationId: string,
    mapper: (conversation: LiatirQuentaConversation) => LiatirQuentaConversation,
  ) {
    conversations = conversations
      .map((conversation) => conversation.id === conversationId ? mapper(conversation) : conversation)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function createConversation(input: {
    title?: string;
    focus?: LiatirQuentaFocus;
  } = {}): LiatirQuentaConversation {
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) throw new Error('Open a workspace before using Quenta');
    const timestamp = now();
    const conversation: LiatirQuentaConversation = {
      id: id('quenta-conversation'),
      workspaceId,
      title: normalizeConversationTitle(input.title ?? DEFAULT_CONVERSATION_TITLE),
      tags: [],
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

  function currentConversation(): LiatirQuentaConversation | null {
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
    intent: LiatirQuentaIntent = 'chat',
    options: { conversationId?: string; focus?: LiatirQuentaFocus } = {},
  ): Promise<void> {
    await quentaStore.init();
    const query = content.trim();
    if (!query) return;

    const existing = options.conversationId
      ? conversations.find((conversation) => conversation.id === options.conversationId)
      : currentConversation();
    const conversation = existing ?? createConversation({
      title: titleForIntent(intent, options.focus),
      focus: options.focus,
    });
    selectedConversationId = conversation.id;
    setConversationError(conversation.id, null);

    if (!settings.config.model.trim() || providerStatus?.available === false) {
      setConversationError(conversation.id, 'Quenta is still preparing local AI. Try again in a moment.');
      return;
    }

    const timestamp = now();
    const userMessage: LiatirQuentaMessage = {
      id: id('quenta-message'),
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
      const documents = await buildQuentaContextDocuments(focus);
      const retrieval = retrieveQuentaContext(query, documents, {
        requiredIds: requiredContextIdsForFocus(focus),
      });
      const history = messagesForHistory(priorMessages);
      const runtime = createQuentaRuntime(settings.config);
      const response = await runtime.chat({
        model: settings.config.model,
        messages: buildQuentaMessages(query, retrieval.context, history, intent),
        temperature: settings.config.temperature,
        thinkingEnabled: settings.config.thinkingEnabled ?? false,
        format: intent === 'report' ? QUENTA_REPORT_SCHEMA : undefined,
      });

      let assistantContent = response.content;
      let citations = citedSources(response.content, retrieval.citations);
      let report: LiatirQuentaMessage['report'];
      if (intent === 'report') {
        report = parseQuentaReport(response.content);
        assistantContent = quentaReportToMarkdown(report);
        citations = citationsFromIds(report.citationIds, retrieval.citations);
      }
      if (citations.length === 0) citations = retrieval.citations.slice(0, 4);

      const assistantMessage: LiatirQuentaMessage = {
        id: id('quenta-message'),
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
      setConversationError(conversation.id, quentaChatErrorMessage(error));
    } finally {
      setConversationSending(conversation.id, false);
    }
  }

  const quentaStore = {
    get settings() { return settings; },
    get config() { return settings.config; },
    get conversations() { return conversations; },
    get selectedConversationId() { return selectedConversationId; },
    get currentConversation() { return currentConversation(); },
    get initializing() { return initializing; },
    get providerStatus() { return providerStatus; },
    get providerModels() { return providerModels; },
    get providerRefreshing() { return providerRefreshing; },
    get setupPhase() { return setupPhase; },
    get setupError() { return setupError; },
    get defaultModel() { return QUENTA_DEFAULT_MODEL; },

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

    async updateConfig(patch: Partial<LiatirQuentaProviderConfig>) {
      settings = normalizeSettings({
        config: {
          ...settings.config,
          ...patch,
        },
      });
      await persistSettings();
    },

    async refreshProvider() {
      await quentaStore.init();
      providerRefreshing = true;
      try {
        const runtime = createQuentaRuntime(settings.config);
        const [status, models] = await Promise.all([
          runtime.status(),
          runtime.models().catch(() => [] as LiatirQuentaProviderModel[]),
        ]);
        providerStatus = status.available
          ? status
          : { ...status, error: ollamaStatusErrorMessage(settings.config.baseUrl, status.error) };
        providerModels = models;
        if (!settings.config.model && models.length === 1) {
          settings = normalizeSettings({ config: { ...settings.config, model: models[0].name } });
          await persistSettings();
        }
      } finally {
        providerRefreshing = false;
      }
    },

    async bootstrapProvider() {
      if (bootstrapPromise) return bootstrapPromise;
      bootstrapPromise = (async () => {
        await quentaStore.init();
        setupPhase = 'preparing';
        setupError = null;
        providerRefreshing = true;
        try {
          const runtime = createQuentaRuntime(settings.config);
          const targetModel = settings.config.model.trim() || QUENTA_DEFAULT_MODEL;
          setupPhase = 'downloading';
          const bootstrap = runtime.bootstrap
            ? await runtime.bootstrap(targetModel)
            : null;

          if (bootstrap) {
            providerStatus = bootstrap.status;
            providerModels = bootstrap.models;
            if (!settings.config.model.trim()) {
              settings = normalizeSettings({ config: { ...settings.config, model: bootstrap.model } });
              await persistSettings();
            }
          } else {
            await quentaStore.refreshProvider();
            if (!settings.config.model.trim()) {
              settings = normalizeSettings({ config: { ...settings.config, model: QUENTA_DEFAULT_MODEL } });
              await persistSettings();
            }
          }

          setupPhase = providerStatus?.available && settings.config.model.trim() ? 'ready' : 'failed';
          if (setupPhase === 'failed') {
            setupError = quentaSetupErrorMessage(providerStatus?.error ?? 'Quenta is not available yet.');
          }
        } catch (error) {
          setupPhase = 'failed';
          setupError = quentaSetupErrorMessage(error);
          providerStatus = {
            available: false,
            error: setupError,
          };
          providerModels = [];
        } finally {
          providerRefreshing = false;
          bootstrapPromise = null;
        }
      })();
      return bootstrapPromise;
    },

    selectConversation(conversationId: string) {
      if (conversations.some((conversation) => conversation.id === conversationId)) {
        selectedConversationId = conversationId;
      }
    },

    async newConversation() {
      await quentaStore.init();
      createConversation({ title: DEFAULT_CONVERSATION_TITLE });
    },

    async deleteConversation(conversationId: string) {
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (selectedConversationId === conversationId) selectedConversationId = conversations[0]?.id ?? null;
      const { [conversationId]: _sending, ...sendingRest } = sendingByConversation;
      const { [conversationId]: _error, ...errorRest } = errorByConversation;
      sendingByConversation = sendingRest;
      errorByConversation = errorRest;
      await persistConversations();
    },

    async renameConversation(conversationId: string, title: string) {
      const updatedAt = now();
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        title: normalizeConversationTitle(title),
        updatedAt,
      }));
      await persistConversations();
    },

    async updateConversationTags(conversationId: string, tags: string[]) {
      const updatedAt = now();
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        tags: normalizeConversationTags(tags),
        updatedAt,
      }));
      await persistConversations();
    },

    async startFocusedConversation(intent: LiatirQuentaIntent, focus: LiatirQuentaFocus, autoSend = true) {
      await quentaStore.init();
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

  return quentaStore;
}

export const quentaStore = createQuentaStore();
