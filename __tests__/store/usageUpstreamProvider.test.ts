jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { useChatStore } from '../helpers/chatStoreHarness';
import { sanitizeUsage } from '../../src/store/chatPersistenceUsage';
import type { ConversationUsageEntry } from '../../src/types/usage';

function usageEntry(overrides: Partial<ConversationUsageEntry> = {}): ConversationUsageEntry {
  return {
    model: 'z-ai/glm-5.3-flash',
    inputTokens: 1000,
    outputTokens: 10,
    cacheReadTokens: 512,
    cacheWriteTokens: 0,
    totalTokens: 1010,
    estimatedCost: 0,
    timestamp: 1,
    ...overrides,
  };
}

describe('upstream provider on recorded usage', () => {
  it('keeps the upstream a router served the call from on the conversation entry', () => {
    const id = useChatStore.getState().createConversation('p1', 's');

    useChatStore
      .getState()
      .recordConversationUsage(id, { ...usageEntry(), upstreamProvider: 'DigitalOcean' });

    const entries = useChatStore.getState().conversations[0]!.usage!.entries;
    expect(entries[entries.length - 1]).toEqual(
      expect.objectContaining({ upstreamProvider: 'DigitalOcean', cacheReadTokens: 512 }),
    );
  });

  it('persists a valid upstream name and drops one that is not a short label', () => {
    const sanitized = sanitizeUsage({
      entries: [
        usageEntry({ upstreamProvider: ' Fireworks ' }),
        usageEntry({ upstreamProvider: 'x'.repeat(81) }),
        usageEntry({ upstreamProvider: '   ' }),
        usageEntry(),
      ],
      totalInput: 4000,
      totalOutput: 40,
      totalCacheRead: 2048,
      totalCacheWrite: 0,
      totalTokens: 4040,
      totalCost: 0,
      totalCalls: 4,
    });

    expect(sanitized!.entries.map((entry) => entry.upstreamProvider)).toEqual([
      'Fireworks',
      undefined,
      undefined,
      undefined,
    ]);
  });
});
