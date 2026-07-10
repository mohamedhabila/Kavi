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

import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import {
  __resetIngestionQueueForTests,
  enqueueIngestionJob,
  getIngestionJob,
  INGESTION_PROCESSING_LEASE_MS,
  INGESTION_RETRY_BASE_DELAY_MS,
  processIngestionJob,
  drainIngestionQueueWithWakeup,
  scheduleIngestionDrain,
} from '../../../src/services/memory/ingestionQueue';
import { claimIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import { __resetOnDeviceGuardsForTests } from '../../../src/services/memory/onDeviceGuards';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedResolveConsolidationPath = resolveConsolidationPath as jest.MockedFunction<
  typeof resolveConsolidationPath
>;
const mockedProcessIngestionTurn = processIngestionTurn as jest.MockedFunction<
  typeof processIngestionTurn
>;

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
  jest.useFakeTimers({ now: 100 });
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  mockedProcessIngestionTurn.mockResolvedValue(processResult({ status: 'not_requested' }));
});

afterEach(() => {
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
  jest.useRealTimers();
});

describe('ingestion queue scheduling and job context', () => {
  it('wakes a retry at its due time and stops scheduling after success', async () => {
    mockedProcessIngestionTurn
      .mockResolvedValueOnce(
        processResult({ status: 'provider_error', code: 'provider_request_failed' }),
      )
      .mockResolvedValueOnce(processResult({ status: 'valid' }));
    const job = enqueueIngestionJob({
      threadId: 'conv-auto-retry',
      sourceStartMessageId: 'user-auto-retry',
      sourceEndMessageId: 'assistant-auto-retry',
      sourceAt: 7,
      now: 100,
    })!;

    scheduleIngestionDrain({ loadMessagesForThread: () => closedTurn('auto-retry') });
    await flushScheduledIngestion();

    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        nextAttemptAt: 100 + INGESTION_RETRY_BASE_DELAY_MS,
      }),
    );
    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(INGESTION_RETRY_BASE_DELAY_MS - 1);
    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await flushScheduledIngestion();

    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(2);
    expect(mockedProcessIngestionTurn.mock.calls.map(([input]) => input.now)).toEqual([7, 7]);
    expect(getIngestionJob(job.id)?.status).toBe('completed_enriched');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('continues due work beyond the three-job mobile batch without idle polling', async () => {
    for (let index = 0; index < 5; index += 1) {
      enqueueIngestionJob({
        threadId: `conv-backlog-${index}`,
        sourceStartMessageId: `user-backlog-${index}`,
        sourceEndMessageId: `assistant-backlog-${index}`,
        now: 100,
      });
    }

    scheduleIngestionDrain({
      loadMessagesForThread: (threadId) => closedTurn(threadId.replace('conv-', '')),
    });
    await flushScheduledIngestion();

    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('backs off unavailable sources so healthy work behind the batch can run', async () => {
    const missingJobs = [];
    for (let index = 0; index < 3; index += 1) {
      missingJobs.push(
        enqueueIngestionJob({
          threadId: `conv-missing-${index}`,
          sourceEndMessageId: `assistant-missing-${index}`,
          now: 100,
        })!,
      );
    }
    const healthy = enqueueIngestionJob({
      threadId: 'conv-healthy-after-missing',
      sourceStartMessageId: 'user-healthy-after-missing',
      sourceEndMessageId: 'assistant-healthy-after-missing',
      now: 100,
    })!;

    scheduleIngestionDrain({
      loadMessagesForThread: (threadId) =>
        threadId === healthy.threadId ? closedTurn('healthy-after-missing') : [],
    });
    await flushScheduledIngestion();

    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);
    expect(getIngestionJob(healthy.id)?.status).toBe('completed_structural');
    for (const missingJob of missingJobs) {
      expect(getIngestionJob(missingJob.id)).toEqual(
        expect.objectContaining({
          status: 'retrying',
          attemptCount: 1,
          outcomeCode: 'source_window_unavailable',
        }),
      );
    }
    expect(jest.getTimerCount()).toBe(1);
  });

  it('resolves title, provider, run, and evidence independently for coalesced jobs', async () => {
    const providerA: LlmProviderConfig = {
      id: 'provider-a',
      name: 'Provider A',
      baseUrl: 'https://a.invalid/v1',
      model: 'model-a',
      enabled: true,
    };
    const providerB: LlmProviderConfig = {
      id: 'provider-b',
      name: 'Provider B',
      baseUrl: 'https://b.invalid/v1',
      model: 'model-b',
      enabled: true,
    };
    enqueueIngestionJob({
      threadId: 'conv-context-a',
      sourceStartMessageId: 'user-context-a',
      sourceEndMessageId: 'assistant-context-a',
      sourceRunId: 'run-a',
      chatProviderId: providerA.id,
      chatModel: providerA.model,
      now: 100,
    });
    enqueueIngestionJob({
      threadId: 'conv-context-b',
      sourceStartMessageId: 'user-context-b',
      sourceEndMessageId: 'assistant-context-b',
      sourceRunId: 'run-b',
      chatProviderId: providerB.id,
      chatModel: providerB.model,
      now: 100,
    });
    const loadRuntimeContextForJob = jest.fn((job) =>
      job.threadId.endsWith('-a')
        ? {
            threadTitle: 'Title A',
            activeChatProvider: providerA,
            sourceRunId: 'run-a',
            graphGoalEvidence: ['tool:a'],
          }
        : {
            threadTitle: 'Title B',
            activeChatProvider: providerB,
            sourceRunId: 'run-b',
            graphGoalEvidence: ['tool:b'],
          },
    );
    const runtime = {
      loadMessagesForThread: (threadId: string) => closedTurn(threadId.replace('conv-', '')),
      loadRuntimeContextForJob,
    };

    scheduleIngestionDrain(runtime);
    scheduleIngestionDrain(runtime);
    await flushScheduledIngestion();

    expect(mockedResolveConsolidationPath.mock.calls.map(([provider]) => provider?.id)).toEqual([
      'provider-a',
      'provider-b',
    ]);
    expect(mockedProcessIngestionTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        threadId: 'conv-context-a',
        threadTitle: 'Title A',
        sourceRunId: 'run-a',
        graphGoalEvidence: ['tool:a'],
      }),
    );
    expect(mockedProcessIngestionTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        threadId: 'conv-context-b',
        threadTitle: 'Title B',
        sourceRunId: 'run-b',
        graphGoalEvidence: ['tool:b'],
      }),
    );
  });

  it('cancels queued work synchronously when the user opts out', async () => {
    const job = enqueueIngestionJob({
      threadId: 'conv-opt-out-race',
      sourceStartMessageId: 'user-opt-out-race',
      sourceEndMessageId: 'assistant-opt-out-race',
      now: 100,
    })!;
    scheduleIngestionDrain({ loadMessagesForThread: () => closedTurn('opt-out-race') });

    useSettingsStore.getState().setDisableLongTermMemory(true);
    await flushScheduledIngestion();

    expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
    expect(getIngestionJob(job.id)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fences in-flight work across an opt-out and re-enable cycle', async () => {
    let releaseAttempt: (() => void) | undefined;
    let markAttemptStarted: (() => void) | undefined;
    const attemptHeld = new Promise<void>((resolve) => {
      releaseAttempt = resolve;
    });
    const attemptStarted = new Promise<void>((resolve) => {
      markAttemptStarted = resolve;
    });
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      markAttemptStarted?.();
      await attemptHeld;
      return input.canPersist?.()
        ? processResult({ status: 'valid' })
        : { ...processResult({ status: 'valid' }), processed: false, skipped: 'claim_lost' };
    });
    const job = enqueueIngestionJob({
      threadId: 'conv-in-flight-opt-out',
      sourceStartMessageId: 'user-in-flight-opt-out',
      sourceEndMessageId: 'assistant-in-flight-opt-out',
      now: 100,
    })!;

    scheduleIngestionDrain({ loadMessagesForThread: () => closedTurn('in-flight-opt-out') });
    jest.runAllTicks();
    await attemptStarted;
    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);

    useSettingsStore.getState().setDisableLongTermMemory(true);
    useSettingsStore.getState().setDisableLongTermMemory(false);
    releaseAttempt?.();
    await flushScheduledIngestion();

    expect(getIngestionJob(job.id)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('computes provider backoff from attempt completion rather than claim time', async () => {
    const job = enqueueIngestionJob({
      threadId: 'conv-completion-clock',
      sourceStartMessageId: 'user-completion-clock',
      sourceEndMessageId: 'assistant-completion-clock',
      now: 100,
    })!;
    mockedProcessIngestionTurn.mockImplementationOnce(async () => {
      jest.setSystemTime(30_100);
      return processResult({ status: 'provider_error', code: 'provider_request_failed' });
    });

    await processIngestionJob({
      jobId: job.id,
      messages: closedTurn('completion-clock'),
    });

    expect(getIngestionJob(job.id)?.nextAttemptAt).toBe(30_100 + INGESTION_RETRY_BASE_DELAY_MS);
  });

  it('recovers an attempt that resumes after its lease expires', async () => {
    const job = enqueueIngestionJob({
      threadId: 'conv-expired-live-attempt',
      sourceStartMessageId: 'user-expired-live-attempt',
      sourceEndMessageId: 'assistant-expired-live-attempt',
      now: 100,
    })!;
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      jest.setSystemTime(100 + INGESTION_PROCESSING_LEASE_MS);
      return input.canPersist?.()
        ? processResult({ status: 'valid' })
        : { ...processResult({ status: 'valid' }), processed: false, skipped: 'claim_lost' };
    });

    const result = await processIngestionJob({
      jobId: job.id,
      messages: closedTurn('expired-live-attempt'),
    });

    expect(result).toEqual(
      expect.objectContaining({ processed: false, status: 'retrying', skipped: 'claim_lost' }),
    );
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'stale_processing_lease',
        nextAttemptAt:
          100 + INGESTION_PROCESSING_LEASE_MS + INGESTION_RETRY_BASE_DELAY_MS,
      }),
    );
  });

  it('wakes at a dead process lease expiry after cold-start recovery runs early', async () => {
    const job = enqueueIngestionJob({
      threadId: 'conv-cold-start-lease',
      sourceStartMessageId: 'user-cold-start-lease',
      sourceEndMessageId: 'assistant-cold-start-lease',
      now: 100,
    })!;
    expect(claimIngestionJob(job.id, 100)).not.toBeNull();

    await drainIngestionQueueWithWakeup({
      loadMessagesForThread: () => closedTurn('cold-start-lease'),
    });
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(INGESTION_PROCESSING_LEASE_MS - 1);
    expect(mockedProcessIngestionTurn).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await flushScheduledIngestion();
    expect(getIngestionJob(job.id)?.status).toBe('retrying');
    await jest.advanceTimersByTimeAsync(INGESTION_RETRY_BASE_DELAY_MS);
    await flushScheduledIngestion();

    expect(mockedProcessIngestionTurn).toHaveBeenCalledTimes(1);
    expect(getIngestionJob(job.id)?.status).toBe('completed_structural');
    expect(jest.getTimerCount()).toBe(0);
  });
});
