jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import type { SemanticMemoryHandoff } from '../../../src/types/conversation';
import {
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import * as ingestionQueueStore from '../../../src/services/memory/ingestionQueueStore';
import {
  waitForSemanticMemoryHandoff,
  type SemanticMemoryHandoffClock,
} from '../../../src/services/memory/semanticMemoryHandoffConsistency';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import { getRuntimeProcessEpoch } from '../../../src/services/runtimeProcessEpoch';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const HANDOFF: SemanticMemoryHandoff = {
  version: 1,
  memoryConversationId: 'source-conversation',
  sourceThreadId: 'source-conversation',
  sourceEndMessageId: 'assistant-source',
};

function deterministicClock(
  onWait?: (now: number, waitCount: number) => void,
): SemanticMemoryHandoffClock {
  let now = 100;
  let waitCount = 0;
  return {
    now: () => now,
    wait: async (delayMs) => {
      now += delayMs;
      waitCount += 1;
      onWait?.(now, waitCount);
    },
  };
}

function enqueueSource(providerEnrichment = true) {
  return enqueueIngestionJob({
    personaId: 'default',
    threadId: HANDOFF.sourceThreadId,
    threadTitle: null,
    memoryConversationId: HANDOFF.memoryConversationId,
    taskId: null,
    sourceStartMessageId: 'user-source',
    sourceEndMessageId: HANDOFF.sourceEndMessageId,
    sourceRunId: null,
    sourceAt: 100,
    chatProviderId: providerEnrichment ? 'provider' : null,
    chatModel: providerEnrichment ? 'model' : null,
    reason: 'turn_completed',
    providerEnrichment,
    now: 100,
  })!;
}

function setStatus(
  jobId: string,
  status:
    | 'processing'
    | 'retrying'
    | 'degraded'
    | 'completed_structural'
    | 'completed_enriched'
    | 'failed',
  structuralCompletedAt: number | null,
): void {
  const terminal = ['degraded', 'completed_structural', 'completed_enriched', 'failed'].includes(
    status,
  );
  getMemoryDb().runSync(
    `UPDATE memory_ingestion_jobs
        SET status = ?,
            structural_completed_at = ?,
            provider_outcome = ?,
            outcome_code = ?,
            next_attempt_at = ?,
            lease_expires_at = ?,
            claim_token = ?,
            claim_process_epoch = ?,
            completed_at = ?,
            updated_at = 100
      WHERE id = ?`,
    status,
    structuralCompletedAt,
    status === 'completed_enriched'
      ? 'valid'
      : status === 'completed_structural'
        ? 'structural_only'
        : null,
    status === 'degraded' || status === 'failed' ? 'processing_error' : null,
    status === 'retrying' ? 100 : null,
    status === 'processing' ? 1_000 : null,
    status === 'processing' ? `claim-${jobId}` : null,
    status === 'processing' ? getRuntimeProcessEpoch() : null,
    terminal ? 100 : null,
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

describe('semantic memory handoff consistency', () => {
  it('does not accept a structural checkpoint before provider enrichment finishes', async () => {
    const job = enqueueSource();
    setStatus(job.id, 'processing', 100);
    const clock = deterministicClock((_now, waitCount) => {
      if (waitCount === 2) setStatus(job.id, 'completed_enriched', 100);
    });

    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock, budgetMs: 100 }),
    ).resolves.toEqual({
      outcome: 'ready',
      durationMs: 30,
      waitedMs: 30,
      queryCount: 3,
      matchedJobCount: 1,
      initialJobStatus: 'processing',
      finalJobStatus: 'completed_enriched',
      unavailableReason: null,
    });
  });

  it('treats deliberate structural-only completion as semantically unavailable', async () => {
    const job = enqueueSource(false);
    setStatus(job.id, 'completed_structural', 100);

    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock: deterministicClock() }),
    ).resolves.toMatchObject({
      outcome: 'unavailable',
      waitedMs: 0,
      matchedJobCount: 1,
      initialJobStatus: 'completed_structural',
      finalJobStatus: 'completed_structural',
      unavailableReason: 'terminal_job',
    });
  });

  it.each(['degraded', 'failed'] as const)(
    'fails closed when exact semantic ingestion is %s',
    async (status) => {
      const job = enqueueSource();
      setStatus(job.id, status, status === 'degraded' ? 100 : null);

      await expect(
        waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock: deterministicClock() }),
      ).resolves.toMatchObject({
        outcome: 'unavailable',
        finalJobStatus: status,
        unavailableReason: 'terminal_job',
      });
    },
  );

  it('waits through the bounded enqueue grace and ignores unrelated completed work', async () => {
    const unrelated = enqueueIngestionJob({
      personaId: 'default',
      threadId: 'unrelated-thread',
      threadTitle: null,
      memoryConversationId: 'unrelated-conversation',
      taskId: null,
      sourceStartMessageId: 'unrelated-user',
      sourceEndMessageId: 'unrelated-assistant',
      sourceRunId: null,
      sourceAt: 100,
      chatProviderId: 'provider',
      chatModel: 'model',
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 100,
    })!;
    setStatus(unrelated.id, 'completed_enriched', 100);

    await expect(
      waitForSemanticMemoryHandoff({
        handoff: HANDOFF,
        clock: deterministicClock(),
        budgetMs: 100,
        enqueueGraceMs: 50,
      }),
    ).resolves.toMatchObject({
      outcome: 'unavailable',
      waitedMs: 50,
      queryCount: 4,
      matchedJobCount: 0,
      unavailableReason: 'missing_job',
    });
  });

  it('observes an exact job created during enqueue grace', async () => {
    let jobId: string | null = null;
    const clock = deterministicClock((_now, waitCount) => {
      if (waitCount === 1) jobId = enqueueSource().id;
      if (waitCount === 2 && jobId) setStatus(jobId, 'completed_enriched', 100);
    });

    await expect(
      waitForSemanticMemoryHandoff({
        handoff: HANDOFF,
        clock,
        budgetMs: 100,
        enqueueGraceMs: 50,
      }),
    ).resolves.toMatchObject({
      outcome: 'ready',
      waitedMs: 30,
      matchedJobCount: 1,
      initialJobStatus: 'pending',
      finalJobStatus: 'completed_enriched',
    });
    expect(jobId && getIngestionJob(jobId)?.status).toBe('completed_enriched');
  });

  it('returns a bounded timeout while an exact semantic job remains pending', async () => {
    enqueueSource();

    await expect(
      waitForSemanticMemoryHandoff({
        handoff: HANDOFF,
        clock: deterministicClock(),
        budgetMs: 40,
      }),
    ).resolves.toMatchObject({
      outcome: 'timed_out',
      waitedMs: 40,
      matchedJobCount: 1,
      finalJobStatus: 'pending',
    });
  });

  it('uses elapsed wall time when a mobile timer resumes after the deadline', async () => {
    enqueueSource();
    let now = 100;
    const suspendedClock: SemanticMemoryHandoffClock = {
      now: () => now,
      wait: async (delayMs) => {
        now += delayMs + 60_000;
      },
    };

    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock: suspendedClock, budgetMs: 40 }),
    ).resolves.toMatchObject({
      outcome: 'timed_out',
      durationMs: 60_010,
      waitedMs: 10,
      finalJobStatus: 'pending',
    });
  });

  it('fails closed when memory is disabled and re-enabled during the wait', async () => {
    enqueueSource();
    const clock = deterministicClock((_now, waitCount) => {
      if (waitCount !== 1) return;
      useSettingsStore.setState({ disableLongTermMemory: true } as never);
      useSettingsStore.setState({ disableLongTermMemory: false } as never);
    });

    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock, budgetMs: 40 }),
    ).resolves.toMatchObject({
      outcome: 'unavailable',
      unavailableReason: 'policy_changed',
      waitedMs: 10,
    });
  });

  it('distinguishes a durable read failure from a consumable missing job', async () => {
    jest.spyOn(ingestionQueueStore, 'getIngestionJobForSourceTurn').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });

    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock: deterministicClock() }),
    ).resolves.toMatchObject({
      outcome: 'unavailable',
      queryCount: 1,
      matchedJobCount: 0,
      unavailableReason: 'durable_read_failed',
    });
  });

  it('honors opt-out and cancellation before reading durable state', async () => {
    const read = jest.spyOn(ingestionQueueStore, 'getIngestionJobForSourceTurn');
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    await expect(
      waitForSemanticMemoryHandoff({ handoff: HANDOFF, clock: deterministicClock() }),
    ).resolves.toMatchObject({ outcome: 'opt_out', queryCount: 0 });

    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForSemanticMemoryHandoff({
        handoff: HANDOFF,
        clock: deterministicClock(),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ outcome: 'cancelled', queryCount: 0 });
    expect(read).not.toHaveBeenCalled();
  });
});
