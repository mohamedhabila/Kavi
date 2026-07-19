jest.mock('../../src/services/memory/memoryAccessGateway', () => ({
  buildUnifiedMemoryAccessContext: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillSystemPrompts: jest.fn().mockResolvedValue([]),
}));

import { prepareOrchestratorRequestBundle } from '../../src/engine/orchestratorRequestPreparation';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import type { LlmProviderConfig } from '../../src/types/provider';

const mockedBuildUnifiedMemoryAccessContext =
  buildUnifiedMemoryAccessContext as jest.MockedFunction<typeof buildUnifiedMemoryAccessContext>;

const provider = {
  id: 'provider-1',
  name: 'Provider',
  type: 'openai',
  kind: 'remote',
  model: 'model-1',
} as LlmProviderConfig;

describe('orchestrator request memory consistency identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue({
      boundary: {
        startIndex: 0,
        reason: 'full_history',
        similarityScore: 1,
        idleGapMs: 0,
        droppedMessageCount: 0,
      },
      scopedMessages: [{ id: 'user-current', role: 'user', content: 'Continue.', timestamp: 2 }],
      livingMemory: null,
      consistencyBarrier: {
        outcome: 'no_job',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 1,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    });
  });

  it('passes the real source thread separately from shared memory identity', async () => {
    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      isSuperAgent: false,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: false,
      memoryConversationId: 'shared-memory-1',
      messages: [{ id: 'user-current', role: 'user', content: 'Continue.', timestamp: 2 }],
    });

    expect(mockedBuildUnifiedMemoryAccessContext).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryConversationId: 'shared-memory-1',
        sourceThreadId: 'source-thread-1',
        messages: [{ id: 'user-current', role: 'user', content: 'Continue.', timestamp: 2 }],
      }),
    );
    expect(result.memoryConsistencyBarrier).toEqual(
      expect.objectContaining({ outcome: 'no_job', queryCount: 1 }),
    );
    expect(result.currentUserMessage).toEqual({ id: 'user-current', text: 'Continue.' });
    expect(result.requestFrame).toMatchObject({
      mode: 'chitchat',
      input: { kind: 'text' },
      continuation: 'new',
      decision: { action: 'act' },
    });
  });

  it('keeps tool grounding on raw user text rather than enriched model context', async () => {
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValueOnce({
      boundary: {
        startIndex: 0,
        reason: 'full_history',
        similarityScore: 1,
        idleGapMs: 0,
        droppedMessageCount: 0,
      },
      scopedMessages: [
        {
          id: 'user-raw',
          role: 'user',
          content: 'Remember the value I wrote.',
          enrichedContent: 'Remember the value I wrote.\n[link summary: provider-only detail]',
          timestamp: 3,
        },
      ],
      livingMemory: null,
      consistencyBarrier: {
        outcome: 'no_job',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 1,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    });

    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      isSuperAgent: false,
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
      personaId: 'default',
      taskId: null,
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
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValueOnce({
      boundary: {
        startIndex: 0,
        reason: 'full_history',
        similarityScore: 1,
        idleGapMs: 0,
        droppedMessageCount: 0,
      },
      scopedMessages: [visibleArabic],
      livingMemory: null,
      consistencyBarrier: {
        outcome: 'no_job',
        durationMs: 0,
        waitedMs: 0,
        queryCount: 1,
        matchedJobCount: 0,
        queueAgeMs: null,
        initialJobStatus: null,
        finalJobStatus: null,
      },
    });

    const result = await prepareOrchestratorRequestBundle({
      activeModel: 'model-1',
      activeProvider: provider,
      callbacks: {},
      conversationId: 'source-thread-1',
      graphOwnedRun: true,
      internalUserMessageCount: 1,
      isSuperAgent: true,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: false,
      memoryConversationId: 'shared-memory-1',
      messages: [visibleArabic, internalJapanese],
      personaId: 'default',
      taskId: null,
    });

    expect(result.memoryRefreshInternalUserMessages).toEqual([internalJapanese]);
    expect(result.workingMessages).toEqual([visibleArabic, internalJapanese]);
    expect(result.currentUserMessage).toEqual({
      id: visibleArabic.id,
      text: visibleArabic.content,
    });
    expect(mockedBuildUnifiedMemoryAccessContext).toHaveBeenCalledWith(
      expect.objectContaining({
        internalUserMessageCount: 1,
        messages: [visibleArabic, internalJapanese],
      }),
    );
  });
});
