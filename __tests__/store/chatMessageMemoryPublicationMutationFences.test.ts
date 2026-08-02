import { useChatStore } from '../helpers/chatStoreHarness';
import {
  claimModelProjection,
  mutateOwnedModelProjection,
} from '../../src/store/modelProjectionOwnership';
import type { Conversation, ModelProjectionOwner } from '../../src/types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../../src/types/message';

const SOURCE_LOCKED_ERROR = 'chat_message_memory_publication_source_locked';

function conversation(conversationId: string): Conversation {
  return useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId)!;
}

function addLockedTurn(
  disposition: Extract<MessageMemoryPublicationDisposition, null | 'enqueued'>,
) {
  const conversationId = useChatStore.getState().createConversation('provider', 'system');
  const store = useChatStore.getState();
  store.addMessage(conversationId, {
    id: 'user-1',
    role: 'user',
    content: 'Remember the exact source.',
    timestamp: 1,
  });
  store.addMessage(conversationId, {
    id: 'assistant-tool',
    role: 'assistant',
    content: '',
    timestamp: 2,
    assistantMetadata: {
      kind: 'intermediate',
      completionStatus: 'complete',
      finishReason: 'tool_calls',
    },
    toolCalls: [
      {
        id: 'call-1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'running',
      },
    ],
  });
  store.addMessage(conversationId, {
    id: 'tool-1',
    role: 'tool',
    toolCallId: 'call-1',
    content: 'original tool result',
    timestamp: 3,
  });
  store.addMessage(conversationId, {
    id: 'final-1',
    role: 'assistant',
    content: 'The task is complete.',
    timestamp: 4,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  });
  expect(store.transitionMessageMemoryPublication(conversationId, 'final-1', null).status).toBe(
    'applied',
  );
  if (disposition === 'enqueued') {
    expect(
      store.transitionMessageMemoryPublication(conversationId, 'final-1', 'enqueued').status,
    ).toBe('applied');
  }
  return conversationId;
}

function addNewerTail(conversationId: string): void {
  const store = useChatStore.getState();
  store.addMessage(conversationId, {
    id: 'user-2',
    role: 'user',
    content: 'Keep this newer request.',
    timestamp: 5,
  });
  store.addMessage(conversationId, {
    id: 'final-2',
    role: 'assistant',
    content: 'Keep this newer response.',
    timestamp: 6,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
  });
}

describe('chat memory publication mutation fences', () => {
  it.each([null, 'enqueued'] as const)(
    'blocks ingestion-relevant mutations while disposition is %s',
    (disposition) => {
      const conversationId = addLockedTurn(disposition);
      const store = useChatStore.getState();

      expect(() => store.updateMessage(conversationId, 'user-1', 'changed')).toThrow(
        SOURCE_LOCKED_ERROR,
      );
      expect(() => store.updateMessageEnrichedContent(conversationId, 'user-1', 'changed')).toThrow(
        SOURCE_LOCKED_ERROR,
      );
      expect(() =>
        store.updateMessageAssistantMetadata(conversationId, 'final-1', {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'refusal',
        }),
      ).toThrow(SOURCE_LOCKED_ERROR);
      expect(() =>
        store.addToolCall(conversationId, 'assistant-tool', {
          id: 'call-1',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
          status: 'running',
          result: 'changed',
        }),
      ).toThrow(SOURCE_LOCKED_ERROR);
      expect(() =>
        store.updateToolCallStatus(conversationId, 'assistant-tool', 'call-1', 'completed', {
          result: 'changed',
        }),
      ).toThrow(SOURCE_LOCKED_ERROR);

      expect(conversation(conversationId).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'user-1', content: 'Remember the exact source.' }),
          expect.objectContaining({
            id: 'assistant-tool',
            toolCalls: [expect.objectContaining({ status: 'running' })],
          }),
          expect.objectContaining({
            id: 'final-1',
            content: 'The task is complete.',
            memoryPublication: { version: 1, disposition },
          }),
        ]),
      );
    },
  );

  it.each([null, 'enqueued'] as const)(
    'blocks a new assistant turn after a %s publication until a new user turn starts',
    (disposition) => {
      const conversationId = addLockedTurn(disposition);
      const store = useChatStore.getState();

      expect(() =>
        store.addMessage(conversationId, {
          id: 'orphan-assistant',
          role: 'assistant',
          content: '',
          timestamp: 5,
        }),
      ).toThrow('chat_message_memory_publication_turn_not_terminal');

      expect(() =>
        store.addMessage(conversationId, {
          id: 'user-2',
          role: 'user',
          content: 'Start the next turn.',
          timestamp: 6,
        }),
      ).not.toThrow();
      expect(() =>
        store.addMessage(conversationId, {
          id: 'assistant-2',
          role: 'assistant',
          content: 'The next turn is independent.',
          timestamp: 7,
        }),
      ).not.toThrow();
    },
  );

  it('allows no-ops and fields excluded from immutable ingestion snapshots', () => {
    const conversationId = addLockedTurn(null);
    const store = useChatStore.getState();

    expect(() =>
      store.updateMessage(conversationId, 'user-1', 'Remember the exact source.'),
    ).not.toThrow();
    expect(() =>
      store.updateMessageReasoning(conversationId, 'final-1', 'private reasoning'),
    ).not.toThrow();
    expect(() =>
      store.updateMessageProviderReplay(conversationId, 'final-1', {
        openaiResponseId: 'response-1',
      }),
    ).not.toThrow();
    expect(() => store.updateMessageEffect(conversationId, 'final-1', 'confetti')).not.toThrow();
    expect(() =>
      store.updateMessageAssistantMetadata(conversationId, 'final-1', {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        terminalReason: 'graph_completed',
      }),
    ).not.toThrow();
    expect(() =>
      store.addToolCall(conversationId, 'assistant-tool', {
        id: 'call-1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'running',
        progressText: 'Still reading',
      }),
    ).not.toThrow();
    expect(() =>
      store.updateToolCallStatus(conversationId, 'assistant-tool', 'call-1', 'running', {
        progressText: 'Almost done',
      }),
    ).not.toThrow();

    expect(
      conversation(conversationId).messages.find((message) => message.id === 'final-1'),
    ).toEqual(
      expect.objectContaining({
        reasoning: 'private reasoning',
        providerReplay: { openaiResponseId: 'response-1' },
        effectId: 'confetti',
        assistantMetadata: expect.objectContaining({ terminalReason: 'graph_completed' }),
        memoryPublication: { version: 1, disposition: null },
      }),
    );
  });

  it('preserves code-owned receipts across safe compaction and rejects source rewrites', () => {
    const conversationId = addLockedTurn(null);
    const current = conversation(conversationId).messages;
    const forged = current.map((message) =>
      message.id === 'final-1'
        ? {
            ...message,
            memoryPublication: { version: 1 as const, disposition: 'opt_out' as const },
          }
        : { ...message },
    );

    expect(() =>
      useChatStore.getState().applyConversationCompaction(conversationId, forged),
    ).not.toThrow();
    expect(
      conversation(conversationId).messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });

    const changed = conversation(conversationId).messages.map((message) =>
      message.id === 'user-1' ? { ...message, content: 'rewritten source' } : message,
    );
    expect(() =>
      useChatStore.getState().applyConversationCompaction(conversationId, changed),
    ).toThrow(SOURCE_LOCKED_ERROR);
    expect(() =>
      useChatStore.getState().applyConversationCompaction(
        conversationId,
        conversation(conversationId).messages.filter((message) => message.id !== 'tool-1'),
      ),
    ).toThrow(SOURCE_LOCKED_ERROR);
  });

  it('compacts away an old enqueued turn and normalizes a retained partial source', () => {
    const compactedConversationId = addLockedTurn('enqueued');
    addNewerTail(compactedConversationId);
    const newerTail = conversation(compactedConversationId).messages.filter(
      (message) => message.id === 'user-2' || message.id === 'final-2',
    );

    expect(() =>
      useChatStore.getState().applyConversationCompaction(compactedConversationId, [
        {
          id: 'summary',
          role: 'system',
          content: 'The older durable turn was summarized.',
          timestamp: 7,
          compactionProvenance: { version: 1, dependency: 'transcript_only' },
        },
        ...newerTail,
      ]),
    ).not.toThrow();
    expect(conversation(compactedConversationId).messages.map((message) => message.id)).toEqual([
      'summary',
      'user-2',
      'final-2',
    ]);

    const partialConversationId = addLockedTurn('enqueued');
    addNewerTail(partialConversationId);
    const partialSource = conversation(partialConversationId).messages.filter((message) =>
      ['user-1', 'final-1', 'user-2', 'final-2'].includes(message.id),
    );
    expect(() =>
      useChatStore.getState().applyConversationCompaction(partialConversationId, partialSource),
    ).not.toThrow();
    expect(conversation(partialConversationId).messages.map((message) => message.id)).toEqual([
      'user-2',
      'final-2',
    ]);
  });

  it('still rejects a partial source whose publication has not been enqueued', () => {
    const conversationId = addLockedTurn(null);
    addNewerTail(conversationId);
    const partialSource = conversation(conversationId).messages.filter((message) =>
      ['user-1', 'final-1', 'user-2', 'final-2'].includes(message.id),
    );

    expect(() =>
      useChatStore.getState().applyConversationCompaction(conversationId, partialSource),
    ).toThrow(SOURCE_LOCKED_ERROR);
  });

  it('rejects unmarked new message identities from model-only compaction context', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    useChatStore.getState().applyConversationCompaction(conversationId, [
      {
        id: 'new-final',
        role: 'assistant',
        content: 'Compacted response',
        timestamp: 1,
        assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
        memoryPublication: { version: 1, disposition: 'enqueued' },
      },
    ]);

    expect(conversation(conversationId).messages).toEqual([]);
  });

  it('does not lock turns whose publication is already terminal', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    const store = useChatStore.getState();
    store.addMessage(conversationId, {
      id: 'terminal-final',
      role: 'assistant',
      content: 'Nothing should be retained.',
      timestamp: 1,
      assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    });
    expect(
      store.transitionMessageMemoryPublication(conversationId, 'terminal-final', 'opt_out').status,
    ).toBe('applied');

    expect(() =>
      store.applyConversationCompaction(conversationId, [
        {
          id: 'summary',
          role: 'system',
          content: 'Replacement summary',
          timestamp: 2,
          compactionProvenance: { version: 1, dependency: 'transcript_only' },
        },
      ]),
    ).not.toThrow();
    expect(conversation(conversationId).messages.map((message) => message.id)).toEqual(['summary']);
  });

  it('blocks edit or retry truncation that touches a locked source window', () => {
    const conversationId = addLockedTurn('enqueued');
    const store = useChatStore.getState();

    expect(() => store.rewindUserMessageForResend(conversationId, 'user-1', 'edited')).toThrow(
      SOURCE_LOCKED_ERROR,
    );
    expect(conversation(conversationId).messages).toHaveLength(4);

    store.addMessage(conversationId, {
      id: 'user-2',
      role: 'user',
      content: 'A later request',
      timestamp: 5,
    });
    store.addMessage(conversationId, {
      id: 'assistant-2',
      role: 'assistant',
      content: 'A later response',
      timestamp: 6,
    });
    expect(() =>
      store.rewindUserMessageForResend(conversationId, 'user-2', 'Edited later request'),
    ).not.toThrow();
    expect(
      conversation(conversationId)
        .messages.slice(0, 4)
        .map((message) => message.id),
    ).toEqual(['user-1', 'assistant-tool', 'tool-1', 'final-1']);
    expect(conversation(conversationId).messages[4]).toEqual(
      expect.objectContaining({ role: 'user', content: 'Edited later request' }),
    );
    expect(conversation(conversationId).messages[4]?.id).not.toBe('user-2');
  });

  it('fences direct owned-projection rewrites and preserves receipts on safe mutations', () => {
    const conversationId = useChatStore.getState().createConversation('provider', 'system');
    useChatStore.getState().addMessage(conversationId, {
      id: 'request-1',
      role: 'user',
      content: 'Original request',
      timestamp: 1,
    });
    const owner: ModelProjectionOwner = {
      surface: 'foreground',
      runId: 'run-1',
      requestMessageId: 'request-1',
      assistantMessageId: 'assistant-1',
      controlEpoch: 0,
    };
    expect(
      claimModelProjection({
        conversationId,
        owner,
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Final response',
          timestamp: 2,
          assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
        },
      }),
    ).toBe('claimed');
    expect(
      useChatStore
        .getState()
        .transitionMessageMemoryPublication(conversationId, 'assistant-1', null).status,
    ).toBe('applied');

    expect(() =>
      mutateOwnedModelProjection({
        conversationId,
        owner,
        mutate: (current) => ({
          kind: 'applied',
          value: 'changed',
          conversation: {
            ...current,
            messages: current.messages.map((message) =>
              message.id === 'request-1' ? { ...message, content: 'Changed request' } : message,
            ),
          },
        }),
      }),
    ).toThrow(SOURCE_LOCKED_ERROR);
    expect(() =>
      mutateOwnedModelProjection({
        conversationId,
        owner,
        mutate: (current) => ({
          kind: 'applied',
          value: 'dropped',
          conversation: {
            ...current,
            messages: current.messages.filter((message) => message.id !== 'request-1'),
          },
        }),
      }),
    ).toThrow(SOURCE_LOCKED_ERROR);

    expect(
      mutateOwnedModelProjection({
        conversationId,
        owner,
        mutate: (current) => ({
          kind: 'applied',
          value: 'safe',
          conversation: {
            ...current,
            messages: current.messages.map((message): Message => {
              if (message.id !== 'assistant-1') return message;
              const { memoryPublication: _receipt, ...withoutReceipt } = message;
              return { ...withoutReceipt, reasoning: 'safe reasoning' };
            }),
          },
        }),
      }),
    ).toEqual({ kind: 'applied', value: 'safe' });
    expect(
      conversation(conversationId).messages.find((message) => message.id === 'assistant-1'),
    ).toEqual(
      expect.objectContaining({
        reasoning: 'safe reasoning',
        memoryPublication: { version: 1, disposition: null },
      }),
    );
  });
});
