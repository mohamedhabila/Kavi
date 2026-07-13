import {
  resolveClosedTurnEndingAt,
  type ExactClosedTurnFailureReason,
} from '../../../src/services/memory/closedTurn';
import type { Message } from '../../../src/types/message';

function finalAssistant(id: string, timestamp: number): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp,
    assistantMetadata: {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    },
  };
}

function expectInvalid(messages: Message[], id: string, reason: ExactClosedTurnFailureReason) {
  expect(resolveClosedTurnEndingAt(messages, id)).toEqual({ status: 'invalid', reason });
}

describe('resolveClosedTurnEndingAt', () => {
  it('resolves the exact terminal assistant with its source and prior user identities', () => {
    const messages: Message[] = [
      { id: 'prior-user', role: 'user', content: 'Old detail.', timestamp: 1 },
      finalAssistant('prior-assistant', 2),
      { id: 'current-user', role: 'user', content: 'New detail.', timestamp: 3 },
      {
        id: 'tool-assistant',
        role: 'assistant',
        content: '',
        timestamp: 4,
        assistantMetadata: { kind: 'intermediate', completionStatus: 'complete' },
      },
      { id: 'tool-result', role: 'tool', content: 'ok', timestamp: 5 },
      finalAssistant('current-assistant', 6),
    ];

    expect(resolveClosedTurnEndingAt(messages, 'current-assistant')).toMatchObject({
      status: 'resolved',
      assistant: { id: 'current-assistant' },
      user: { id: 'current-user' },
      sourceStartMessageId: 'current-user',
      sourceEndMessageId: 'current-assistant',
      priorUserMessageId: 'prior-user',
    });
  });

  it('allows an explicitly final assistant-only turn without inventing a source user', () => {
    expect(
      resolveClosedTurnEndingAt([finalAssistant('assistant-only', 1)], 'assistant-only'),
    ).toEqual(
      expect.objectContaining({
        status: 'resolved',
        sourceStartMessageId: null,
        priorUserMessageId: null,
        user: undefined,
      }),
    );
  });

  it('rejects missing, duplicate, and non-assistant source identities', () => {
    const user: Message = { id: 'same-id', role: 'user', content: 'Hello', timestamp: 1 };
    const assistant = finalAssistant('same-id', 2);
    expectInvalid([user], 'missing', 'source_end_unavailable');
    expectInvalid([user], 'same-id', 'source_end_unavailable');
    expectInvalid([user, assistant], 'same-id', 'source_end_unavailable');
  });

  it.each([
    [undefined, 'source_end_not_closed'],
    [{ kind: 'intermediate', completionStatus: 'complete' }, 'source_end_not_closed'],
    [{ kind: 'final', completionStatus: 'incomplete' }, 'source_end_not_closed'],
    [
      { kind: 'final', completionStatus: 'complete', finishReason: 'yielded' },
      'source_end_not_closed',
    ],
  ] as const)('rejects a non-final boundary %#', (assistantMetadata, reason) => {
    const assistant: Message = {
      id: 'candidate',
      role: 'assistant',
      content: 'Not closed.',
      timestamp: 1,
      ...(assistantMetadata ? { assistantMetadata } : {}),
    };
    expectInvalid([assistant], assistant.id, reason);
  });

  it('never falls back to a previous final when the requested current turn is incomplete', () => {
    const messages: Message[] = [
      { id: 'prior-user', role: 'user', content: 'Prior.', timestamp: 1 },
      finalAssistant('prior-final', 2),
      { id: 'current-user', role: 'user', content: 'Current.', timestamp: 3 },
      {
        id: 'current-incomplete',
        role: 'assistant',
        content: 'Partial.',
        timestamp: 4,
        assistantMetadata: { kind: 'final', completionStatus: 'incomplete' },
      },
    ];
    expectInvalid(messages, 'current-incomplete', 'source_end_not_closed');
  });

  it('rejects an assistant or tool after the claimed final before the next user boundary', () => {
    const base: Message[] = [
      { id: 'user', role: 'user', content: 'Do it.', timestamp: 1 },
      finalAssistant('claimed-final', 2),
    ];
    expectInvalid(
      [...base, finalAssistant('later-assistant', 3)],
      'claimed-final',
      'source_end_not_terminal',
    );
    expectInvalid(
      [...base, { id: 'late-tool', role: 'tool', content: 'late', timestamp: 3 }],
      'claimed-final',
      'source_end_not_terminal',
    );
    expect(
      resolveClosedTurnEndingAt(
        [...base, { id: 'next-user', role: 'user', content: 'Next', timestamp: 3 }],
        'claimed-final',
      ).status,
    ).toBe('resolved');
  });

  it('allows later sub-agent observations without treating them as owning projections', () => {
    const messages: Message[] = [
      { id: 'user', role: 'user', content: 'Do it.', timestamp: 1 },
      finalAssistant('claimed-final', 2),
      {
        id: 'worker-observation',
        role: 'assistant',
        content: 'Verifier completed.',
        timestamp: 3,
        subAgentEvent: {
          type: 'sub-agent',
          event: 'completed',
          snapshot: {
            sessionId: 'worker-1',
            parentConversationId: 'conversation-1',
            status: 'completed',
            startedAt: 2,
            updatedAt: 3,
            depth: 1,
            sandboxPolicy: 'inherit',
          },
        },
      },
    ];

    expect(resolveClosedTurnEndingAt(messages, 'claimed-final')).toMatchObject({
      status: 'resolved',
      sourceStartMessageId: 'user',
      sourceEndMessageId: 'claimed-final',
    });
  });

  it('rejects ambiguous source-user and prior-user identities', () => {
    const final = finalAssistant('final', 5);
    expectInvalid(
      [
        { id: 'source-user', role: 'user', content: 'First', timestamp: 1 },
        { id: 'source-user', role: 'user', content: 'Second', timestamp: 2 },
        final,
      ],
      final.id,
      'source_user_identity_invalid',
    );
    expectInvalid(
      [
        { id: 'prior-user', role: 'user', content: 'First', timestamp: 1 },
        { id: 'prior-user', role: 'user', content: 'Duplicate', timestamp: 2 },
        { id: 'source-user', role: 'user', content: 'Current', timestamp: 3 },
        final,
      ],
      final.id,
      'prior_user_identity_invalid',
    );
  });
});
