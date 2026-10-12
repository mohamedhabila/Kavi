jest.mock('../../src/services/memory/memoryAccessGateway', () => ({
  readSessionMemory: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillSystemPrompts: jest.fn().mockResolvedValue([]),
}));

import { prepareOrchestratorRequestBundle } from '../../src/engine/orchestratorRequestPreparation';
import { readSessionMemory } from '../../src/services/memory/memoryAccessGateway';
import type { LlmProviderConfig } from '../../src/types/provider';

const mockedReadSessionMemory = jest.mocked(readSessionMemory);
const MEMORY_READ = Object.freeze({ status: 'off', policyEpoch: 7 } as const);

const provider = {
  id: 'provider-1',
  name: 'Provider',
  type: 'openai',
  kind: 'remote',
  model: 'model-1',
} as LlmProviderConfig;

describe('orchestrator request memory read', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadSessionMemory.mockReturnValue(MEMORY_READ);
  });

  it('reads memory under the shared memory identity', async () => {
    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: false,
      memoryConversationId: 'shared-memory-1',
      messages: [{ id: 'user-current', role: 'user', content: 'Continue.', timestamp: 2 }],
    });

    expect(mockedReadSessionMemory).toHaveBeenCalledWith('shared-memory-1', [
      { id: 'user-current', role: 'user', content: 'Continue.', timestamp: 2 },
    ]);
    expect(result.memory).toBe(MEMORY_READ);
    expect(result.currentUserMessage).toEqual({ id: 'user-current', text: 'Continue.' });
    expect(result.requestFrame).toMatchObject({
      mode: 'chitchat',
      input: { kind: 'text' },
      continuation: 'new',
      decision: { action: 'act' },
    });
  });

  it('keeps tool grounding on raw user text rather than enriched model context', async () => {
    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: false,
      memoryConversationId: 'shared-memory-1',
      messages: [
        {
          id: 'user-raw',
          role: 'user',
          content: 'Remember the value I wrote.',
          enrichedContent: 'Remember the value I wrote.\n[link summary: provider-only detail]',
          timestamp: 3,
        },
      ],
    });

    expect(result.latestUserMessageText).toContain('provider-only detail');
    expect(result.currentUserMessage).toEqual({
      id: 'user-raw',
      text: 'Remember the value I wrote.',
    });
  });

  it('keeps internal user turns model-visible without granting user-intent authority', async () => {
    const visibleArabic = {
      id: 'visible-ar',
      role: 'user' as const,
      content: 'تابع المهمة',
      timestamp: 4,
    };
    const internalJapanese = {
      id: 'internal-ja',
      role: 'user' as const,
      content: `内部継続制御${'画'.repeat(600)}`,
      timestamp: 5,
    };
    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: true,
      internalUserMessageCount: 1,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: false,
      memoryConversationId: 'shared-memory-1',
      messages: [visibleArabic, internalJapanese],
    });

    expect(result.memoryRefreshInternalUserMessages).toEqual([internalJapanese]);
    expect(result.workingMessages).toEqual([visibleArabic, internalJapanese]);
    expect(result.currentUserMessage).toEqual({
      id: visibleArabic.id,
      text: visibleArabic.content,
    });
    expect(mockedReadSessionMemory).toHaveBeenCalledWith('shared-memory-1', [visibleArabic]);
  });
});
