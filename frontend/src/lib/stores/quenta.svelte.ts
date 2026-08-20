import { appStorage } from './app-storage';
import { getDataPrefix, workspaceStore } from './workspace.svelte';
import { liatir } from '$lib/api';
import { buildQuentaContextDocuments, requiredContextIdsForFocus } from '$lib/quenta/context';
import { initKnowledgeSync } from '$lib/quenta/knowledge-sync';
import {
  buildQuentaMessages,
  buildQuentaPlainLanguageRepairMessages,
} from '$lib/quenta/prompt';
import {
  citedSources,
  isQuentaSelfDocumentation,
  isUserVisibleSource,
  retrieveQuentaContext,
} from '$lib/quenta/retrieval';
import { quentaResponseNeedsPlainLanguageRepair } from '$lib/quenta/response-safety';
import { sanitizeQuentaReasoning } from '$lib/quenta/reasoning-safety';
import { createQuentaRuntime } from '$lib/quenta/runtime';
import {
  applyConversationMutation,
  createSerializedWriteQueue,
  type QuentaConversationMutation,
} from '$lib/quenta/persistence';
import type {
  LiatirQuentaCitation,
  LiatirQuentaChatResponse,
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
const MAX_ACTIVE_REASONING_CHARS = 32_000;
const ACTIVE_REQUESTS_SESSION_STORAGE_KEY = 'quenta-active-requests';
export const QUENTA_DEFAULT_MODEL = 'qwen3.5:9b';
type QuentaSetupPhase = 'idle' | 'preparing' | 'downloading' | 'ready' | 'failed';

export type QuentaGenerationPhase =
  | 'reading-context'
  | 'selecting-sources'
  | 'thinking'
  | 'writing-response'
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
  reasoning: string;
  contentBuffer: string;
  content: string;
  revision: number;
}

interface QuentaComposerSettings {
  enterToSend: boolean;
}

interface QuentaSettingsFile {
  config: LiatirQuentaProviderConfig;
  composer: QuentaComposerSettings;
  autoScrollToBottom: boolean;
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

interface StoredQuentaActiveRequest {
  requestId: string;
  conversationId: string;
  workspaceId: string;
  userMessageId: string;
  intent: LiatirQuentaIntent;
  focus?: LiatirQuentaFocus;
  startedAt: number;
  context: string;
  citations: LiatirQuentaCitation[];
  contextDocumentCount: number;
  sourceCount: number;
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

function storedActiveRequests(): StoredQuentaActiveRequest[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is StoredQuentaActiveRequest => (
          value && typeof value === 'object'
          && typeof value.requestId === 'string'
          && typeof value.conversationId === 'string'
          && typeof value.workspaceId === 'string'
          && typeof value.userMessageId === 'string'
        ))
      : [];
  } catch {
    return [];
  }
}

function writeStoredActiveRequests(requests: StoredQuentaActiveRequest[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (requests.length === 0) localStorage.removeItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY);
    else localStorage.setItem(ACTIVE_REQUESTS_SESSION_STORAGE_KEY, JSON.stringify(requests));
  } catch {
    // Local storage can be unavailable in restricted webviews.
  }
}

function selectedConversationStorageKey(workspaceId: string): string {
  return `quenta-selected-conversation:${workspaceId}`;
}

function rememberSelectedConversation(workspaceId: string, conversationId: string | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    const key = selectedConversationStorageKey(workspaceId);
    if (conversationId) localStorage.setItem(key, conversationId);
    else localStorage.removeItem(key);
  } catch {
    // Local storage can be unavailable in restricted webviews.
  }
}

function storedSelectedConversation(workspaceId: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(selectedConversationStorageKey(workspaceId));
  } catch {
    return null;
  }
}

function rememberActiveRequest(request: StoredQuentaActiveRequest) {
  writeStoredActiveRequests([
    ...storedActiveRequests().filter((item) => item.requestId !== request.requestId),
    request,
  ]);
}

function forgetActiveRequest(requestId: string) {
  writeStoredActiveRequests(storedActiveRequests().filter((value) => value.requestId !== requestId));
}

function id(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function titleForIntent(intent: LiatirQuentaIntent, focus?: LiatirQuentaFocus): string {
  if (intent === 'explain-failure') return focus ? `Failure explanation for ${focus.kind} ${focus.entityId}` : 'Failure explanation';
  if (intent === 'explain-result') return focus ? `Result explanation for ${focus.entityId}` : 'Result explanation';
  return DEFAULT_CONVERSATION_TITLE;
}

function stableFocusedConversationId(
  workspaceId: string,
  intent: LiatirQuentaIntent,
  focus: LiatirQuentaFocus,
): string {
  const value = `${workspaceId}:${intent}:${focus.kind}:${focus.entityId}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `quenta-focused-${focus.kind}-${(hash >>> 0).toString(36)}`;
}

function focusedConversationIdentity(conversation: LiatirQuentaConversation): string | null {
  const focus = conversation.focus;
  if (!focus || (conversation.tags?.length ?? 0) > 0) return null;
  const userMessages = conversation.messages.filter((message) => message.role === 'user');
  if (userMessages.length > 1) return null;
  const intent = conversation.draftIntent ?? userMessages[0]?.intent;
  if (!intent || intent === 'chat') return null;
  if (conversation.title !== titleForIntent(intent, focus)) return null;
  const expectedPrompt = quentaPromptForFocus(intent, focus);
  if (userMessages[0] && userMessages[0].content !== expectedPrompt) return null;
  return `${conversation.workspaceId}:${intent}:${focus.kind}:${focus.entityId}`;
}

export function dedupeFocusedConversations(
  stored: LiatirQuentaConversation[],
): LiatirQuentaConversation[] {
  const winners = new Map<string, LiatirQuentaConversation>();
  for (const conversation of stored) {
    const key = focusedConversationIdentity(conversation);
    if (!key) continue;
    const current = winners.get(key);
    if (
      !current
      || conversation.messages.length > current.messages.length
      || (
        conversation.messages.length === current.messages.length
        && conversation.updatedAt > current.updatedAt
      )
    ) {
      winners.set(key, conversation);
    }
  }
  return stored.filter((conversation) => {
    const key = focusedConversationIdentity(conversation);
    return !key || winners.get(key)?.id === conversation.id;
  });
}

export function quentaPromptForFocus(intent: LiatirQuentaIntent, focus: LiatirQuentaFocus): string {
  if (intent === 'explain-failure') {
    return `Explain why ${focus.kind} ${focus.entityId} failed or was cancelled. Use the recorded status, logs, metadata, and outputs. Give safe troubleshooting steps without executing anything.`;
  }
  if (intent === 'explain-result') {
    return `Explain result ${focus.entityId}. Summarize what was observed, what the output means, limitations, and sensible next validation steps.`;
  }
  return `Explain ${focus.kind} ${focus.entityId}. Summarize the relevant evidence and limitations.`;
}

function messagesForHistory(messages: LiatirQuentaMessage[]): LiatirQuentaRuntimeMessage[] {
  return messages.slice(-8).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 2_500),
  }));
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
    autoScrollToBottom: (value?.autoScrollToBottom) ?? false
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

function generateAutoTitle(content: string): string {
  // Pulisce gli a capo e gli spazi in eccesso
  const clean = content.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return DEFAULT_CONVERSATION_TITLE;
  
  const maxLength = 36;
  if (clean.length <= maxLength) return clean.charAt(0).toUpperCase() + clean.slice(1);
  
  // Taglia alla lunghezza massima, cercando di non spezzare l'ultima parola
  const truncated = clean.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const finalTitle = lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated;
  
  return `${finalTitle.charAt(0).toUpperCase() + finalTitle.slice(1)}...`;
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
  if (detail.includes('selected result is unavailable') || detail.includes('selected job is unavailable')) {
    return 'Quenta could not open the selected item. Return to Results or Jobs and try again.';
  }
  if (detail.includes('Ollama chat failed') || detail.includes('error sending request')) {
    return 'Local AI is not running yet. Quenta is preparing it automatically; try again in a moment.';
  }
  if (detail.includes('response took too long') || detail.includes('timed out')) {
    return 'Quenta could not finish this response within the extended safety limit. You can retry when ready.';
  }
  if (detail.includes('structured report') || detail.includes('Quenta report')) {
    return 'Quenta could not format this report. Try generating it again.';
  }
  return 'Quenta could not finish this response. Try again in a moment.';
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
  let initializePromise: Promise<void> | null = null;
  let bootstrapPromise: Promise<void> | null = null;
  let conversationEventsPromise: Promise<void> | null = null;
  let activeRequestsRecovered = false;
  const enqueueConversationWrite = createSerializedWriteQueue();
  const conversationPersistenceByPath = new Map<string, {
    revision: number;
    conversations: LiatirQuentaConversation[];
  }>();

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
    const normalized = dedupeFocusedConversations(
      normalizeStoredConversations(snapshot.conversations, workspaceId),
    );
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
    activeRequestsRecovered = false;
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
        const normalizedConversations = normalizeStoredConversations(
          parsed.conversations ?? [],
          workspaceId,
          legacyOnly,
        );
        conversations = dedupeFocusedConversations(normalizedConversations);
        conversationPersistenceByPath.set(currentPath, legacyOnly
          ? { revision: 0, conversations: [] }
          : { revision: parsed.revision ?? 0, conversations: normalizedConversations });
        const rememberedConversationId = storedSelectedConversation(workspaceId);
        selectedConversationId = conversations.some((item) => item.id === rememberedConversationId)
          ? rememberedConversationId
          : null;
        const recoverableConversationIds = new Set(
          storedActiveRequests()
            .filter((request) => request.workspaceId === workspaceId)
            .map((request) => request.conversationId),
        );
        errorByConversation = Object.fromEntries(
          conversations
            .filter((conversation) => (
              conversation.messages.at(-1)?.role === 'user'
              && !recoverableConversationIds.has(conversation.id)
            ))
            .map((conversation) => [
              conversation.id,
              'The previous response did not finish. Retry it to continue.',
            ]),
        );
        if (legacyOnly) {
          await commitConversationMutation({ kind: 'merge', conversations });
        } else if (conversations.length !== normalizedConversations.length) {
          await commitConversationMutation({ kind: 'replace', conversations });
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
    id?: string;
    title?: string;
    focus?: LiatirQuentaFocus;
    draft?: string;
    draftIntent?: LiatirQuentaIntent;
  } = {}): LiatirQuentaConversation {
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) throw new Error('Open a workspace before using Quenta');
    const timestamp = now();
    const conversation: LiatirQuentaConversation = {
      id: input.id ?? id('quenta-conversation'),
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
    rememberSelectedConversation(workspaceId, conversation.id);
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
        phase: 'thinking',
        reasoningStartedAt: active.reasoningStartedAt ?? timestamp,
        reasoning: `${active.reasoning}${event.delta}`.slice(-MAX_ACTIVE_REASONING_CHARS),
      });
      return;
    }
    const contentBuffer = `${active.contentBuffer}${event.delta}`;
    updateActiveResponse(conversationId, requestId, {
      phase: 'writing-response',
      answerStartedAt: active.answerStartedAt ?? timestamp,
      contentBuffer,
      content: quentaResponseNeedsPlainLanguageRepair(contentBuffer) ? '' : contentBuffer,
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

  async function finalizeAssistantResponse(
    descriptor: StoredQuentaActiveRequest,
    initialResponse: LiatirQuentaChatResponse,
    runtime: ReturnType<typeof createQuentaRuntime>,
  ): Promise<void> {
    const conversation = conversations.find((item) => item.id === descriptor.conversationId);
    if (!conversation) return;
    const userMessageIndex = conversation.messages.findIndex(
      (message) => message.id === descriptor.userMessageId,
    );
    if (
      userMessageIndex >= 0
      && conversation.messages.slice(userMessageIndex + 1).some((message) => message.role === 'assistant')
    ) return;

    let response = initialResponse;
    let assistantContent = response.content;
    let citations = citedSources(response.content, descriptor.citations);
    let repairFailed = false;
    if (quentaResponseNeedsPlainLanguageRepair(response.content)) {
      updateActiveResponse(descriptor.conversationId, descriptor.requestId, {
        phase: 'writing-response',
        contentBuffer: '',
        content: '',
      });
      response = await runtime.chat({
        model: settings.config.model,
        messages: buildQuentaPlainLanguageRepairMessages(response.content, descriptor.context),
        temperature: 0,
        thinkingEnabled: false,
      }, descriptor.requestId, (event) => handleStreamEvent(
        descriptor.conversationId,
        descriptor.requestId,
        event,
      ));
      repairFailed = quentaResponseNeedsPlainLanguageRepair(response.content);
      assistantContent = repairFailed
        ? 'Quenta could not turn the available information into a clear, reliable explanation. Please try again.'
        : response.content;
      citations = citedSources(assistantContent, descriptor.citations);
    }
    // Only a real answer gets sources. When the repair fails the content is an apology, and
    // attaching retrieval candidates to it presented four documents as the basis of an explanation
    // that was never produced — the provenance panel has to mean what it says.
    if (citations.length === 0 && !repairFailed) citations = descriptor.citations.slice(0, 4);
    // And a source is something in the user's own workspace they can open — the Job that ran, the
    // Result it produced. Documentation and curated knowledge still reach the model and still shape
    // the answer, but showing them here described the app's own manual as evidence about the user's
    // experiment, and buried the two entries that let them actually check it.
    citations = citations.filter(isUserVisibleSource);

    const completedAt = now();
    const generation = activeResponsesByConversation[descriptor.conversationId];
    const reasoning = sanitizeQuentaReasoning(response.thinking ?? generation?.reasoning ?? '');
    const assistantMessage: LiatirQuentaMessage = {
      id: id('quenta-message'),
      role: 'assistant',
      intent: descriptor.intent,
      content: assistantContent,
      createdAt: completedAt,
      citations,
      model: response.model,
      generation: {
        reasoning: reasoning || undefined,
        durationMs: completedAt - descriptor.startedAt,
        reasoningDurationMs: generation?.reasoningStartedAt
          ? (generation.answerStartedAt ?? completedAt) - generation.reasoningStartedAt
          : undefined,
        contextDocumentCount: descriptor.contextDocumentCount,
        sourceCount: descriptor.sourceCount,
      },
    };
    clearActiveResponse(descriptor.conversationId, descriptor.requestId);
    updateConversation(descriptor.conversationId, (item) => ({
      ...item,
      updatedAt: assistantMessage.createdAt,
      messages: [...item.messages, assistantMessage].slice(-MAX_MESSAGES_PER_CONVERSATION),
    }));
    await commitConversationMutation({
      kind: 'append-message',
      conversationId: descriptor.conversationId,
      message: assistantMessage,
    });
  }

  async function waitForNativeResponse(
    descriptor: StoredQuentaActiveRequest,
    runtime: ReturnType<typeof createQuentaRuntime>,
  ): Promise<LiatirQuentaChatResponse> {
    while (true) {
      const snapshot = await runtime.chatStatus(descriptor.requestId);
      if (!snapshot) throw new Error('Quenta request state is unavailable');
      updateActiveResponse(descriptor.conversationId, descriptor.requestId, {
        phase: snapshot.thinking && !snapshot.content ? 'thinking' : 'writing-response',
        reasoning: snapshot.thinking.slice(-MAX_ACTIVE_REASONING_CHARS),
        contentBuffer: snapshot.content,
        content: quentaResponseNeedsPlainLanguageRepair(snapshot.content) ? '' : snapshot.content,
      });
      if (snapshot.status === 'completed' && snapshot.response) return snapshot.response;
      if (snapshot.status !== 'running') throw new Error(snapshot.error ?? 'Quenta response stopped');
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async function finishRequestLifecycle(
    descriptor: StoredQuentaActiveRequest,
    task: () => Promise<LiatirQuentaChatResponse>,
  ): Promise<void> {
    const runtime = createQuentaRuntime(settings.config);
    let retainForReconnect = false;
    try {
      const response = await task();
      if (!stoppedRequestIds.has(descriptor.requestId)) {
        await finalizeAssistantResponse(descriptor, response, runtime);
      }
    } catch (error) {
      if (!stoppedRequestIds.has(descriptor.requestId)) {
        const snapshot = await runtime.chatStatus(descriptor.requestId).catch(() => null);
        if (!snapshot || snapshot.status === 'running' || snapshot.status === 'completed') {
          retainForReconnect = true;
        } else {
          setConversationError(descriptor.conversationId, quentaChatErrorMessage(error));
        }
      }
    } finally {
      if (retainForReconnect) return;
      activeRequestsByConversation.delete(descriptor.conversationId);
      stoppedRequestIds.delete(descriptor.requestId);
      forgetActiveRequest(descriptor.requestId);
      await runtime.forgetChat(descriptor.requestId).catch(() => false);
      clearActiveResponse(descriptor.conversationId, descriptor.requestId);
      const { [descriptor.conversationId]: _stopping, ...stoppingRest } = stoppingByConversation;
      stoppingByConversation = stoppingRest;
      setConversationSending(descriptor.conversationId, false);
    }
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

    // Se è il primissimo messaggio della chat e il titolo non è stato ancora modificato
    if (priorMessages.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      const autoTitle = normalizeConversationTitle(generateAutoTitle(query));
      const updatedAt = now();
      
      // 1. Aggiorna immediatamente lo stato locale
      updateConversation(conversation.id, (item) => ({
        ...item,
        title: autoTitle,
        updatedAt,
      }));
      
      // 2. Accoda il rename persistente (fire and forget)
      commitConversationMutation({
        kind: 'rename',
        conversationId: conversation.id,
        title: autoTitle,
        updatedAt,
      }).catch(() => undefined);
    }

    let userMessageId = reuseLastUserMessage ? lastMessage!.id : '';
    if (!reuseLastUserMessage) {
      const timestamp = now();
      const userMessage: LiatirQuentaMessage = {
        id: id('quenta-message'),
        role: 'user',
        intent,
        content: query,
        createdAt: timestamp,
      };
      userMessageId = userMessage.id;
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
        reasoning: '',
        contentBuffer: '',
        content: '',
        revision: 0,
      },
    };
    setConversationSending(conversation.id, true);
    try {
      const focus = options.focus ?? conversation.focus;
      const documents = await buildQuentaContextDocuments(focus);
      updateActiveResponse(conversation.id, requestId, {
        phase: 'selecting-sources',
        contextDocumentCount: documents.length,
      });
      const requiredIds = requiredContextIdsForFocus(focus);
      const missingRequiredSource = requiredIds.find(
        (sourceId) => !documents.some((document) => document.id === sourceId),
      );
      if (missingRequiredSource) {
        throw new Error(`selected ${focus?.kind ?? 'item'} is unavailable`);
      }
      const retrievalDocuments = focus
        ? documents.filter((document) => (
            requiredIds.includes(document.id)
            || (document.sourceKind !== focus.kind && !isQuentaSelfDocumentation(document.id))
          ))
        : documents;
      const retrieval = retrieveQuentaContext(query, retrievalDocuments, {
        requiredIds,
        limit: focus ? 5 : 8,
        maxChars: focus ? 18_000 : 14_000,
        // Open questions retrieve over the whole docs corpus, so reserve slots for the user's own
        // live state; a focused question is already scoped to one entity and needs no cap.
        referenceCap: focus ? undefined : 5,
      });
      updateActiveResponse(conversation.id, requestId, {
        phase: settings.config.thinkingEnabled ? 'thinking' : 'writing-response',
        sourceCount: retrieval.documents.length,
      });
      const history = messagesForHistory(priorMessages);
      const runtime = createQuentaRuntime(settings.config);
      if (stoppedRequestIds.has(requestId)) return;
      activeRequest.runtimeStarted = true;
      const descriptor: StoredQuentaActiveRequest = {
        requestId,
        conversationId: conversation.id,
        workspaceId: conversation.workspaceId,
        userMessageId,
        intent,
        focus,
        startedAt: activeResponsesByConversation[conversation.id]?.startedAt ?? now(),
        context: retrieval.context,
        citations: retrieval.citations,
        contextDocumentCount: documents.length,
        sourceCount: retrieval.documents.length,
      };
      rememberActiveRequest(descriptor);
      await finishRequestLifecycle(descriptor, () => runtime.chat({
        model: settings.config.model,
        messages: buildQuentaMessages(query, retrieval.context, history, intent, focus),
        temperature: settings.config.temperature,
        thinkingEnabled: settings.config.thinkingEnabled ?? false,
      }, requestId, (event) => handleStreamEvent(conversation.id, requestId, event)));
      return;
    } catch (error) {
      if (!stoppedRequestIds.has(requestId)) {
        setConversationError(conversation.id, quentaChatErrorMessage(error));
      }
    } finally {
      if (!storedActiveRequests().some((request) => request.requestId === requestId)) {
        if (activeRequestsByConversation.get(conversation.id)?.requestId === requestId) {
          activeRequestsByConversation.delete(conversation.id);
        }
        stoppedRequestIds.delete(requestId);
        clearActiveResponse(conversation.id, requestId);
        setConversationSending(conversation.id, false);
      }
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

  async function recoverActiveRequests(): Promise<void> {
    if (activeRequestsRecovered) return;
    activeRequestsRecovered = true;
    const workspaceId = workspaceStore.activeId;
    if (!workspaceId) return;
    const runtime = createQuentaRuntime(settings.config);
    for (const descriptor of storedActiveRequests().filter(
      (request) => request.workspaceId === workspaceId,
    )) {
      const conversation = conversations.find((item) => item.id === descriptor.conversationId);
      if (!conversation) {
        forgetActiveRequest(descriptor.requestId);
        await runtime.forgetChat(descriptor.requestId).catch(() => false);
        continue;
      }
      let snapshot = await runtime.chatStatus(descriptor.requestId).catch(() => null);
      for (let attempt = 0; !snapshot && attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        snapshot = await runtime.chatStatus(descriptor.requestId).catch(() => null);
      }
      if (!snapshot) {
        forgetActiveRequest(descriptor.requestId);
        setConversationError(
          descriptor.conversationId,
          'The previous response did not finish. Retry it to continue.',
        );
        continue;
      }
      if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
        forgetActiveRequest(descriptor.requestId);
        await runtime.forgetChat(descriptor.requestId).catch(() => false);
        setConversationError(descriptor.conversationId, quentaChatErrorMessage(snapshot.error));
        continue;
      }

      selectedConversationId = descriptor.conversationId;
      rememberSelectedConversation(workspaceId, descriptor.conversationId);
      activeRequestsByConversation.set(descriptor.conversationId, {
        requestId: descriptor.requestId,
        runtimeStarted: true,
      });
      activeResponsesByConversation = {
        ...activeResponsesByConversation,
        [descriptor.conversationId]: {
          requestId: descriptor.requestId,
          intent: descriptor.intent,
          phase: snapshot.thinking && !snapshot.content ? 'thinking' : 'writing-response',
          thinkingEnabled: Boolean(snapshot.thinking),
          startedAt: descriptor.startedAt,
          contextDocumentCount: descriptor.contextDocumentCount,
          sourceCount: descriptor.sourceCount,
          reasoning: snapshot.thinking.slice(-MAX_ACTIVE_REASONING_CHARS),
          contentBuffer: snapshot.content,
          content: quentaResponseNeedsPlainLanguageRepair(snapshot.content) ? '' : snapshot.content,
          revision: 0,
        },
      };
      setConversationError(descriptor.conversationId, null);
      setConversationSending(descriptor.conversationId, true);
      void finishRequestLifecycle(
        descriptor,
        () => snapshot.status === 'completed' && snapshot.response
          ? Promise.resolve(snapshot.response)
          : waitForNativeResponse(descriptor, runtime),
      );
    }
  }

  const quentaStore = {
    get settings() { return settings; },
    get config() { return settings.config; },
    get composerSettings() { return settings.composer; },
    get autoScrollToBottomSettings() { return settings.autoScrollToBottom; },
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
      if (initializePromise) return initializePromise;
      initializePromise = (async () => {
        initializing = true;
        try {
          await workspaceStore.init();
          await ensureConversationEvents();
          await loadSettings();
          await loadConversationsForActiveWorkspace();
          await recoverActiveRequests();
          // Bring the knowledge/docs corpora up to date. Fire-and-forget on purpose: caches load and
          // the online refresh runs in the background, so a slow or offline network never delays a
          // usable assistant — the bundled seed already covers every corpus.
          void initKnowledgeSync();
        } finally {
          initializing = false;
          initializePromise = null;
        }
      })();
      return initializePromise;
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

    async updateAutoScrollToBottom(enabled: boolean) {
      settings = normalizeSettings({
        ...settings,
        autoScrollToBottom: enabled,
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
        if (workspaceStore.activeId) {
          rememberSelectedConversation(workspaceStore.activeId, conversationId);
        }
      }
    },

    clearConversationSelection() {
      selectedConversationId = null;
      if (workspaceStore.activeId) rememberSelectedConversation(workspaceStore.activeId, null);
    },

    async newConversation() {
      await quentaStore.init();
      const conversation = createConversation({ title: DEFAULT_CONVERSATION_TITLE });
      await commitConversationMutation({ kind: 'create', conversation });
    },

    async deleteConversation(conversationId: string) {
      await stopMessage(conversationId);
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      if (selectedConversationId === conversationId) {
        selectedConversationId = null;
        if (workspaceStore.activeId) rememberSelectedConversation(workspaceStore.activeId, null);
      }
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
      const workspaceId = workspaceStore.activeId;
      if (!workspaceId) throw new Error('Open a workspace before using Quenta');
      const existing = conversations.find((conversation) => (
        conversation.focus?.kind === focus.kind
        && conversation.focus.entityId === focus.entityId
        && (
          conversation.draftIntent === intent
          || conversation.messages.some((message) => message.intent === intent)
          || conversation.title === titleForIntent(intent, focus)
        )
      ));
      if (existing) {
        quentaStore.selectConversation(existing.id);
        if (autoSend && existing.messages.length === 0 && !quentaStore.isSending(existing.id)) {
          await sendMessage(prompt, intent, {
            conversationId: existing.id,
            focus,
          });
        }
        return existing;
      }
      const conversation = createConversation({
        id: stableFocusedConversationId(workspaceId, intent, focus),
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