jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  enqueueIngestionJob,
  getIngestionJobForSourceTurn,
} from '../../../src/services/memory/ingestionQueueStore';
import * as ingestionQueueStore from '../../../src/services/memory/ingestionQueueStore';
import {
  NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS,
  waitForNextTurnMemoryConsistency,
  type NextTurnMemoryConsistencyClock,
} from '../../../src/services/memory/nextTurnConsistency';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function deterministicClock(
  startAt = 100,
  onWait?: (now: number, waitCount: number, delayMs: number) => void,
): NextTurnMemoryConsistencyClock {
  let now = startAt;
  let waitCount = 0;
  return {
    now: () => now,
    wait: async (delayMs) => {
      now += delayMs;
      waitCount += 1;
      onWait?.(now, waitCount, delayMs);
    },
  };
}

function enqueueSourceTurn(
  sourceThreadId: string,
  sourceEndMessageId: string,
  memoryConversationId = 'shared-memory',
  now = 100,
) {
  return enqueueIngestionJob({
    personaId: 'default',
    threadId: sourceThreadId,
    threadTitle: null,
    memoryConversationId,
    taskId: null,
    sourceStartMessageId: `user-${sourceEndMessageId}`,
    sourceEndMessageId,
    sourceRunId: null,
    sourceAt: now,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now,
  });
}

function setJobState(
  jobId: string,
  status: string,
  options: {
    nextAttemptAt?: number | null;
    leaseExpiresAt?: number | null;
    structuralCompletedAt?: number | null;
  } = {},
): void {
  const isProcessing = status === 'processing';
  const hasStructuralState = ['degraded', 'completed_structural', 'completed_enriched'].includes(
    status,
  );
  const isTerminal = ['degraded', 'completed_structural', 'completed_enriched', 'failed'].includes(
    status,
  );
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET status = ?,
            next_attempt_at = ?,
            lease_expires_at = ?,
            claim_token = ?,
            structural_completed_at = ?,
            completed_at = ?,
            provider_outcome = ?,
            updated_at = ?
      WHERE id = ?`,
    status,
    options.nextAttemptAt ?? null,
    options.leaseExpiresAt ?? null,
    isProcessing ? `claim-${jobId}` : null,
    options.structuralCompletedAt !== undefined
      ? options.structuralCompletedAt
      : hasStructuralState
        ? 100
        : null,
    isTerminal ? 100 : null,
    status === 'completed_structural'
      ? 'structural_only'
      : status === 'completed_enriched'
        ? 'valid'
        : null,
    100,
    jobId,
  );
}

beforeEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

describe('next-turn memory consistency', () => {
  it('queries only the exact memory conversation, source thread, and source end message', () => {
    const target = enqueueSourceTurn('thread-a', 'assistant-a');
    enqueueSourceTurn('thread-b', 'assistant-b');

    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-a',
        sourceEndMessageId: 'assistant-a',
      })?.id,
    ).toBe(target?.id);
    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-b',
        sourceEndMessageId: 'assistant-a',
      }),
    ).toBeNull();
    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: 'other-memory',
        sourceThreadId: 'thread-a',
        sourceEndMessageId: 'assistant-a',
      }),
    ).toBeNull();
  });

  it('ignores unrelated shared-memory jobs when the exact source turn is complete', async () => {
    const target = enqueueSourceTurn('thread-a', 'assistant-a');
    const unrelated = enqueueSourceTurn('thread-b', 'assistant-b');
    setJobState(target!.id, 'completed_structural');
    setJobState(unrelated!.id, 'processing', { leaseExpiresAt: 1_000 });

    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-a',
        sourceEndMessageId: 'assistant-a',
        clock: deterministicClock(),
      }),
    ).resolves.toEqual({
      outcome: 'completed',
      durationMs: 0,
      waitedMs: 0,
      queryCount: 1,
      matchedJobCount: 1,
      queueAgeMs: 0,
      initialJobStatus: 'completed_structural',
      finalJobStatus: 'completed_structural',
    });
  });

  it('reports queue age from the initially matched source-turn job', async () => {
    const target = enqueueSourceTurn('thread-aged', 'assistant-aged', 'shared-memory', 40);
    setJobState(target!.id, 'completed_enriched');

    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-aged',
        sourceEndMessageId: 'assistant-aged',
        clock: deterministicClock(100),
      }),
    ).resolves.toMatchObject({
      outcome: 'completed',
      queueAgeMs: 60,
    });
  });

  it('does not let a newer completed shared-memory job satisfy the exact pending source turn', async () => {
    enqueueSourceTurn('thread-target', 'assistant-target');
    const newerUnrelated = enqueueSourceTurn(
      'thread-newer',
      'assistant-newer',
      'shared-memory',
      200,
    );
    setJobState(newerUnrelated!.id, 'completed_enriched');

    const result = await waitForNextTurnMemoryConsistency({
      memoryConversationId: 'shared-memory',
      sourceThreadId: 'thread-target',
      sourceEndMessageId: 'assistant-target',
      clock: deterministicClock(),
    });

    expect(result).toMatchObject({
      outcome: 'timed_out',
      waitedMs: 120,
      queryCount: 6,
      initialJobStatus: 'pending',
      finalJobStatus: 'pending',
    });
  });

  it('returns no-job and terminal outcomes without waiting', async () => {
    const degraded = enqueueSourceTurn('thread-degraded', 'assistant-degraded');
    const failed = enqueueSourceTurn('thread-failed', 'assistant-failed');
    setJobState(degraded!.id, 'degraded');
    setJobState(failed!.id, 'failed');

    const inputs = [
      { thread: 'thread-missing', message: 'assistant-missing', outcome: 'no_job' },
      { thread: 'thread-degraded', message: 'assistant-degraded', outcome: 'degraded' },
      { thread: 'thread-failed', message: 'assistant-failed', outcome: 'degraded' },
    ] as const;
    for (const input of inputs) {
      const result = await waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: input.thread,
        sourceEndMessageId: input.message,
        clock: deterministicClock(),
      });
      expect(result).toMatchObject({ outcome: input.outcome, durationMs: 0, waitedMs: 0 });
    }
  });

  it('observes an asynchronously processing job settle inside the budget', async () => {
    const job = enqueueSourceTurn('thread-processing', 'assistant-processing');
    setJobState(job!.id, 'processing', { leaseExpiresAt: 1_000 });
    const clock = deterministicClock(100, (_now, waitCount) => {
      if (waitCount === 1) setJobState(job!.id, 'completed_enriched');
    });

    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-processing',
        sourceEndMessageId: 'assistant-processing',
        clock,
      }),
    ).resolves.toMatchObject({
      outcome: 'completed',
      durationMs: 8,
      waitedMs: 8,
      queryCount: 2,
      initialJobStatus: 'processing',
      finalJobStatus: 'completed_enriched',
    });
  });

  it.each(['processing', 'retrying'] as const)(
    'treats a durable structural checkpoint as readable while enrichment is %s',
    async (status) => {
      const job = enqueueSourceTurn(`thread-${status}-checkpoint`, `assistant-${status}`);
      setJobState(job!.id, status, {
        structuralCompletedAt: 77,
        leaseExpiresAt: status === 'processing' ? 1_000 : null,
        nextAttemptAt: status === 'retrying' ? 1_000 : null,
      });
      const wait = jest.fn(async () => undefined);

      await expect(
        waitForNextTurnMemoryConsistency({
          memoryConversationId: 'shared-memory',
          sourceThreadId: `thread-${status}-checkpoint`,
          sourceEndMessageId: `assistant-${status}`,
          clock: { now: () => 100, wait },
        }),
      ).resolves.toMatchObject({
        outcome: 'completed',
        waitedMs: 0,
        initialJobStatus: status,
        finalJobStatus: status,
      });
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it('allows a due pending job to settle but never processes it itself', async () => {
    const job = enqueueSourceTurn('thread-pending', 'assistant-pending');
    const clock = deterministicClock(100, (_now, waitCount) => {
      if (waitCount === 2) setJobState(job!.id, 'completed_structural');
    });

    const result = await waitForNextTurnMemoryConsistency({
      memoryConversationId: 'shared-memory',
      sourceThreadId: 'thread-pending',
      sourceEndMessageId: 'assistant-pending',
      clock,
    });

    expect(result).toMatchObject({
      outcome: 'completed',
      waitedMs: 24,
      queryCount: 3,
      initialJobStatus: 'pending',
      finalJobStatus: 'completed_structural',
    });
  });

  it('does not wait for a future retry', async () => {
    const job = enqueueSourceTurn('thread-retry', 'assistant-retry');
    setJobState(job!.id, 'retrying', { nextAttemptAt: 500 });

    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-retry',
        sourceEndMessageId: 'assistant-retry',
        clock: deterministicClock(),
      }),
    ).resolves.toMatchObject({
      outcome: 'degraded',
      durationMs: 0,
      waitedMs: 0,
      queryCount: 1,
      initialJobStatus: 'retrying',
      finalJobStatus: 'retrying',
    });
  });

  it('returns a hard timeout within the declared wait budget', async () => {
    enqueueSourceTurn('thread-timeout', 'assistant-timeout');
    const delays: number[] = [];

    const result = await waitForNextTurnMemoryConsistency({
      memoryConversationId: 'shared-memory',
      sourceThreadId: 'thread-timeout',
      sourceEndMessageId: 'assistant-timeout',
      clock: deterministicClock(100, (_now, _waitCount, delayMs) => delays.push(delayMs)),
    });
    expect(delays).toEqual([8, 16, 32, 32, 32]);

    expect(result).toMatchObject({
      outcome: 'timed_out',
      durationMs: 120,
      waitedMs: 120,
      queryCount: 6,
      initialJobStatus: 'pending',
      finalJobStatus: 'pending',
    });
    expect(result.waitedMs).toBeLessThanOrEqual(NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS);
    expect(result.queryCount).toBeLessThanOrEqual(6);
  });

  it('keeps the p95 wait at or below the configured mobile budget', async () => {
    enqueueSourceTurn('thread-p95', 'assistant-p95');
    const waits: number[] = [];
    for (let run = 0; run < 20; run += 1) {
      const result = await waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-p95',
        sourceEndMessageId: 'assistant-p95',
        clock: deterministicClock(),
      });
      waits.push(result.waitedMs);
    }
    waits.sort((left, right) => left - right);
    const p95 = waits[Math.ceil(waits.length * 0.95) - 1]!;
    expect(p95).toBeLessThanOrEqual(NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS);
  });

  it('avoids the durable database entirely when memory is opted out', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const query = jest.spyOn(ingestionQueueStore, 'getIngestionJobForSourceTurn');

    const result = await waitForNextTurnMemoryConsistency({
      memoryConversationId: 'shared-memory',
      sourceThreadId: 'thread-opt-out',
      sourceEndMessageId: 'assistant-opt-out',
      clock: deterministicClock(),
    });

    expect(result).toMatchObject({
      outcome: 'opt_out',
      durationMs: 0,
      waitedMs: 0,
      queryCount: 0,
      matchedJobCount: 0,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns opt_out without another durable read when the user disables memory during a wait', async () => {
    const job = enqueueSourceTurn('thread-racing-opt-out', 'assistant-racing-opt-out');
    setJobState(job!.id, 'processing', { leaseExpiresAt: 1_000 });
    const durableRead = jest.spyOn(ingestionQueueStore, 'getIngestionJobForSourceTurn');
    const clock = deterministicClock(100, () => {
      useSettingsStore.setState({ disableLongTermMemory: true } as never);
    });

    const result = await waitForNextTurnMemoryConsistency({
      memoryConversationId: 'shared-memory',
      sourceThreadId: 'thread-racing-opt-out',
      sourceEndMessageId: 'assistant-racing-opt-out',
      clock,
    });

    expect(result).toMatchObject({
      outcome: 'opt_out',
      waitedMs: 8,
      queryCount: 1,
      matchedJobCount: 1,
      initialJobStatus: 'processing',
      finalJobStatus: 'processing',
    });
    expect(durableRead).toHaveBeenCalledTimes(1);
  });

  it('degrades without throwing when the exact durable query is unavailable', async () => {
    jest.spyOn(ingestionQueueStore, 'getIngestionJobForSourceTurn').mockImplementation(() => {
      throw new Error('database unavailable');
    });

    await expect(
      waitForNextTurnMemoryConsistency({
        memoryConversationId: 'shared-memory',
        sourceThreadId: 'thread-db-error',
        sourceEndMessageId: 'assistant-db-error',
        clock: deterministicClock(),
      }),
    ).resolves.toMatchObject({
      outcome: 'degraded',
      durationMs: 0,
      waitedMs: 0,
      queryCount: 1,
      matchedJobCount: 0,
      initialJobStatus: null,
      finalJobStatus: null,
    });
  });
});
