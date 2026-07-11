import type {
  LiatirQuentaConversation,
  LiatirQuentaFocus,
  LiatirQuentaIntent,
  LiatirQuentaMessage,
} from '@liatir/core';

export type QuentaConversationMutation =
  | { kind: 'create'; conversation: LiatirQuentaConversation }
  | { kind: 'merge'; conversations: LiatirQuentaConversation[] }
  | { kind: 'replace'; conversations: LiatirQuentaConversation[] }
  | { kind: 'delete'; conversationId: string }
  | { kind: 'rename'; conversationId: string; title: string; updatedAt: number }
  | { kind: 'tags'; conversationId: string; tags: string[]; updatedAt: number }
  | {
    kind: 'draft';
    conversationId: string;
    draft: string;
    draftIntent: LiatirQuentaIntent;
    updatedAt: number;
  }
  | {
    kind: 'append-message';
    conversationId: string;
    message: LiatirQuentaMessage;
    focus?: LiatirQuentaFocus;
    clearDraft?: boolean;
  };

function orderedConversations(
  conversations: LiatirQuentaConversation[],
  maxConversations: number,
): LiatirQuentaConversation[] {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxConversations);
}

export function applyConversationMutation(
  conversations: LiatirQuentaConversation[],
  mutation: QuentaConversationMutation,
  options: { maxConversations?: number; maxMessages?: number } = {},
): LiatirQuentaConversation[] {
  const maxConversations = options.maxConversations ?? 40;
  const maxMessages = options.maxMessages ?? 120;

  if (mutation.kind === 'create') {
    if (conversations.some((conversation) => conversation.id === mutation.conversation.id)) {
      return orderedConversations(conversations, maxConversations);
    }
    return orderedConversations([mutation.conversation, ...conversations], maxConversations);
  }
  if (mutation.kind === 'merge') {
    const existingIds = new Set(conversations.map((conversation) => conversation.id));
    return orderedConversations([
      ...conversations,
      ...mutation.conversations.filter((conversation) => !existingIds.has(conversation.id)),
    ], maxConversations);
  }
  if (mutation.kind === 'replace') {
    return orderedConversations(mutation.conversations, maxConversations);
  }
  if (mutation.kind === 'delete') {
    return orderedConversations(
      conversations.filter((conversation) => conversation.id !== mutation.conversationId),
      maxConversations,
    );
  }

  return orderedConversations(conversations.map((conversation) => {
    if (conversation.id !== mutation.conversationId) return conversation;
    if (mutation.kind === 'rename') {
      return { ...conversation, title: mutation.title, updatedAt: mutation.updatedAt };
    }
    if (mutation.kind === 'tags') {
      return { ...conversation, tags: mutation.tags, updatedAt: mutation.updatedAt };
    }
    if (mutation.kind === 'draft') {
      return {
        ...conversation,
        draft: mutation.draft,
        draftIntent: mutation.draftIntent,
        updatedAt: mutation.updatedAt,
      };
    }
    if (conversation.messages.some((message) => message.id === mutation.message.id)) {
      return conversation;
    }
    return {
      ...conversation,
      focus: mutation.focus ?? conversation.focus,
      draft: mutation.clearDraft ? undefined : conversation.draft,
      draftIntent: mutation.clearDraft ? undefined : conversation.draftIntent,
      updatedAt: mutation.message.createdAt,
      messages: [...conversation.messages, mutation.message].slice(-maxMessages),
    };
  }), maxConversations);
}

export function createSerializedWriteQueue() {
  let tail: Promise<void> = Promise.resolve();

  return (write: () => Promise<void>): Promise<void> => {
    const task = tail.catch(() => undefined).then(write);
    tail = task;
    return task;
  };
}
