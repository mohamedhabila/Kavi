import {
  areMemoryIngestionSnapshotRelevantFieldsEqual,
  getMemoryPublicationMutationLockedMessageIds,
  getOpenMemoryPublicationTurnMessageIds,
  selectMessagesForPersistenceWithOpenMemoryPublicationTurns,
} from '../../src/store/chatMessageMemoryPublicationGuards';
import type { Message } from '../../src/types/message';

function message(id: string, role: Message['role'], overrides: Partial<Message> = {}): Message {
  return {
    id,
    role,
    content: id,
    timestamp: Number(id.replace(/\D/g, '')) || 1,
    ...overrides,
  };
}

function final(
  id: string,
  disposition: NonNullable<Message['memoryPublication']>['disposition'] | undefined,
): Message {
  return message(id, 'assistant', {
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
    ...(disposition !== undefined ? { memoryPublication: { version: 1, disposition } } : {}),
  });
}

describe('chat message memory publication guards', () => {
  test('identifies every exact open and mutation-locked source window', () => {
    const messages = [
      message('system-1', 'system'),
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      message('tool-1', 'tool'),
      final('final-1', null),
      message('user-2', 'user'),
      final('final-2', 'enqueued'),
      message('user-3', 'user'),
      final('final-3', 'opt_out'),
    ];

    expect([...getOpenMemoryPublicationTurnMessageIds(messages)]).toEqual([
      'user-1',
      'assistant-1',
      'tool-1',
      'final-1',
    ]);
    expect([...getMemoryPublicationMutationLockedMessageIds(messages)]).toEqual([
      'user-1',
      'assistant-1',
      'tool-1',
      'final-1',
      'user-2',
      'final-2',
    ]);
  });

  test('protects the complete prefix when a source has no preceding user', () => {
    const messages = [
      message('system-1', 'system'),
      message('assistant-1', 'assistant'),
      final('final-1', null),
    ];

    expect([...getOpenMemoryPublicationTurnMessageIds(messages)]).toEqual([
      'system-1',
      'assistant-1',
      'final-1',
    ]);
  });

  test('fails closed for invalid, duplicate, or structurally incomplete sources', () => {
    expect(() =>
      getOpenMemoryPublicationTurnMessageIds([message('same-id', 'user'), final('same-id', null)]),
    ).toThrow('chat_message_memory_publication_identity_invalid');
    expect(() =>
      getOpenMemoryPublicationTurnMessageIds([
        message('invalid id', 'user'),
        final('final-1', null),
      ]),
    ).toThrow('chat_message_memory_publication_identity_invalid');
    expect(() =>
      getOpenMemoryPublicationTurnMessageIds([
        message('user-1', 'user'),
        final('final-1', null),
        message('assistant-later', 'assistant'),
      ]),
    ).toThrow('chat_message_memory_publication_turn_not_terminal');
  });

  test('treats later sub-agent events as observations rather than assistant projections', () => {
    const messages = [
      message('user-1', 'user'),
      final('final-1', null),
      message('worker-event-1', 'assistant', {
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'worker-1',
            parentConversationId: 'conversation-1',
            depth: 1,
            startedAt: 1,
            updatedAt: 2,
            status: 'completed',
            sandboxPolicy: 'inherit',
          },
        },
      }),
    ];

    expect([...getOpenMemoryPublicationTurnMessageIds(messages)]).toEqual(['user-1', 'final-1']);
    expect([...getMemoryPublicationMutationLockedMessageIds(messages)]).toEqual([
      'user-1',
      'final-1',
    ]);
  });

  test('still rejects a later owning assistant projection after sub-agent observations', () => {
    expect(() =>
      getOpenMemoryPublicationTurnMessageIds([
        message('user-1', 'user'),
        final('final-1', null),
        message('worker-event-1', 'assistant', {
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'worker-1',
              parentConversationId: 'conversation-1',
              depth: 1,
              startedAt: 1,
              updatedAt: 2,
              status: 'completed',
              sandboxPolicy: 'inherit',
            },
          },
        }),
        message('assistant-later', 'assistant'),
      ]),
    ).toThrow('chat_message_memory_publication_turn_not_terminal');
  });

  test('does not impose publication identity rules on receipt-free historical messages', () => {
    const historical = [message('legacy duplicate', 'user'), final('legacy duplicate', undefined)];

    expect([...getOpenMemoryPublicationTurnMessageIds(historical)]).toEqual([]);
    expect([...getMemoryPublicationMutationLockedMessageIds(historical)]).toEqual([]);
    expect(
      selectMessagesForPersistenceWithOpenMemoryPublicationTurns(historical, 2).map(
        (entry) => entry.id,
      ),
    ).toEqual(['legacy duplicate', 'legacy duplicate']);
  });

  test('compares only immutable-ingestion-snapshot-relevant message fields', () => {
    const left = message('assistant-1', 'assistant', {
      content: 'Done',
      enrichedContent: 'Enriched',
      attachments: [{ id: 'attachment-1', name: 'one.txt', type: 'text/plain' } as any],
      toolCallId: 'call-1',
      isError: true,
      reasoning: 'left reasoning',
      providerReplay: { openaiResponseId: 'left-response' },
      effectId: 'confetti',
      memoryPublication: { version: 1, disposition: null },
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
        terminalReason: 'left-only',
        memoryRetrievalEventId: 'memory-retrieval:left',
      },
      toolCalls: [
        {
          id: 'call-1',
          name: 'write_file',
          arguments: '{"path":"a"}',
          status: 'completed',
          result: 'ok',
          raw: { provider: 'left' },
          startedAt: 1,
          updatedAt: 2,
          completedAt: 3,
          progressText: 'left progress',
          effectReceipts: [{ id: 'receipt-left' } as any],
        },
      ],
    });
    const right: Message = {
      ...left,
      attachments: [{ id: 'attachment-2', name: 'two.txt', type: 'text/plain' } as any],
      reasoning: 'right reasoning',
      providerReplay: { openaiResponseId: 'right-response' },
      effectId: 'spotlight',
      memoryPublication: { version: 1, disposition: 'enqueued' },
      assistantMetadata: {
        ...left.assistantMetadata!,
        terminalReason: 'right-only',
        memoryRetrievalEventId: 'memory-retrieval:right',
      },
      toolCalls: [
        {
          ...left.toolCalls![0]!,
          raw: { provider: 'right' },
          startedAt: 10,
          updatedAt: 20,
          completedAt: 30,
          progressText: 'right progress',
          effectReceipts: [{ id: 'receipt-right' } as any],
        },
      ],
    };

    expect(areMemoryIngestionSnapshotRelevantFieldsEqual(left, right)).toBe(true);
    expect(
      areMemoryIngestionSnapshotRelevantFieldsEqual(left, {
        ...right,
        toolCalls: [{ ...right.toolCalls![0]!, result: 'changed' }],
      }),
    ).toBe(false);
    expect(areMemoryIngestionSnapshotRelevantFieldsEqual(left, { ...right, attachments: [] })).toBe(
      false,
    );
    expect(
      areMemoryIngestionSnapshotRelevantFieldsEqual(left, {
        ...right,
        assistantMetadata: { ...right.assistantMetadata!, finishReason: 'length' },
      }),
    ).toBe(false);
  });

  test('caps messages around the first item, complete open turns, and newest tail', () => {
    const messages = [
      message('system-1', 'system'),
      message('user-old', 'user'),
      final('final-old', undefined),
      message('user-open', 'user'),
      message('assistant-open', 'assistant'),
      message('tool-open', 'tool'),
      final('final-open', null),
      message('user-tail-1', 'user'),
      final('final-tail-1', undefined),
      message('user-tail-2', 'user'),
      final('final-tail-2', undefined),
    ];

    expect(
      selectMessagesForPersistenceWithOpenMemoryPublicationTurns(messages, 7).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      'system-1',
      'user-open',
      'assistant-open',
      'tool-open',
      'final-open',
      'user-tail-2',
      'final-tail-2',
    ]);
    expect(() => selectMessagesForPersistenceWithOpenMemoryPublicationTurns(messages, 4)).toThrow(
      'chat_message_persistence_protected_messages_exceed_limit',
    );
  });
});
