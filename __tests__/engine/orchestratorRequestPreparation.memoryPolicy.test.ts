jest.mock('../../src/services/memory/memoryAccessGateway', () => ({
  buildUnifiedMemoryAccessContext: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillSystemPrompts: jest.fn().mockResolvedValue([]),
}));

import { prepareOrchestratorRequestBundle } from '../../src/engine/orchestratorRequestPreparation';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import type { LlmProviderConfig } from '../../src/types/provider';

const mockedBuildUnifiedMemoryAccessContext = jest.mocked(buildUnifiedMemoryAccessContext);
const provider = {
  id: 'provider-1',
  name: 'Provider',
  enabled: true,
  baseUrl: 'https://example.com',
  apiKey: 'key',
  model: 'model-1',
} as LlmProviderConfig;

function baseParams() {
  return {
    activeModel: provider.model,
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
    memoryConversationId: 'memory-1',
    messages: [{ id: 'user-1', role: 'user' as const, content: 'Continue.', timestamp: 1 }],
  };
}

function gatewayResult() {
  return {
    boundary: {
      startIndex: 0,
      reason: 'full_history' as const,
      similarityScore: 1,
      idleGapMs: 0,
      droppedMessageCount: 0,
    },
    scopedMessages: [{ id: 'user-1', role: 'user' as const, content: 'Continue.', timestamp: 1 }],
    livingMemory: null,
    consistencyBarrier: {
      outcome: 'no_job' as const,
      durationMs: 0,
      waitedMs: 0,
      queryCount: 1,
      matchedJobCount: 0,
      queueAgeMs: null,
      initialJobStatus: null,
      finalJobStatus: null,
    },
  };
}

describe('orchestrator request memory policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards explicit retrieval and context strategies to the unified gateway', async () => {
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue(gatewayResult());

    await prepareOrchestratorRequestBundle({
      ...baseParams(),
      memoryRetrievalStrategy: 'lexical_only',
      memoryContextStrategy: 'full_context',
    });

    expect(mockedBuildUnifiedMemoryAccessContext).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalStrategy: 'lexical_only',
        contextStrategy: 'full_context',
        retrievalLlm: { provider, model: provider.model },
      }),
    );
  });

  it('rejects an invalid strategy before entering the degradable gateway boundary', async () => {
    await expect(
      prepareOrchestratorRequestBundle({
        ...baseParams(),
        memoryRetrievalStrategy: 'invalid' as never,
      }),
    ).rejects.toThrow('Unsupported memory retrieval strategy');
    expect(mockedBuildUnifiedMemoryAccessContext).not.toHaveBeenCalled();
  });

  it('propagates operational failures for explicit diagnostic policies', async () => {
    const operationalFailure = new Error('diagnostic retrieval unavailable');
    mockedBuildUnifiedMemoryAccessContext.mockRejectedValue(operationalFailure);
    await expect(
      prepareOrchestratorRequestBundle({
        ...baseParams(),
        memoryRetrievalStrategy: 'lexical_only',
      }),
    ).rejects.toBe(operationalFailure);
  });

  it('preserves scoped graceful fallback for ordinary production behavior', async () => {
    mockedBuildUnifiedMemoryAccessContext.mockRejectedValue(new Error('memory unavailable'));
    const params = baseParams();
    const result = await prepareOrchestratorRequestBundle(params);
    expect(result.workingMessages).toEqual(params.messages);
    expect(params.logger.devWarn).toHaveBeenCalledWith(
      'Unified memory access unavailable for this request:',
      'memory unavailable',
    );
  });

  it('captures a waiting-async resume as code-owned continuation state', async () => {
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue(gatewayResult());
    const result = await prepareOrchestratorRequestBundle({
      ...baseParams(),
      graphOwnedRun: true,
      graphSnapshot: {
        status: 'waiting_async',
        goals: [],
        asyncWork: {
          awaitingBackgroundWorkers: false,
          pendingOperations: [],
          updatedAt: 1,
        },
      } as never,
    });

    expect(result.requestFrame).toMatchObject({
      mode: 'agentic',
      continuation: 'resume_waiting_async',
    });
  });
});
