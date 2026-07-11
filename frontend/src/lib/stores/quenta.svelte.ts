import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import { liatir } from '$lib/api';
import { buildQuentaContextDocuments, requiredContextIdsForFocus } from '$lib/quenta/context';
import { buildQuentaMessages, buildQuentaReportRepairMessages } from '$lib/quenta/prompt';
import { citedSources, retrieveQuentaContext } from '$lib/quenta/retrieval';
import { QUENTA_REPORT_SCHEMA, parseQuentaReport, quentaReportToMarkdown } from '$lib/quenta/report';
import { createQuentaRuntime } from '$lib/quenta/runtime';
import {
  applyConversationMutation,
  createSerializedWriteQueue,
  type QuentaConversationMutation,
} from '$lib/quenta/persistence';
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
  LiatirQuentaStreamEvent,
} from '@liatir/core';

const SETTINGS_FILE = 'quenta/settings.json';
const LEGACY_SETTINGS_FILE = 'tutor/settings.json';
const MAX_CONVERSATIONS = 40;
const MAX_MESSAGES_PER_CONVERSATION = 120;
const MAX_CONVERSATION_TAGS = 3;
const MAX_CONVERSATION_TAG_LENGTH = 28;
const MAX_CONVERSATION_TITLE_LENGTH = 96;
const MAX_REASONING_CHARS = 32_000;
const ACTIVE_REQUESTS_SESSION_STORAGE_KEY = 'quenta-active-request-ids';
export const QUENTA_DEFAULT_MODEL = 'qwen3.5:9b';
type QuentaSetupPhase = 'idle' | 'preparing' | 'downloading' | 'ready' | 'failed';

export type QuentaGenerationPhase =
  | 'reading-context'
  | 'selecting-sources'
  | 'thinking'
  | 'writing-response'
  | 'validating-report'
  | 'repairing-report'
  | 'finalizing-report'
  | 'stopping';

export interface QuentaActiveResponse {
  requestId: string;
  intent: LiatirQuentaIntent;
  phase: QuentaGenerationPhase;
  thinkingEnabled: boolean;
  startedAt: number;
  reasoningStartedAt?: number;
  answerStartedAt?: number;
  contextDocumentCount?: number;
  sourceCount?: number;
  reportRepairAttempted: boolean;
  reasoning: string;
  content: string;
  revision: number;
}

interface QuentaComposerSettings {
  enterToSend: boolean;
}

interface QuentaSettingsFile {
  config: LiatirQuentaProviderConfig;
  composer: QuentaComposerSettings;
}

interface QuentaConversationsFile {
  revision?: number;
  conversations: LiatirQuentaConversation[];
}

interface QuentaConversationsWriteResult {
  rel: string;
  applied: boolean;
  revision: number;
  conversations: LiatirQuentaConversation[];
}

interface QuentaConversationsChangedEvent {
  rel: string;
  revision: number;
}

const DEFAULT_CONFIG: LiatirQuentaProviderConfig = {
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  embeddingModel: '',
  temperature: 0.2,
  thinkingEnabled: false,
};
const DEFAULT_COMPOSER_SETTINGS: QuentaComposerSettings = {
  enterToSend: true,
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

function boundedReasoning(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_REASONING_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_REASONING_CHARS)}\n\n[Reasoning trace truncated.]`;
}

function storedActiveRequestIds(): string[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredActiveRequestIds(requestIds: string[]) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (requestIds.length === 0) sessionStorage.removeItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY);
    else sessionStorage.setItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY, JSON.stringify(requestIds));
  } catch {
    // Session storage can be unavailable in restricted webviews.
  }
}

function rememberActiveRequest(requestId: string) {
  writeStoredActiveRequestIds([...new Set([...storedActiveRequestIds(), requestId])]);
}

function forgetActiveRequest(requestId: string) {
  writeStoredActiveRequestIds(storedActiveRequestIds().filter((value) => value !== requestId));
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

export function quentaPromptForFocus(intent: LiatirQuentaIntent, focus: LiatirQuentaFocus): string {
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
    composer: {
      ...DEFAULT_COMPOSER_SETTINGS,
      ...(value?.composer ?? {}),
      enterToSend: Boolean(value?.composer?.enterToSend ?? DEFAULT_COMPOSER_SETTINGS.enterToSend),
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
  if (detail.includes('structured report') || detail.includes('Quenta report')) {
    return 'Quenta could not format this report. Try generating it again.';
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

function normalizeStoredConversations(
  stored: LiatirQuentaConversation[],
  workspaceId: string,
  legacy = false,
): LiatirQuentaConversation[] {
  return stored
    .map((conversation) => {
      const normalized = legacy ? normalizeLegacyConversation(conversation) : conversation;
      return {
        ...normalized,
        title: normalizeConversationTitle(normalized.title),
        tags: normalizeConversationTags(normalized.tags),
      };
    })
    .filter((conversation) => conversation.workspaceId === workspaceId)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
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
  let stoppingByConversation = $state<Record<string, boolean>>({});
  let errorByConversation = $state<Record<string, string>>({});
  let activeResponsesByConversation = $state<Record<string, QuentaActiveResponse>>({});
  const activeRequestsByConversation = new Map<string, {
    requestId: string;
    runtimeStarted: boolean;
  }>();
  const stoppedRequestIds = new Set<string>();
  let bootstrapPromise: Promise<void> | null = null;
  let conversationEventsPromise: Promise<void> | null = null;
  let interruptedRequestsRecovered = false;
  const enqueueConversationWrite = createSerializedWriteQueue();
  const conversationPersistenceByPath = new Map<string, {
    revision: number;
    conversations: LiatirQuentaConversation[];
  }>();

  async function persistSettings() {
    await appStorage.writeText(SETTINGS_FILE, JSON.stringify(settings, null, 2), { createDirs: true });
  }

  async function cancelInterruptedRequests() {
    if (interruptedRequestsRecovered) return;
    interruptedRequestsRecovered = true;
    const requestIds = storedActiveRequestIds();
    writeStoredActiveRequestIds([]);
    if (requestIds.length === 0) return;
    const runtime = createQuentaRuntime(settings.config);
    await Promise.all(requestIds.map((requestId) => runtime.cancelChat(requestId).catch(() => false)));
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

  function commitConversationMutation(mutation: QuentaConversationMutation): Promise<void> {
    const path = conversationsPath();
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) return Promise.resolve();
    return enqueueConversationWrite(async () => {
      const api = liatir();
      if (!api) return;
      let persisted = conversationPersistenceByPath.get(path) ?? {
        revision: 0,
        conversations: [] as LiatirQuentaConversation[],
      };

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const next = applyConversationMutation(persisted.conversations, mutation, {
          maxConversations: MAX_CONVERSATIONS,
          maxMessages: MAX_MESSAGES_PER_CONVERSATION,
        });
        if (JSON.stringify(next) === JSON.stringify(persisted.conversations)) return;

        const result = await api.invoke('lia_quenta_conversations_compare_and_swap', {
          rel: path,
          expectedRevision: persisted.revision,
          conversations: next,
        }) as QuentaConversationsWriteResult;
        persisted = {
          revision: result.revision,
          conversations: normalizeStoredConversations(result.conversations, workspaceId),
        };
        conversationPersistenceByPath.set(path, persisted);
        if (result.applied) return;
      }
      throw new Error('Quenta conversations changed too many times. Try again.');
    });
  }

  function applyConversationSnapshot(snapshot: QuentaConversationsWriteResult) {
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId || snapshot.rel !== conversationsPath()) return;
    const normalized = normalizeStoredConversations(snapshot.conversations, workspaceId);
    conversationPersistenceByPath.set(snapshot.rel, {
      revision: snapshot.revision,
      conversations: normalized,
    });

    const availableIds = new Set(normalized.map((conversation) => conversation.id));
    const removedActiveIds = [...activeRequestsByConversation.keys()]
      .filter((conversationId) => !availableIds.has(conversationId));
    conversations = normalized;
    if (selectedConversationId && !availableIds.has(selectedConversationId)) {
      selectedConversationId = null;
    }
    errorByConversation = Object.fromEntries(
      normalized
        .filter((conversation) => conversation.messages.at(-1)?.role === 'user')
        .flatMap((conversation) => {
          const error = errorByConversation[conversation.id];
          return error ? [[conversation.id, error]] : [];
        }),
    );
    for (const conversationId of removedActiveIds) void stopMessage(conversationId);
  }

  async function refreshConversationSnapshot(event: QuentaConversationsChangedEvent) {
    if (event.rel !== conversationsPath() || !(await appStorage.exists(event.rel))) return;
    const parsed = JSON.parse(await appStorage.readText(event.rel)) as QuentaConversationsFile;
    applyConversationSnapshot({
      rel: event.rel,
      applied: true,
      revision: parsed.revision ?? event.revision,
      conversations: parsed.conversations ?? [],
    });
  }

  function ensureConversationEvents(): Promise<void> {
    if (conversationEventsPromise) return conversationEventsPromise;
    conversationEventsPromise = (async () => {
      const api = liatir();
      if (!api) return;
      await api.desktop.events.on(
        'quenta:conversations-updated',
        (event: QuentaConversationsChangedEvent) => {
          void refreshConversationSnapshot(event).catch(() => undefined);
        },
      );
    })().catch((error) => {
      conversationEventsPromise = null;
      throw error;
    });
    return conversationEventsPromise;
  }

  async function loadConversationsForActiveWorkspace() {
    const workspaceId = workspaceStore.activeId;
    if (loadedWorkspaceId === workspaceId) return;
    loadedWorkspaceId = workspaceId;
    conversations = [];
    selectedConversationId = null;
    errorByConversation = {};
    sendingByConversation = {};
    stoppingByConversation = {};
    activeResponsesByConversation = {};
    activeRequestsByConversation.clear();
    stoppedRequestIds.clear();
    if (!workspaceId) return;

    try {
      const currentPath = conversationsPath();
      const legacyPath = legacyConversationsPath();
      const legacyOnly = !(await appStorage.exists(currentPath)) && (await appStorage.exists(legacyPath));
      const sourcePath = legacyOnly ? legacyPath : currentPath;
      if (await appStorage.exists(sourcePath)) {
        const raw = await appStorage.readText(sourcePath);
        const parsed = JSON.parse(raw) as QuentaConversationsFile;
        conversations = normalizeStoredConversations(
          parsed.conversations ?? [],
          workspaceId,
          legacyOnly,
        );
        conversationPersistenceByPath.set(currentPath, legacyOnly
          ? { revision: 0, conversations: [] }
          : { revision: parsed.revision ?? 0, conversations });
        selectedConversationId = null;
        errorByConversation = Object.fromEntries(
          conversations
            .filter((conversation) => conversation.messages.at(-1)?.role === 'user')
            .map((conversation) => [
              conversation.id,
              'The previous response did not finish. Retry it to continue.',
            ]),
        );
        if (legacyOnly) {
          await commitConversationMutation({ kind: 'merge', conversations });
        }
      } else {
        conversationPersistenceByPath.set(currentPath, { revision: 0, conversations: [] });
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
    draft?: string;
    draftIntent?: LiatirQuentaIntent;
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
      draft: input.draft,
      draftIntent: input.draftIntent,
      messages: [],
    };
    conversations = [conversation, ...conversations].slice(0, MAX_CONVERSATIONS);
    selectedConversationId = conversation.id;
    return conversation;
  }

  function currentConversation(): LiatirQuentaConversation | null {
    return conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  }

  function updateActiveResponse(
    conversationId: string,
    requestId: string,
    patch: Partial<QuentaActiveResponse>,
  ) {
    const current = activeResponsesByConversation[conversationId];
    if (!current || current.requestId !== requestId) return;
    activeResponsesByConversation = {
      ...activeResponsesByConversation,
      [conversationId]: {
        ...current,
        ...patch,
        revision: current.revision + 1,
      },
    };
  }

  function clearActiveResponse(conversationId: string, requestId: string) {
    if (activeResponsesByConversation[conversationId]?.requestId !== requestId) return;
    const { [conversationId]: _completed, ...rest } = activeResponsesByConversation;
    activeResponsesByConversation = rest;
  }

  function handleStreamEvent(
    conversationId: string,
    requestId: string,
    event: LiatirQuentaStreamEvent,
  ) {
    const active = activeResponsesByConversation[conversationId];
    if (!active || active.requestId !== requestId || !event.delta) return;
    const timestamp = now();
    if (event.type === 'thinking-delta') {
      updateActiveResponse(conversationId, requestId, {
        phase: active.phase === 'repairing-report' ? 'repairing-report' : 'thinking',
        reasoningStartedAt: active.reasoningStartedAt ?? timestamp,
        reasoning: `${active.reasoning}${event.delta}`.slice(0, MAX_REASONING_CHARS),
      });
      return;
    }
    updateActiveResponse(conversationId, requestId, {
      phase: active.phase === 'repairing-report' ? 'repairing-report' : 'writing-response',
      answerStartedAt: active.answerStartedAt ?? timestamp,
      content: active.content + event.delta,
    });
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
    options: {
      conversationId?: string;
      focus?: LiatirQuentaFocus;
      reuseLastUserMessage?: boolean;
    } = {},
  ): Promise<void> {
    await quentaStore.init();
    const query = content.trim();
    if (!query) return;

    const conversation = options.conversationId
      ? conversations.find((conversation) => conversation.id === options.conversationId)
      : currentConversation();
    if (!conversation) return;
    selectedConversationId = conversation.id;
    setConversationError(conversation.id, null);

    if (!settings.config.model.trim() || providerStatus?.available === false) {
      setConversationError(conversation.id, 'Quenta is still preparing local AI. Try again in a moment.');
      return;
    }

    const lastMessage = conversation.messages.at(-1);
    const reuseLastUserMessage = Boolean(
      options.reuseLastUserMessage
      && lastMessage?.role === 'user'
      && lastMessage.content === query,
    );
    const priorMessages = reuseLastUserMessage
      ? conversation.messages.slice(0, -1)
      : conversation.messages;
    if (!reuseLastUserMessage) {
      const timestamp = now();
      const userMessage: LiatirQuentaMessage = {
        id: id('quenta-message'),
        role: 'user',
        intent,
        content: query,
        createdAt: timestamp,
      };
      updateConversation(conversation.id, (item) => ({
        ...item,
        focus: options.focus ?? item.focus,
        draft: undefined,
        draftIntent: undefined,
        updatedAt: timestamp,
        messages: [...item.messages, userMessage].slice(-MAX_MESSAGES_PER_CONVERSATION),
      }));
      await commitConversationMutation({
        kind: 'append-message',
        conversationId: conversation.id,
        message: userMessage,
        focus: options.focus,
        clearDraft: true,
      });
    }

    const requestId = id('quenta-request');
    const activeRequest = { requestId, runtimeStarted: false };
    activeRequestsByConversation.set(conversation.id, activeRequest);
    activeResponsesByConversation = {
      ...activeResponsesByConversation,
      [conversation.id]: {
        requestId,
        intent,
        phase: 'reading-context',
        thinkingEnabled: settings.config.thinkingEnabled ?? false,
        startedAt: now(),
        reportRepairAttempted: false,
        reasoning: '',
        content: '',
        revision: 0,
      },
    };
    rememberActiveRequest(requestId);
    setConversationSending(conversation.id, true);
    try {
      const focus = options.focus ?? conversation.focus;
      const documents = await buildQuentaContextDocuments(focus);
      updateActiveResponse(conversation.id, requestId, {
        phase: 'selecting-sources',
        contextDocumentCount: documents.length,
      });
      const retrieval = retrieveQuentaContext(query, documents, {
        requiredIds: requiredContextIdsForFocus(focus),
      });
      updateActiveResponse(conversation.id, requestId, {
        phase: settings.config.thinkingEnabled ? 'thinking' : 'writing-response',
        sourceCount: retrieval.documents.length,
      });
      const history = messagesForHistory(priorMessages);
      const runtime = createQuentaRuntime(settings.config);
      if (stoppedRequestIds.has(requestId)) return;
      activeRequest.runtimeStarted = true;
      let response = await runtime.chat({
        model: settings.config.model,
        messages: buildQuentaMessages(query, retrieval.context, history, intent),
        temperature: settings.config.temperature,
        thinkingEnabled: settings.config.thinkingEnabled ?? false,
        format: intent === 'report' ? QUENTA_REPORT_SCHEMA : undefined,
      }, requestId, (event) => handleStreamEvent(conversation.id, requestId, event));
      if (stoppedRequestIds.has(requestId)) return;

      let assistantContent = response.content;
      let citations = citedSources(response.content, retrieval.citations);
      let report: LiatirQuentaMessage['report'];
      let reportRepairAttempted = false;
      if (intent === 'report') {
        updateActiveResponse(conversation.id, requestId, { phase: 'validating-report' });
        try {
          report = parseQuentaReport(response.content);
        } catch {
          reportRepairAttempted = true;
          updateActiveResponse(conversation.id, requestId, {
            phase: 'repairing-report',
            reportRepairAttempted: true,
            content: '',
          });
          response = await runtime.chat({
            model: settings.config.model,
            messages: buildQuentaReportRepairMessages(response.content),
            temperature: 0,
            thinkingEnabled: false,
            format: QUENTA_REPORT_SCHEMA,
          }, requestId, (event) => handleStreamEvent(conversation.id, requestId, event));
          if (stoppedRequestIds.has(requestId)) return;
          report = parseQuentaReport(response.content);
        }
        updateActiveResponse(conversation.id, requestId, { phase: 'finalizing-report' });
        assistantContent = quentaReportToMarkdown(report);
        citations = citationsFromIds(report.citationIds, retrieval.citations);
      }
      if (citations.length === 0) citations = retrieval.citations.slice(0, 4);

      const completedAt = now();
      const generation = activeResponsesByConversation[conversation.id];
      const reasoning = boundedReasoning(response.thinking ?? generation?.reasoning ?? '');
      const assistantMessage: LiatirQuentaMessage = {
        id: id('quenta-message'),
        role: 'assistant',
        intent,
        content: assistantContent,
        createdAt: completedAt,
        citations,
        model: response.model,
        report,
        generation: {
          reasoning,
          durationMs: generation ? completedAt - generation.startedAt : undefined,
          reasoningDurationMs: generation?.reasoningStartedAt
            ? (generation.answerStartedAt ?? completedAt) - generation.reasoningStartedAt
            : undefined,
          contextDocumentCount: documents.length,
          sourceCount: retrieval.documents.length,
          reportRepairAttempted,
        },
      };
      clearActiveResponse(conversation.id, requestId);
      updateConversation(conversation.id, (item) => ({
        ...item,
        updatedAt: assistantMessage.createdAt,
        messages: [...item.messages, assistantMessage].slice(-MAX_MESSAGES_PER_CONVERSATION),
      }));
      await commitConversationMutation({
        kind: 'append-message',
        conversationId: conversation.id,
        message: assistantMessage,
      });
    } catch (error) {
      if (!stoppedRequestIds.has(requestId)) {
        setConversationError(conversation.id, quentaChatErrorMessage(error));
      }
    } finally {
      if (activeRequestsByConversation.get(conversation.id)?.requestId === requestId) {
        activeRequestsByConversation.delete(conversation.id);
      }
      stoppedRequestIds.delete(requestId);
      forgetActiveRequest(requestId);
      clearActiveResponse(conversation.id, requestId);
      const { [conversation.id]: _stopping, ...stoppingRest } = stoppingByConversation;
      stoppingByConversation = stoppingRest;
      setConversationSending(conversation.id, false);
    }
  }

  async function stopMessage(conversationId: string): Promise<void> {
    const activeRequest = activeRequestsByConversation.get(conversationId);
    if (!activeRequest || stoppedRequestIds.has(activeRequest.requestId)) return;
    stoppedRequestIds.add(activeRequest.requestId);
    stoppingByConversation = { ...stoppingByConversation, [conversationId]: true };
    updateActiveResponse(conversationId, activeRequest.requestId, { phase: 'stopping' });
    setConversationError(conversationId, 'Response stopped. Retry it to continue.');
    if (!activeRequest.runtimeStarted) return;
    try {
      const runtime = createQuentaRuntime(settings.config);
      await runtime.cancelChat(activeRequest.requestId);
    } catch {
      // The response may finish between the Stop click and cancellation.
    }
  }

  async function retryLastMessage(conversationId: string): Promise<void> {
    await quentaStore.init();
    const conversation = conversations.find((item) => item.id === conversationId);
    const message = conversation?.messages.at(-1);
    if (!conversation || message?.role !== 'user' || sendingByConversation[conversationId]) return;
    await sendMessage(message.content, message.intent, {
      conversationId,
      focus: conversation.focus,
      reuseLastUserMessage: true,
    });
  }

  const quentaStore = {
    get settings() { return settings; },
    get config() { return settings.config; },
    get composerSettings() { return settings.composer; },
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

    isStopping(conversationId: string | null | undefined) {
      return conversationId ? Boolean(stoppingByConversation[conversationId]) : false;
    },

    canRetry(conversationId: string | null | undefined) {
      if (!conversationId || sendingByConversation[conversationId]) return false;
      return conversations.find((conversation) => conversation.id === conversationId)?.messages.at(-1)?.role === 'user';
    },

    errorFor(conversationId: string | null | undefined) {
      return conversationId ? errorByConversation[conversationId] ?? null : null;
    },

    activeResponseFor(conversationId: string | null | undefined) {
      return conversationId ? activeResponsesByConversation[conversationId] ?? null : null;
    },

    async init() {
      if (initializing) return;
      initializing = true;
      try {
        await workspaceStore.init();
        await ensureConversationEvents();
        await loadSettings();
        await cancelInterruptedRequests();
        await loadConversationsForActiveWorkspace();
      } finally {
        initializing = false;
      }
    },

    async updateConfig(patch: Partial<LiatirQuentaProviderConfig>) {
      settings = normalizeSettings({
        ...settings,
        config: {
          ...settings.config,
          ...patch,
        },
      });
      await persistSettings();
    },

    async updateComposerSettings(patch: Partial<QuentaComposerSettings>) {
      settings = normalizeSettings({
        ...settings,
        composer: {
          ...settings.composer,
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
          settings = normalizeSettings({ ...settings, config: { ...settings.config, model: models[0].name } });
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
              settings = normalizeSettings({ ...settings, config: { ...settings.config, model: bootstrap.model } });
              await persistSettings();
            }
          } else {
            await quentaStore.refreshProvider();
            if (!settings.config.model.trim()) {
              settings = normalizeSettings({ ...settings, config: { ...settings.config, model: QUENTA_DEFAULT_MODEL } });
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

    clearConversationSelection() {
      selectedConversationId = null;
    },

    async newConversation() {
      await quentaStore.init();
      const conversation = createConversation({ title: DEFAULT_CONVERSATION_TITLE });
      await commitConversationMutation({ kind: 'create', conversation });
    },

    async deleteConversation(conversationId: string) {
      await stopMessage(conversationId);
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (selectedConversationId === conversationId) selectedConversationId = null;
      const { [conversationId]: _sending, ...sendingRest } = sendingByConversation;
      const { [conversationId]: _error, ...errorRest } = errorByConversation;
      const { [conversationId]: _stopping, ...stoppingRest } = stoppingByConversation;
      const { [conversationId]: _activeResponse, ...activeResponseRest } = activeResponsesByConversation;
      sendingByConversation = sendingRest;
      errorByConversation = errorRest;
      stoppingByConversation = stoppingRest;
      activeResponsesByConversation = activeResponseRest;
      await commitConversationMutation({ kind: 'delete', conversationId });
    },

    async renameConversation(conversationId: string, title: string) {
      const updatedAt = now();
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        title: normalizeConversationTitle(title),
        updatedAt,
      }));
      await commitConversationMutation({
        kind: 'rename',
        conversationId,
        title: normalizeConversationTitle(title),
        updatedAt,
      });
    },

    async updateConversationTags(conversationId: string, tags: string[]) {
      const updatedAt = now();
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        tags: normalizeConversationTags(tags),
        updatedAt,
      }));
      await commitConversationMutation({
        kind: 'tags',
        conversationId,
        tags: normalizeConversationTags(tags),
        updatedAt,
      });
    },

    async updateConversationDraft(
      conversationId: string,
      draft: string,
      draftIntent: LiatirQuentaIntent,
    ) {
      const updatedAt = now();
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        draft,
        draftIntent,
        updatedAt,
      }));
      await commitConversationMutation({
        kind: 'draft',
        conversationId,
        draft,
        draftIntent,
        updatedAt,
      });
    },

    async startFocusedConversation(intent: LiatirQuentaIntent, focus: LiatirQuentaFocus, autoSend = true) {
      await quentaStore.init();
      const prompt = quentaPromptForFocus(intent, focus);
      const conversation = createConversation({
        title: titleForIntent(intent, focus),
        focus,
        draft: autoSend ? undefined : prompt,
        draftIntent: autoSend ? undefined : intent,
      });
      await commitConversationMutation({ kind: 'create', conversation });
      if (autoSend) {
        await sendMessage(prompt, intent, {
          conversationId: conversation.id,
          focus,
        });
      }
      return conversation;
    },

    sendMessage,
    stopMessage,
    retryLastMessage,
  };

  return quentaStore;
}

export const quentaStore = createQuentaStore();
