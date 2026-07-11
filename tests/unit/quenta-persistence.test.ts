import { describe, expect, it } from 'vitest';
import {
  applyConversationMutation,
  createSerializedWriteQueue,
} from '../../frontend/src/lib/quenta/persistence';
import type { LiatirQuentaConversation } from '@liatir/core';

const conversation: LiatirQuentaConversation = {
  id: 'conversation-1',
  workspaceId: 'workspace-1',
  title: 'Original title',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  messages: [],
};

describe('Quenta conversation persistence', () => {
  it('finishes writes in mutation order so stale create state cannot overwrite rename or delete', async () => {
    const enqueue = createSerializedWriteQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

    const createWrite = enqueue(async () => {
      events.push('create:start');
      markFirstStarted();
      await firstBlocked;
      events.push('create:end');
    });
    const deleteWrite = enqueue(async () => {
      events.push('delete');
    });

    await firstStarted;
    expect(events).toEqual(['create:start']);
    releaseFirst();
    await Promise.all([createWrite, deleteWrite]);
    expect(events).toEqual(['create:start', 'create:end', 'delete']);
  });

  it('continues after a failed write', async () => {
    const enqueue = createSerializedWriteQueue();
    const failed = enqueue(async () => { throw new Error('write failed'); });
    const recovered = enqueue(async () => undefined);

    await expect(failed).rejects.toThrow('write failed');
    await expect(recovered).resolves.toBeUndefined();
  });

  it('rebases independent field and message mutations without losing either change', () => {
    const renamed = applyConversationMutation([conversation], {
      kind: 'rename',
      conversationId: conversation.id,
      title: 'Reviewed result',
      updatedAt: 2,
    });
    const merged = applyConversationMutation(renamed, {
      kind: 'append-message',
      conversationId: conversation.id,
      message: {
        id: 'message-1',
        role: 'assistant',
        intent: 'chat',
        content: 'Observed evidence.',
        createdAt: 3,
      },
    });

    expect(merged[0].title).toBe('Reviewed result');
    expect(merged[0].messages.map((message) => message.id)).toEqual(['message-1']);
  });

  it('does not resurrect a deleted conversation when a stale response arrives', () => {
    const deleted = applyConversationMutation([conversation], {
      kind: 'delete',
      conversationId: conversation.id,
    });
    const afterStaleResponse = applyConversationMutation(deleted, {
      kind: 'append-message',
      conversationId: conversation.id,
      message: {
        id: 'message-after-delete',
        role: 'assistant',
        intent: 'chat',
        content: 'Late response.',
        createdAt: 4,
      },
    });

    expect(afterStaleResponse).toEqual([]);
  });

  it('keeps the prepared prompt and mode as conversation state', () => {
    const updated = applyConversationMutation([conversation], {
      kind: 'draft',
      conversationId: conversation.id,
      draft: 'Generate a structured report.',
      draftIntent: 'report',
      updatedAt: 2,
    });

    expect(updated[0]).toMatchObject({
      draft: 'Generate a structured report.',
      draftIntent: 'report',
    });
  });

  it('replaces an obsolete snapshot when exact duplicate cleanup runs', () => {
    const replacement = { ...conversation, id: 'conversation-kept', updatedAt: 3 };
    const updated = applyConversationMutation([
      conversation,
      { ...conversation, id: 'conversation-duplicate', updatedAt: 2 },
    ], {
      kind: 'replace',
      conversations: [replacement],
    });

    expect(updated.map((item) => item.id)).toEqual(['conversation-kept']);
  });
});
