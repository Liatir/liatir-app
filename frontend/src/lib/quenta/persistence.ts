/**
 * Conversation state for Quenta, modelled as pure mutations plus a serialised write queue.
 *
 * Everything that changes a conversation goes through `applyConversationMutation`, which is a pure
 * function: old list in, new list out. That keeps the reducer trivially testable, and — more
 * importantly — it means every path that mutates state also enforces the same size caps, so no
 * caller can accidentally let a conversation grow without bound.
 */
import type {
  LiatirQuentaConversation,
  LiatirQuentaFocus,
  LiatirQuentaIntent,
  LiatirQuentaMessage,
} from '@liatir/core';

/** Every way a conversation list can change. A closed union, so a new case cannot be forgotten. */
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

/**
 * Newest first, then truncated. Applied after *every* mutation, which is what makes the ordering and
 * the cap invariants of the list rather than something each call site has to remember.
 *
 * Note the consequence of sorting before slicing: the conversations that get dropped are always the
 * least recently touched ones, never the ones the user is actually working in.
 */
function orderedConversations(
  conversations: LiatirQuentaConversation[],
  maxConversations: number,
): LiatirQuentaConversation[] {
  return [...conversations]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxConversations);
}

/**
 * The single reducer for conversation state. Pure: it never mutates its input.
 *
 * The caps exist because this is persisted to disk on every change — an unbounded history would
 * mean an ever-growing file being rewritten on every keystroke of a draft.
 */
export function applyConversationMutation(
  conversations: LiatirQuentaConversation[],
  mutation: QuentaConversationMutation,
  options: { maxConversations?: number; maxMessages?: number } = {},
): LiatirQuentaConversation[] {
  const maxConversations = options.maxConversations ?? 40;
  const maxMessages = options.maxMessages ?? 120;

  if (mutation.kind === 'create') {
    // Idempotent: creating a conversation that already exists is a no-op rather than a duplicate.
    if (conversations.some((conversation) => conversation.id === mutation.conversation.id)) {
      return orderedConversations(conversations, maxConversations);
    }
    return orderedConversations([mutation.conversation, ...conversations], maxConversations);
  }
  if (mutation.kind === 'merge') {
    // Merge adds only what is *not* already present — existing conversations win, because the
    // in-memory copy may hold edits the incoming (e.g. freshly loaded from disk) copy does not.
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

  // The remaining mutations all target one conversation, so they share this single map. Every other
  // conversation is returned by reference, unchanged.
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
    // append-message. Idempotent by message ID: a streamed reply can be flushed more than once, and
    // re-appending the same message must not duplicate it in the transcript.
    if (conversation.messages.some((message) => message.id === mutation.message.id)) {
      return conversation;
    }
    return {
      ...conversation,
      focus: mutation.focus ?? conversation.focus,
      draft: mutation.clearDraft ? undefined : conversation.draft,
      draftIntent: mutation.clearDraft ? undefined : conversation.draftIntent,
      updatedAt: mutation.message.createdAt,
      // Tail-truncated: the oldest messages fall off, keeping the recent context the user is
      // actually looking at.
      messages: [...conversation.messages, mutation.message].slice(-maxMessages),
    };
  }), maxConversations);
}

/**
 * Serialises async writes into a chain, so two saves can never interleave.
 *
 * Conversations are persisted to a single file. Without this, a fast sequence of changes (typing a
 * draft, a streamed reply arriving) could have two writes in flight at once and the *older* one
 * could land last, silently reverting the newer state.
 *
 * `tail.catch(() => undefined)` is the load-bearing detail: it means a failed write does not poison
 * the chain. Without it, one rejection would make every subsequent write reject too, and the app
 * would stop persisting anything for the rest of the session.
 */
export function createSerializedWriteQueue() {
  let tail: Promise<void> = Promise.resolve();

  return (write: () => Promise<void>): Promise<void> => {
    const task = tail.catch(() => undefined).then(write);
    tail = task;
    return task;
  };
}
