jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/consolidation/paths', () => ({
  resolveConsolidationPath: jest.fn(async () => ({
    tier: 'deterministic',
    provider: null,
    model: null,
    extractor: null,
  })),
}));

jest.mock('../../../src/services/memory/turnProcessor', () => ({
  processIngestionTurn: jest.fn(),
}));

import {
  __resetIngestionQueueForTests,
  drainIngestionQueue,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  getNextPendingIngestionAttemptAt,
  INGESTION_RETRY_BASE_DELAY_MS,
  listPendingIngestionJobs,
  scheduleIngestionDrain,
} from '../../../src/services/memory/ingestionQueue';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedProcessIngestionTurn = jest.mocked(processIngestionTurn);
const mockedResolveConsolidationPath = jest.mocked(resolveConsolidationPath);

function closedTurn(suffix: string): Message[] {
  return [
    { id: `user-${suffix}`, role: 'user', content: 'Remember this.', timestamp: 1 },
    {
      id: `assistant-${suffix}`,
      role: 'assistant',
      content: 'Done.',
      timestamp: 2,
      assistantMetadata: { kind: 'final', completionStatus: 'complete' },
    },
  ];
}

function processResult(
  providerOutcome: Awaited<ReturnType<typeof processIngestionTurn>>['providerOutcome'],
): Awaited<ReturnType<typeof processIngestionTurn>> {
  return {
    processed: true,
    episodeId: 'episode-1',
    deterministicFactIds: ['fact-1'],
    providerFactIds: [],
    invalidatedFactIds: [],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    enriched: providerOutcome.status === 'valid',
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

async function flushScheduledIngestion(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  initializeMemoryPolicyObservation();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(() => {
  __resetIngestionQueueForTests();
  closeMemoryDb();
});

describe('ingestion queue structural priority', () => {
  it('processes a new durable checkpoint before an older enrichment retry', async () => {
    mockedProcessIngestionTurn.mockResolvedValueOnce(
      processResult({ status: 'provider_error', code: 'provider_request_failed' }),
    );
    const enrichmentRetry = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-enrichment-retry',
      threadTitle: null,
      memoryConversationId: 'conv-enrichment-retry',
      taskId: null,
      sourceStartMessageId: 'user-enrichment-retry',
      sourceEndMessageId: 'assistant-enrichment-retry',
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    await drainIngestionQueue({
      loadMessagesForThread: () => closedTurn('enrichment-retry'),
      now: 100,
    });
    const dueAt = 100 + INGESTION_RETRY_BASE_DELAY_MS;
    const newTurn = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'conv-new-turn',
      threadTitle: null,
      memoryConversationId: 'conv-new-turn',
      taskId: null,
      sourceStartMessageId: 'user-new-turn',
      sourceEndMessageId: 'assistant-new-turn',
      sourceRunId: null,
      sourceAt: dueAt,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: dueAt,
    })!;

    expect(listPendingIngestionJobs(1, dueAt)).toEqual([
      expect.objectContaining({ id: newTurn.id, structuralCompletedAt: null }),
    ]);
    mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: 'not_requested' }));
    await drainIngestionQueue({
      loadMessagesForThread: (threadId) =>
        closedTurn(threadId === newTurn.threadId ? 'new-turn' : 'enrichment-retry'),
      maxJobs: 1,
      now: dueAt,
    });

    expect(getIngestionJob(newTurn.id)?.status).toBe('completed_structural');
    expect(getIngestionJob(enrichmentRetry.id)).toEqual(
      expect.objectContaining({ status: 'retrying', structuralCompletedAt: 100 }),
    );
  });

  it('checkpoints an adjacent turn without letting its enrichment overtake a retrying prior turn', async () => {
    const threadId = 'conv-causal-retry';
    const history = [...closedTurn('prior'), ...closedTurn('current')];
    mockedProcessIngestionTurn.mockResolvedValueOnce(
      processResult({ status: 'provider_error', code: 'provider_request_failed' }),
    );
    const prior = enqueueIngestionJob({
      personaId: 'persona-before-switch',
      threadId,
      threadTitle: null,
      memoryConversationId: threadId,
      taskId: null,
      sourceStartMessageId: 'user-prior',
      sourceEndMessageId: 'assistant-prior',
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    await drainIngestionQueue({ loadMessagesForThread: () => history, now: 100 });
    const dueAt = 100 + INGESTION_RETRY_BASE_DELAY_MS;
    const correction = enqueueIngestionJob({
      personaId: 'persona-after-switch',
      threadId,
      threadTitle: null,
      memoryConversationId: threadId,
      taskId: null,
      priorUserMessageId: 'user-prior',
      sourceStartMessageId: 'user-current',
      sourceEndMessageId: 'assistant-current',
      sourceRunId: null,
      sourceAt: 101,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 101,
    })!;

    expect(listPendingIngestionJobs(3, 101)).toEqual([
      expect.objectContaining({ id: correction.id, structuralCompletedAt: null }),
    ]);
    expect(getNextPendingIngestionAttemptAt()).toBe(101);

    mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: 'not_requested' }));
    await drainIngestionQueue({ loadMessagesForThread: () => history, maxJobs: 1, now: 101 });

    expect(getIngestionJob(correction.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        attemptCount: 0,
        providerOutcome: 'structural_only',
        outcomeCode: null,
        nextAttemptAt: 101,
        structuralCompletedAt: 101,
      }),
    );
    expect(mockedResolveConsolidationPath).toHaveBeenCalledTimes(1);
    expect(listPendingIngestionJobs(3, 101)).toEqual([]);
    expect(getNextPendingIngestionAttemptAt()).toBe(dueAt);
    expect(listPendingIngestionJobs(3, dueAt)).toEqual([expect.objectContaining({ id: prior.id })]);

    mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: 'valid' }));
    await drainIngestionQueue({ loadMessagesForThread: () => history, maxJobs: 1, now: dueAt });

    expect(getIngestionJob(prior.id)?.status).toBe('completed_enriched');
    expect(listPendingIngestionJobs(3, dueAt)).toEqual([
      expect.objectContaining({ id: correction.id }),
    ]);

    mockedProcessIngestionTurn.mockResolvedValueOnce(processResult({ status: 'valid' }));
    await drainIngestionQueue({ loadMessagesForThread: () => history, maxJobs: 1, now: dueAt });

    expect(getIngestionJob(correction.id)).toEqual(
      expect.objectContaining({ status: 'completed_enriched', attemptCount: 1 }),
    );
    expect(mockedResolveConsolidationPath).toHaveBeenCalledTimes(3);
    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(4);
    expect(
      mockedProcessIngestionTurn.mock.calls[1]![0].messages.map((message) => message.id),
    ).toEqual(['user-current', 'assistant-current']);
    expect(
      mockedProcessIngestionTurn.mock.calls[3]![0].messages.map((message) => message.id),
    ).toEqual(['user-current', 'assistant-current']);
  });

  it('schedules one causal wake without polling after checkpointing a successor', async () => {
    jest.useFakeTimers({ now: 100 });
    try {
      const threadId = 'conv-causal-checkpoint-wake';
      const history = [...closedTurn('causal-prior'), ...closedTurn('causal-successor')];
      mockedProcessIngestionTurn
        .mockResolvedValueOnce(
          processResult({ status: 'provider_error', code: 'provider_request_failed' }),
        )
        .mockResolvedValueOnce(processResult({ status: 'not_requested' }))
        .mockResolvedValueOnce(processResult({ status: 'valid' }))
        .mockResolvedValueOnce(processResult({ status: 'valid' }));
      const prior = enqueueIngestionJob({
        personaId: 'default',
        threadId,
        threadTitle: null,
        memoryConversationId: threadId,
        taskId: null,
        sourceStartMessageId: 'user-causal-prior',
        sourceEndMessageId: 'assistant-causal-prior',
        sourceRunId: null,
        sourceAt: 100,
        chatProviderId: null,
        chatModel: null,
        reason: 'turn_completed',
        providerEnrichment: true,
        now: 100,
      })!;
      await drainIngestionQueue({ loadMessagesForThread: () => history, maxJobs: 1, now: 100 });
      const dueAt = 100 + INGESTION_RETRY_BASE_DELAY_MS;
      const successor = enqueueIngestionJob({
        personaId: 'default',
        threadId,
        threadTitle: null,
        memoryConversationId: threadId,
        taskId: null,
        priorUserMessageId: 'user-causal-prior',
        sourceStartMessageId: 'user-causal-successor',
        sourceEndMessageId: 'assistant-causal-successor',
        sourceRunId: null,
        sourceAt: 101,
        chatProviderId: null,
        chatModel: null,
        reason: 'turn_completed',
        providerEnrichment: true,
        now: 101,
      })!;
      jest.setSystemTime(101);

      scheduleIngestionDrain({ loadMessagesForThread: () => history });
      await flushScheduledIngestion();

      expect(getIngestionJob(successor.id)).toEqual(
        expect.objectContaining({ status: 'retrying', structuralCompletedAt: 101 }),
      );
      expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);
      await flushScheduledIngestion();
      expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(dueAt - 101);
      await flushScheduledIngestion();

      expect(getIngestionJob(prior.id)?.status).toBe('completed_enriched');
      expect(getIngestionJob(successor.id)?.status).toBe('completed_enriched');
      expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(4);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
