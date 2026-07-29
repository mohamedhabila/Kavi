jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  beginActiveIngestionAttempt,
  finishActiveIngestionAttempt,
} from '../../../src/services/memory/ingestionAttemptPreemption';
import { preemptIngestionJobAndWait } from '../../../src/services/memory/ingestionJobPreemption';
import {
  claimIngestionJob,
  completeIngestionJob,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  retryOrCompleteIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import { closeMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);
const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
type ActiveAttempt = ReturnType<typeof beginActiveIngestionAttempt>;

let testAttempt: ActiveAttempt | null = null;

function enqueueJob(suffix: string) {
  return enqueueIngestionJob({
    personaId: 'default',
    threadId: `thread-${suffix}`,
    threadTitle: null,
    memoryConversationId: `memory-${suffix}`,
    taskId: null,
    sourceStartMessageId: `user-${suffix}`,
    sourceEndMessageId: `assistant-${suffix}`,
    sourceRunId: null,
    sourceAt: 100,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 100,
  })!;
}

function beginTestAttempt(jobId: string): ActiveAttempt {
  testAttempt = beginActiveIngestionAttempt(jobId);
  return testAttempt;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  testAttempt = null;
});

afterEach(() => {
  if (testAttempt) finishActiveIngestionAttempt(testAttempt);
  testAttempt = null;
  closeMemoryDb();
  jest.useRealTimers();
});

describe('exact ingestion job preemption', () => {
  it('discards only the requested queue-only job and is explicit on repetition', async () => {
    const target = enqueueJob('queued-target');
    const sibling = enqueueJob('queued-sibling');

    await expect(preemptIngestionJobAndWait({ jobId: target.id })).resolves.toEqual({
      status: 'discarded',
      previousStatus: 'pending',
    });
    expect(getIngestionJob(target.id)).toBeNull();
    expect(getIngestionJob(sibling.id)).toEqual(expect.objectContaining({ status: 'pending' }));
    await expect(preemptIngestionJobAndWait({ jobId: target.id })).resolves.toEqual({
      status: 'missing',
    });
  });

  it('aborts, revokes, and waits for the exact claimed local owner', async () => {
    const target = enqueueJob('claimed-target');
    expect(claimIngestionJob(target.id, 100)).not.toBeNull();
    const attempt = beginTestAttempt(target.id);
    let settled = false;

    const result = preemptIngestionJobAndWait({ jobId: target.id, timeoutMs: 100 });
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(attempt.controller.signal.aborted).toBe(true);
    expect(getIngestionJob(target.id)).toBeNull();
    expect(settled).toBe(false);

    finishActiveIngestionAttempt(attempt);
    await expect(result).resolves.toEqual({
      status: 'preempted',
      previousStatus: 'processing',
    });
  });

  it('reports an unobserved owner after revoking a claim without a local attempt', async () => {
    const target = enqueueJob('unobserved-owner');
    expect(claimIngestionJob(target.id, 100)).not.toBeNull();

    await expect(preemptIngestionJobAndWait({ jobId: target.id })).resolves.toEqual({
      status: 'ownership_release_unobserved',
      previousStatus: 'processing',
    });
    expect(getIngestionJob(target.id)).toBeNull();
  });

  it('bounds the owner wait without touching or falsely releasing an unrelated claim', async () => {
    jest.useFakeTimers();
    const target = enqueueJob('timeout-target');
    const sibling = enqueueJob('timeout-sibling');
    expect(claimIngestionJob(target.id, 100)).not.toBeNull();
    const siblingClaim = claimIngestionJob(sibling.id, 100);
    expect(siblingClaim).not.toBeNull();
    const attempt = beginTestAttempt(target.id);

    const result = preemptIngestionJobAndWait({ jobId: target.id, timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({
      status: 'ownership_release_timed_out',
      previousStatus: 'processing',
    });
    expect(attempt.controller.signal.aborted).toBe(true);
    expect(getIngestionJob(target.id)).toBeNull();
    expect(getIngestionJob(sibling.id)).toEqual(
      expect.objectContaining({ status: 'processing', claimToken: siblingClaim }),
    );

    finishActiveIngestionAttempt(attempt);
  });

  it('can resume waiting for the exact live owner after a timed-out revocation', async () => {
    jest.useFakeTimers();
    const target = enqueueJob('timeout-retry');
    expect(claimIngestionJob(target.id, 100)).not.toBeNull();
    const attempt = beginTestAttempt(target.id);

    const first = preemptIngestionJobAndWait({ jobId: target.id, timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);
    await expect(first).resolves.toEqual({
      status: 'ownership_release_timed_out',
      previousStatus: 'processing',
    });
    expect(getIngestionJob(target.id)).toBeNull();

    let retrySettled = false;
    const retry = preemptIngestionJobAndWait({ jobId: target.id, timeoutMs: 100 });
    void retry.then(() => {
      retrySettled = true;
    });
    await Promise.resolve();
    expect(retrySettled).toBe(false);

    finishActiveIngestionAttempt(attempt);
    await expect(retry).resolves.toEqual({
      status: 'preempted',
      previousStatus: 'missing',
    });
  });

  it('does not abort an unrelated active claimed job while discarding the target', async () => {
    const active = enqueueJob('active-sibling');
    const target = enqueueJob('unrelated-target');
    const activeClaim = claimIngestionJob(active.id, 100);
    expect(activeClaim).not.toBeNull();
    const attempt = beginTestAttempt(active.id);

    await expect(preemptIngestionJobAndWait({ jobId: target.id })).resolves.toEqual({
      status: 'discarded',
      previousStatus: 'pending',
    });

    expect(attempt.controller.signal.aborted).toBe(false);
    expect(getIngestionJob(active.id)).toEqual(
      expect.objectContaining({ status: 'processing', claimToken: activeClaim }),
    );
    expect(getIngestionJob(target.id)).toBeNull();
    finishActiveIngestionAttempt(attempt);
  });

  it('leaves terminal jobs intact and distinguishes invalid and absent identities', async () => {
    const terminal = enqueueJob('terminal');
    const claimToken = claimIngestionJob(terminal.id, 100)!;
    expect(
      completeIngestionJob(terminal.id, 'completed_structural', 'structural_only', 101, claimToken),
    ).toBe(true);

    await expect(preemptIngestionJobAndWait({ jobId: terminal.id })).resolves.toEqual({
      status: 'terminal',
      jobStatus: 'completed_structural',
    });
    expect(getIngestionJob(terminal.id)).toEqual(
      expect.objectContaining({ status: 'completed_structural' }),
    );
    await expect(preemptIngestionJobAndWait({ jobId: 'does-not-exist' })).resolves.toEqual({
      status: 'missing',
    });
    await expect(preemptIngestionJobAndWait({ jobId: ' invalid ' })).resolves.toEqual({
      status: 'invalid_job_id',
    });
  });

  it('accepts only a finite bounded positive integer wait budget', async () => {
    const job = enqueueJob('wait-budget');

    await expect(preemptIngestionJobAndWait({ jobId: job.id, timeoutMs: 0 })).rejects.toThrow(
      'memory_ingestion_preemption_wait_invalid',
    );
    await expect(
      preemptIngestionJobAndWait({ jobId: job.id, timeoutMs: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow('memory_ingestion_preemption_wait_invalid');
    await expect(preemptIngestionJobAndWait({ jobId: job.id, timeoutMs: 1.5 })).rejects.toThrow(
      'memory_ingestion_preemption_wait_invalid',
    );
    await expect(preemptIngestionJobAndWait({ jobId: job.id, timeoutMs: 30_001 })).rejects.toThrow(
      'memory_ingestion_preemption_wait_invalid',
    );
    expect(getIngestionJob(job.id)).toEqual(expect.objectContaining({ status: 'pending' }));
  });

  it('discards a retrying job without disturbing its sibling', async () => {
    const target = enqueueJob('retrying-target');
    const sibling = enqueueJob('retrying-sibling');
    const claimToken = claimIngestionJob(target.id, 100)!;
    expect(
      retryOrCompleteIngestionJob({
        jobId: target.id,
        providerOutcome: 'provider_error',
        outcomeCode: 'provider_request_failed',
        now: 101,
        claimToken,
      }),
    ).toEqual({ status: 'retrying', applied: true });

    await expect(preemptIngestionJobAndWait({ jobId: target.id })).resolves.toEqual({
      status: 'discarded',
      previousStatus: 'retrying',
    });
    expect(getIngestionJob(target.id)).toBeNull();
    expect(getIngestionJob(sibling.id)).toEqual(expect.objectContaining({ status: 'pending' }));
  });
});
