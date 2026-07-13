import {
  partializeChatPersistState,
  sanitizeConversationForPersistence,
} from '../../src/store/chatPersistence';
import { normalizePersistedChatState } from '../../src/store/chatStoreNormalization';
import { makeTestConversation } from '../helpers/factories';

describe('semantic memory handoff persistence and hydration', () => {
  it('round-trips a valid handoff and projects away unknown or malformed persisted fields', () => {
    const handoff = {
      version: 1 as const,
      memoryConversationId: 'source-conversation',
      sourceThreadId: 'source-conversation',
      sourceEndMessageId: 'assistant-source',
    };
    const valid = makeTestConversation({ semanticMemoryHandoff: handoff });
    const persisted = partializeChatPersistState({
      conversations: [valid],
      activeConversationId: valid.id,
    });
    const restarted = normalizePersistedChatState(
      JSON.parse(JSON.stringify(persisted)) as typeof persisted,
    );
    expect(restarted.conversations[0].semanticMemoryHandoff).toEqual(handoff);

    const withUnknownContent = sanitizeConversationForPersistence({
      ...valid,
      semanticMemoryHandoff: {
        ...handoff,
        rawUserText: 'must not persist',
      } as unknown as typeof handoff,
    });
    expect(withUnknownContent.semanticMemoryHandoff).toEqual(handoff);
    expect(JSON.stringify(withUnknownContent.semanticMemoryHandoff)).not.toContain(
      'must not persist',
    );

    const malformed = normalizePersistedChatState({
      conversations: [
        {
          ...valid,
          semanticMemoryHandoff: {
            ...handoff,
            sourceEndMessageId: ' invalid source ',
          },
        },
      ],
      activeConversationId: valid.id,
    });
    expect(malformed.conversations[0].semanticMemoryHandoff).toBeUndefined();
  });
});
