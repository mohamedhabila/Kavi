import type { Message } from '../../src/types/message';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';

jest.mock('../../src/services/memory/localSimilarity', () => {
  const actual = jest.requireActual('../../src/services/memory/localSimilarity');
  return {
    ...actual,
    createCurrentLocalSimilarityVector: jest.fn(actual.createCurrentLocalSimilarityVector),
  };
});

jest.mock('../../src/services/memory/localSimilarityBackfill', () => ({
  maintainCurrentFactLocalSimilarity: jest.fn().mockReturnValue({
    processedCount: 0,
    hasMore: false,
    model: 'unicode-char-ngram-v1',
    dimensions: 384,
  }),
}));

jest.mock('../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockImplementation(async (options) => ({
    memoryAuthoritySnapshot: options.memoryAuthoritySnapshot,
    sections: [{ text: 'focus section', cacheable: false }],
    cacheableSignature: 'abc',
    focusBlockText: 'Fix migration failure',
    openThreadLabels: ['migration mismatch'],
    recalledFactCount: 2,
  })),
}));

jest.mock('../../src/services/memory/memoryAuthority', () => ({
  captureMemoryAuthoritySnapshot: jest.fn().mockReturnValue(
    Object.freeze({
      processEpochs: Object.freeze({ restrictive: 3, projection: 5 }),
      restrictiveRevision: Object.freeze({
        kind: 'restrictive',
        memoryOwnerId: 'gateway-owner',
        value: 7,
      }),
      projectionRevision: Object.freeze({
        kind: 'projection',
        memoryOwnerId: 'gateway-owner',
        value: 11,
      }),
      policy: Object.freeze({ enabled: true, revision: 2 }),
    }),
  ),
  isMemoryProjectionSnapshotCurrent: jest.fn().mockReturnValue(true),
  isMemoryProjectionSnapshotDurablyCurrent: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn().mockReturnValue(true),
  captureMemoryReadEpoch: jest.fn().mockReturnValue(7),
  isMemoryReadEpochCurrent: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/services/memory/ingestionQueueStore', () => ({
  getIngestionJobForSourceTurn: jest.fn().mockReturnValue(null),
}));

import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { canReadLongTermMemory, isMemoryReadEpochCurrent } from '../../src/services/memory/policy';
import { getIngestionJobForSourceTurn } from '../../src/services/memory/ingestionQueueStore';
import type { IngestionJob } from '../../src/services/memory/ingestionQueueStore';
import type { LlmProviderConfig } from '../../src/types/provider';
import { createCurrentLocalSimilarityVector } from '../../src/services/memory/localSimilarity';
import { maintainCurrentFactLocalSimilarity } from '../../src/services/memory/localSimilarityBackfill';
import {
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
} from '../../src/services/memory/memoryAuthority';

const RETRIEVAL_PROVIDER: LlmProviderConfig = {
  id: 'retrieval-provider',
  name: 'Retrieval provider',
  enabled: true,
  baseUrl: 'https://example.com',
  apiKey: 'test-key',
  model: 'retrieval-model',
};

const mockedGetIngestionJobForSourceTurn = getIngestionJobForSourceTurn as jest.MockedFunction<
  typeof getIngestionJobForSourceTurn
>;

function buildIngestionJob(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    id: 'job-1',
    threadId: 'thread-1',
    threadTitle: null,
    memoryConversationId: 'memory-1',
    personaId: 'default',
    taskId: null,
    sourceRunId: null,
    chatProviderId: null,
    chatModel: null,
    sourceStartMessageId: 'u1',
    sourceEndMessageId: 'a1',
    sourceAt: 2_000,
    reason: 'turn_completed',
    status: 'pending',
    attemptCount: 0,
    providerEnrichment: true,
    providerOutcome: null,
    outcomeCode: null,
    nextAttemptAt: 0,
    leaseExpiresAt: null,
    claimToken: null,
    structuralCompletedAt: null,
    createdAt: 2_000,
    updatedAt: 2_000,
    completedAt: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message>): Message {
  const role = overrides.role || 'user';
  return {
    id: overrides.id || `msg-${Math.random()}`,
    role,
    content: overrides.content || '',
    timestamp: overrides.timestamp ?? Date.now(),
    ...(role === 'assistant'
      ? {
          assistantMetadata: {
            kind: 'final' as const,
            completionStatus: 'complete' as const,
            finishReason: 'stop',
          },
        }
      : {}),
    ...overrides,
  };
}

describe('memoryAccessGateway', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    (canReadLongTermMemory as jest.Mock).mockReturnValue(true);
    (isMemoryReadEpochCurrent as jest.Mock).mockReturnValue(true);
    jest.mocked(isMemoryProjectionSnapshotCurrent).mockReturnValue(true);
    jest.mocked(isMemoryProjectionSnapshotDurablyCurrent).mockReturnValue(true);
    mockedGetIngestionJobForSourceTurn.mockReturnValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads living memory from full chat history without topic-boundary scoping', async () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Discuss travel itinerary options',
        timestamp: 1_000,
      }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Here are options', timestamp: 2_000 }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Fix migration mismatch in release workflow',
        timestamp: 30_000_000,
      }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
      mode: 'chat',
      now: 30_000_000,
    });

    expect(result.boundary.startIndex).toBe(0);
    expect(result.boundary.reason).toBe('full_history');
    expect(result.scopedMessages).toHaveLength(3);
    expect(buildLivingMemorySections).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        conversationId: 'memory-1',
        sourceThreadId: 'thread-1',
        personaId: 'default',
        candidateStrategy: 'hybrid',
        consistencyBarrier: expect.objectContaining({ outcome: 'no_job', queryCount: 1 }),
      }),
    );
    expect(mockedGetIngestionJobForSourceTurn).toHaveBeenCalledWith({
      memoryConversationId: 'memory-1',
      sourceThreadId: 'thread-1',
      sourceEndMessageId: 'a1',
    });
    expect(result.consistencyBarrier).toMatchObject({
      outcome: 'no_job',
      waitedMs: 0,
      queryCount: 1,
    });
    expect(result.livingMemory?.consistencyBarrier).toEqual(result.consistencyBarrier);
    const exactSnapshot =
      jest.mocked(buildLivingMemorySections).mock.calls[0][0].memoryAuthoritySnapshot;
    expect(exactSnapshot).toBeDefined();
    expect(result.livingMemory?.memoryAuthoritySnapshot).toBe(exactSnapshot);
    expect(createCurrentLocalSimilarityVector).toHaveBeenCalledTimes(1);
    expect(createCurrentLocalSimilarityVector).toHaveBeenCalledWith(
      'Discuss travel itinerary options\nFix migration mismatch in release workflow',
    );
    expect(jest.mocked(buildLivingMemorySections).mock.calls[0][0].localSimilarity).toMatchObject({
      queryVector: { model: 'unicode-char-ngram-v1', dimensions: 384 },
    });
    expect(maintainCurrentFactLocalSimilarity).toHaveBeenCalledTimes(1);
  });

  it('applies boundary selection in pilot mode before loading living memory', async () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Discuss travel itinerary options',
        timestamp: 1_000,
      }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Here are options', timestamp: 2_000 }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Fix migration mismatch in release workflow',
        timestamp: 30_000_000,
      }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-pilot',
      sourceThreadId: 'thread-pilot',
      mode: 'pilot',
      now: 30_000_000,
    });

    expect(result.boundary.startIndex).toBe(2);
    expect(result.scopedMessages).toEqual([messages[2]]);
    expect(buildLivingMemorySections).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [messages[2]],
        conversationId: 'memory-pilot',
      }),
    );
  });

  it('applies explicit full-context and deterministic lexical retrieval policies', async () => {
    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Old topic', timestamp: 1_000 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Old response', timestamp: 2_000 }),
      makeMessage({ id: 'u2', role: 'user', content: 'New topic', timestamp: 30_000_000 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-diagnostic',
      sourceThreadId: 'thread-diagnostic',
      mode: 'pilot',
      now: 30_000_000,
      contextStrategy: 'full_context',
      retrievalStrategy: 'lexical_only',
      retrievalLlm: { provider: RETRIEVAL_PROVIDER, model: RETRIEVAL_PROVIDER.model },
    });

    expect(result.boundary).toMatchObject({ startIndex: 0, reason: 'full_history' });
    expect(result.scopedMessages).toEqual(messages);
    const livingMemoryInput = jest.mocked(buildLivingMemorySections).mock.calls[0][0];
    expect(livingMemoryInput).not.toHaveProperty('retrievalLlm');
    expect(livingMemoryInput).not.toHaveProperty('localSimilarity');
    expect(maintainCurrentFactLocalSimilarity).not.toHaveBeenCalled();
    expect(livingMemoryInput.candidateStrategy).toBe('lexical');

    await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-production',
      sourceThreadId: 'thread-production',
      mode: 'chat',
      retrievalStrategy: 'production',
      retrievalLlm: { provider: RETRIEVAL_PROVIDER, model: RETRIEVAL_PROVIDER.model },
    });
    expect(jest.mocked(buildLivingMemorySections).mock.calls[1][0]).toMatchObject({
      retrievalLlm: { provider: RETRIEVAL_PROVIDER, model: RETRIEVAL_PROVIDER.model },
      candidateStrategy: 'hybrid',
      localSimilarity: {
        queryVector: { model: 'unicode-char-ngram-v1', dimensions: 384 },
      },
    });
    expect(createCurrentLocalSimilarityVector).toHaveBeenCalledTimes(1);
    expect(maintainCurrentFactLocalSimilarity).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown memory access policies instead of silently changing behavior', async () => {
    await expect(
      buildUnifiedMemoryAccessContext({
        messages: [makeMessage({ id: 'u1', role: 'user', content: 'Question' })],
        memoryConversationId: 'memory-invalid-policy',
        sourceThreadId: 'thread-invalid-policy',
        mode: 'chat',
        retrievalStrategy: 'unknown' as never,
      }),
    ).rejects.toThrow('Unsupported memory retrieval strategy');
  });

  it('returns no living memory when long-term memory is disabled', async () => {
    (canReadLongTermMemory as jest.Mock).mockReturnValue(false);
    (isMemoryReadEpochCurrent as jest.Mock).mockReturnValue(false);

    const messages: Message[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Fix migration mismatch', timestamp: 1_000 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-opt-out',
      sourceThreadId: 'thread-opt-out',
      mode: 'chat',
    });

    expect(result.livingMemory).toBeNull();
    expect(result.consistencyBarrier.outcome).toBe('opt_out');
    expect(mockedGetIngestionJobForSourceTurn).not.toHaveBeenCalled();
    expect(buildLivingMemorySections).not.toHaveBeenCalled();
    expect(createCurrentLocalSimilarityVector).not.toHaveBeenCalled();
    expect(maintainCurrentFactLocalSimilarity).not.toHaveBeenCalled();
  });

  it('excludes trailing internal control user prompts before boundary and recall', async () => {
    const messages: Message[] = [
      makeMessage({
        id: 'u1',
        role: 'user',
        content: 'Fix migration mismatch in release workflow',
        timestamp: 1_000,
      }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        content: 'Investigating migration mismatch.',
        timestamp: 2_000,
      }),
      makeMessage({
        id: 'u2',
        role: 'user',
        content: 'Continue from current draft and close pilot gaps.',
        timestamp: 3_000,
      }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-control',
      sourceThreadId: 'thread-control',
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

  it('continues unified retrieval immediately when the exact prior job is degraded', async () => {
    mockedGetIngestionJobForSourceTurn.mockReturnValue(
      buildIngestionJob({ status: 'degraded', structuralCompletedAt: 90, completedAt: 90 }),
    );
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Remember this.', timestamp: 1 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Remembered.', timestamp: 2 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Use it now.', timestamp: 3 }),
    ];

    const result = await buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-1',
      sourceThreadId: 'thread-1',
      mode: 'chat',
    });

    expect(result.consistencyBarrier).toMatchObject({ outcome: 'degraded', waitedMs: 0 });
    expect(buildLivingMemorySections).toHaveBeenCalledTimes(1);
    expect(buildLivingMemorySections).toHaveBeenCalledWith(
      expect.objectContaining({ messages, conversationId: 'memory-1' }),
    );
  });

  it('continues unified retrieval after the bounded barrier times out', async () => {
    jest.useFakeTimers({ now: 100 });
    mockedGetIngestionJobForSourceTurn.mockReturnValue(
      buildIngestionJob({ status: 'pending', nextAttemptAt: 100 }),
    );
    const messages = [
      makeMessage({ id: 'u1', role: 'user', content: 'Remember this.', timestamp: 1 }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Remembered.', timestamp: 2 }),
      makeMessage({ id: 'u2', role: 'user', content: 'Use it now.', timestamp: 3 }),
    ];

    const pendingResult = buildUnifiedMemoryAccessContext({
      messages,
      memoryConversationId: 'memory-1',
      sourceThreadId: 'thread-1',
      mode: 'chat',
    });
    await jest.advanceTimersByTimeAsync(120);
    const result = await pendingResult;

    expect(result.consistencyBarrier).toMatchObject({
      outcome: 'timed_out',
      waitedMs: 120,
      initialJobStatus: 'pending',
      finalJobStatus: 'pending',
    });
    expect(buildLivingMemorySections).toHaveBeenCalledTimes(1);
  });

  it('discards mixed evidence when projection authority changes during bridge work', async () => {
    jest.mocked(buildLivingMemorySections).mockImplementationOnce(async (options) => {
      jest.mocked(isMemoryProjectionSnapshotDurablyCurrent).mockReturnValue(false);
      return {
        memoryAuthoritySnapshot: options.memoryAuthoritySnapshot,
        sections: [{ text: 'stale evidence', cacheable: false }],
        cacheableSignature: 'stale',
        focusBlockText: '',
        openThreadLabels: [],
        recalledFactCount: 1,
        recalledEpisodeCount: 0,
        applicabilityPolicy: {
          useIntent: 'automatic_prompt',
          consideredFactCount: 1,
          promptVisibleFactCount: 1,
          promptBudgetDroppedFactCount: 0,
          actionCounts: { use: 1, corroborate: 0, verify: 0, silent: 0 },
          reasonCounts: {},
        },
      };
    });

    const result = await buildUnifiedMemoryAccessContext({
      messages: [makeMessage({ id: 'u-race', role: 'user', content: '続けて' })],
      memoryConversationId: 'memory-race',
      sourceThreadId: 'thread-race',
      personaId: 'default',
      taskId: null,
      mode: 'chat',
    });

    expect(result.livingMemory).toBeNull();
  });

  it('accepts a bridge-issued additive authority continuation', async () => {
    let continuation: NonNullable<
      Awaited<ReturnType<typeof buildLivingMemorySections>>['memoryAuthoritySnapshot']
    > | null = null;
    jest.mocked(buildLivingMemorySections).mockImplementationOnce(async (options) => {
      continuation = Object.freeze({
        ...options.memoryAuthoritySnapshot!,
        processEpochs: Object.freeze({
          ...options.memoryAuthoritySnapshot!.processEpochs,
          projection: options.memoryAuthoritySnapshot!.processEpochs.projection + 1,
        }),
        projectionRevision: Object.freeze({
          ...options.memoryAuthoritySnapshot!.projectionRevision,
          value: options.memoryAuthoritySnapshot!.projectionRevision.value + 1,
        }),
      });
      return {
        memoryAuthoritySnapshot: continuation,
        sections: [{ text: 'continued generation', cacheable: false }],
        cacheableSignature: 'continued',
        focusBlockText: '',
        openThreadLabels: [],
        recalledFactCount: 1,
        recalledEpisodeCount: 0,
        applicabilityPolicy: {
          useIntent: 'automatic_prompt',
          consideredFactCount: 1,
          promptVisibleFactCount: 1,
          promptBudgetDroppedFactCount: 0,
          actionCounts: { use: 1, corroborate: 0, verify: 0, silent: 0 },
          reasonCounts: {},
        },
      };
    });

    const result = await buildUnifiedMemoryAccessContext({
      messages: [makeMessage({ id: 'u-continued', role: 'user', content: 'تابع' })],
      memoryConversationId: 'memory-continued',
      sourceThreadId: 'thread-continued',
      personaId: 'default',
      taskId: null,
      mode: 'chat',
    });

    expect(result.livingMemory?.memoryAuthoritySnapshot).toBe(continuation);
    expect(result.livingMemory?.sections).toEqual([
      { text: 'continued generation', cacheable: false },
    ]);
  });

  it('rejects a bridge result carrying incompatible restrictive authority', async () => {
    jest.mocked(buildLivingMemorySections).mockImplementationOnce(async (options) => ({
      memoryAuthoritySnapshot: Object.freeze({
        ...options.memoryAuthoritySnapshot!,
        restrictiveRevision: Object.freeze({
          ...options.memoryAuthoritySnapshot!.restrictiveRevision,
          value: options.memoryAuthoritySnapshot!.restrictiveRevision.value + 1,
        }),
      }),
      sections: [{ text: 'mixed generation', cacheable: false }],
      cacheableSignature: 'mixed',
      focusBlockText: '',
      openThreadLabels: [],
      recalledFactCount: 0,
      recalledEpisodeCount: 0,
      applicabilityPolicy: {
        useIntent: 'automatic_prompt',
        consideredFactCount: 0,
        promptVisibleFactCount: 0,
        promptBudgetDroppedFactCount: 0,
        actionCounts: { use: 0, corroborate: 0, verify: 0, silent: 0 },
        reasonCounts: {},
      },
    }));

    const result = await buildUnifiedMemoryAccessContext({
      messages: [makeMessage({ id: 'u-mixed', role: 'user', content: 'تابع' })],
      memoryConversationId: 'memory-mixed',
      sourceThreadId: 'thread-mixed',
      personaId: 'default',
      taskId: null,
      mode: 'chat',
    });

    expect(result.livingMemory).toBeNull();
  });
});
