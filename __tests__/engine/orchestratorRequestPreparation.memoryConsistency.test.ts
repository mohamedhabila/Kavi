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
  });
});
