import type { Message } from '../../src/types';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';

jest.mock('../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockResolvedValue({
    sections: [{ text: 'focus section', cacheable: false }],
    cacheableSignature: 'abc',
    focusBlockText: 'Fix migration failure',
    openThreadLabels: ['migration mismatch'],
    recalledFactCount: 2,
  }),
}));

jest.mock('../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn().mockReturnValue(true),
}));

import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { canReadLongTermMemory } from '../../src/services/memory/policy';

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || `msg-${Math.random()}`,
    role: overrides.role || 'user',
    content: overrides.content || '',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  };
}

describe('memoryAccessGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (canReadLongTermMemory as jest.Mock).mockReturnValue(true);
  });

  it('applies boundary selection before loading living memory', async () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Discuss travel itinerary options', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Here are options', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Fix migration mismatch in release workflow', timestamp: 30_000_000 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      conversationId: 'conv-1',
      mode: 'chat',
      now: 30_000_000,
    });

    expect(result.boundary.startIndex).toBe(2);
    expect(result.scopedMessages).toHaveLength(1);
    expect(buildLivingMemorySections).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [messages[2]],
        conversationId: 'conv-1',
      }),
    );
  });

  it('returns no living memory when long-term memory is disabled', async () => {
    (canReadLongTermMemory as jest.Mock).mockReturnValue(false);

    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Fix migration mismatch', timestamp: 1_000 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      mode: 'chat',
    });

    expect(result.livingMemory).toBeNull();
    expect(buildLivingMemorySections).not.toHaveBeenCalled();
  });

  it('excludes trailing internal control user prompts before boundary and recall', async () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Fix migration mismatch in release workflow', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Investigating migration mismatch.', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Continue from current draft and close pilot gaps.', timestamp: 3_000 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      conversationId: 'conv-control',
      mode: 'chat',
      internalUserMessageCount: 1,
    });

    expect(result.scopedMessages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(buildLivingMemorySections).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [messages[0], messages[1]],
      }),
    );
  });
});
