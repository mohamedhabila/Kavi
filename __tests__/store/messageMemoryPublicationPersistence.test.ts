import { sanitizeConversationForPersistence } from '../../src/store/chatPersistence';
import { useChatStore } from '../helpers/chatStoreHarness';
import { makeTestConversation, makeTestMessage } from '../helpers/factories';

function rawPersistedState(memoryPublication?: unknown) {
  return {
    conversations: [
      {
        id: 'receipt-conversation',
        title: 'Receipt conversation',
        messages: [
          {
            id: 'assistant-final',
            role: 'assistant',
            content: 'Persisted final',
            timestamp: 1,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
            },
            ...(memoryPublication !== undefined ? { memoryPublication } : {}),
          },
        ],
        createdAt: 1,
        updatedAt: 1,
        providerId: 'provider',
        systemPrompt: 'system',
      },
    ],
    activeConversationId: 'receipt-conversation',
  };
}

describe('message memory publication persistence', () => {
  it('round-trips a valid receipt while stripping fields outside its contract', () => {
    const conversation = makeTestConversation({
      messages: [
        makeTestMessage(1, {
          role: 'assistant',
          content: 'Final response',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
          memoryPublication: {
            version: 1,
            disposition: 'enqueued',
            jobId: 'must-not-persist',
            content: 'must-not-persist',
          } as any,
        }),
      ],
    });

    expect(sanitizeConversationForPersistence(conversation).messages[0].memoryPublication).toEqual({
      version: 1,
      disposition: 'enqueued',
    });
  });

  it.each([
    { label: 'malformed receipt', receipt: { version: 1, disposition: 'pending' } },
    { label: 'incomplete final', receipt: { version: 1, disposition: null }, incomplete: true },
    { label: 'non-assistant source', receipt: { version: 1, disposition: 'opt_out' }, user: true },
  ])('drops a receipt from an invalid $label', ({ receipt, incomplete, user }) => {
    const persisted = sanitizeConversationForPersistence(
      makeTestConversation({
        messages: [
          makeTestMessage(1, {
            role: user ? 'user' : 'assistant',
            content: 'Source',
            assistantMetadata: user
              ? undefined
              : {
                  kind: 'final',
                  completionStatus: incomplete ? 'incomplete' : 'complete',
                  finishReason: incomplete ? 'response_failed' : 'stop',
                },
            memoryPublication: receipt as any,
          }),
        ],
      }),
    );

    expect(persisted.messages[0].memoryPublication).toBeUndefined();
  });

  it('strictly projects assistant metadata instead of persisting unknown fields', () => {
    const persisted = sanitizeConversationForPersistence(
      makeTestConversation({
        messages: [
          makeTestMessage(1, {
            role: 'assistant',
            content: 'Final response',
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'complete',
              finishReason: 'stop',
              unknownPrivateField: 'must-not-persist',
            } as any,
          }),
        ],
      }),
    );

    expect(persisted.messages[0].assistantMetadata).toEqual({
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'stop',
    });
  });

  it.each([
    {
      label: 'unknown complete disposition',
      metadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'plausible_but_unowned_success',
      },
    },
    {
      label: 'tool disposition on a final response',
      metadata: { kind: 'final', completionStatus: 'complete', finishReason: 'tool_calls' },
    },
    {
      label: 'final code disposition on an intermediate response',
      metadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'graph_finalized',
      },
    },
    {
      label: 'mismatched incomplete disposition',
      metadata: { kind: 'final', completionStatus: 'complete', finishReason: 'response_failed' },
    },
  ])('drops assistant metadata with an invalid $label', ({ metadata }) => {
    const persisted = sanitizeConversationForPersistence(
      makeTestConversation({
        messages: [
          makeTestMessage(1, {
            role: 'assistant',
            content: 'Persisted response',
            assistantMetadata: metadata as any,
          }),
        ],
      }),
    );

    expect(persisted.messages[0].assistantMetadata).toBeUndefined();
  });

  it('persists only a valid intermediate tool disposition combination', () => {
    const persisted = sanitizeConversationForPersistence(
      makeTestConversation({
        messages: [
          makeTestMessage(1, {
            role: 'assistant',
            content: '',
            assistantMetadata: {
              kind: 'intermediate',
              completionStatus: 'complete',
              finishReason: 'tool_calls',
            },
          }),
        ],
      }),
    );

    expect(persisted.messages[0].assistantMetadata).toEqual({
      kind: 'intermediate',
      completionStatus: 'complete',
      finishReason: 'tool_calls',
    });
  });

  it('drops pre-v9 forged receipts without inferring state and preserves valid v9 receipts', async () => {
    const persistOptions = (useChatStore as any).persist.getOptions();
    const receipt = { version: 1, disposition: 'enqueued' };

    const migratedV8 = await persistOptions.migrate(rawPersistedState(receipt), 8);
    const migratedV9 = await persistOptions.migrate(rawPersistedState(receipt), 9);
    const migratedAbsent = await persistOptions.migrate(rawPersistedState(), 8);

    expect(persistOptions.version).toBe(9);
    expect(migratedV8.conversations[0].messages[0].memoryPublication).toBeUndefined();
    expect(migratedV9.conversations[0].messages[0].memoryPublication).toEqual(receipt);
    expect(migratedAbsent.conversations[0].messages[0].memoryPublication).toBeUndefined();
  });
});
