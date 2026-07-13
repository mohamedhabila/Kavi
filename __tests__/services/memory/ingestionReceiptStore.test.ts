jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  commitIngestionPersistenceReceipt,
  getIngestionPersistenceReceipt,
  IngestionReceiptCommitError,
  listIngestionPersistenceReceipts,
  type CommitIngestionPersistenceReceiptInput,
} from '../../../src/services/memory/ingestionReceiptStore';
import {
  claimIngestionJob,
  discardIngestionJob,
  discardPendingIngestionJobs,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  INGESTION_RETRY_BASE_DELAY_MS,
  retryOrCompleteIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function claimedJob(suffix: string, now = 100): { jobId: string; claimToken: string } {
  const job = enqueueIngestionJob({
    personaId: 'default',
    threadId: `conversation-${suffix}`,
    threadTitle: null,
    memoryConversationId: `conversation-${suffix}`,
    taskId: null,
    sourceStartMessageId: `user-${suffix}`,
    sourceEndMessageId: `assistant-${suffix}`,
    sourceRunId: null,
    sourceAt: now,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now,
  });
  const claimToken = claimIngestionJob(job!.id, now);
  expect(claimToken).toBeTruthy();
  return { jobId: job!.id, claimToken: claimToken! };
}

function receiptInput(
  jobId: string,
  claimToken: string,
  overrides: Partial<CommitIngestionPersistenceReceiptInput> = {},
): CommitIngestionPersistenceReceiptInput {
  return {
    jobId,
    claimToken,
    episodeId: 'episode-1',
    deterministicFactIds: ['fact-deterministic-1'],
    providerFactIds: [],
    invalidatedFactIds: ['fact-invalidated-1'],
    bridgedEvidenceFactIds: ['fact-bridged-1'],
    agentRunMemoryFactIds: ['fact-agent-run-1'],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    providerOutcome: 'structural_only',
    providerOutcomeCode: null,
    persistedAt: 101,
    ...overrides,
  };
}

describe('memory ingestion persistence receipts', () => {
  it('stores the exact structured write set and completes the owned claim atomically', () => {
    const { jobId, claimToken } = claimedJob('exact');

    const receipt = commitIngestionPersistenceReceipt(receiptInput(jobId, claimToken));

    expect(receipt).toEqual({
      jobId,
      attemptNumber: 1,
      episodeId: 'episode-1',
      deterministicFactIds: ['fact-deterministic-1'],
      providerFactIds: [],
      invalidatedFactIds: ['fact-invalidated-1'],
      bridgedEvidenceFactIds: ['fact-bridged-1'],
      agentRunMemoryFactIds: ['fact-agent-run-1'],
      activeFocusUpdated: true,
      openThreadsUpdated: false,
      providerOutcome: 'structural_only',
      providerOutcomeCode: null,
      persistedAt: 101,
    });
    expect(getIngestionPersistenceReceipt(jobId, 1)).toEqual(receipt);
    expect(getIngestionJob(jobId)).toEqual(
      expect.objectContaining({
        status: 'completed_structural',
        providerOutcome: 'structural_only',
        structuralCompletedAt: 101,
        completedAt: 101,
      }),
    );
  });

  it('rejects stale claim owners without creating a receipt', () => {
    const { jobId } = claimedJob('claim-owner');

    expect(() =>
      commitIngestionPersistenceReceipt(receiptInput(jobId, 'wrong-claim-token')),
    ).toThrow(
      expect.objectContaining<Partial<IngestionReceiptCommitError>>({ code: 'claim_lost' }),
    );
    expect(listIngestionPersistenceReceipts(jobId)).toEqual([]);
    expect(getIngestionJob(jobId)?.status).toBe('processing');
  });

  it('rolls the receipt back when the queue transition aborts', () => {
    const { jobId, claimToken } = claimedJob('rollback');
    getMemoryDb().execSync(`
      CREATE TRIGGER reject_receipt_transition
      BEFORE UPDATE OF structural_completed_at ON memory_ingestion_jobs
      WHEN OLD.id = '${jobId}'
      BEGIN
        SELECT RAISE(ABORT, 'forced transition failure');
      END;
    `);

    expect(() =>
      commitIngestionPersistenceReceipt(
        receiptInput(jobId, claimToken, {
          providerOutcome: 'provider_error',
          providerOutcomeCode: 'provider_request_failed',
        }),
      ),
    ).toThrow('forced transition failure');
    expect(listIngestionPersistenceReceipts(jobId)).toEqual([]);
    expect(getIngestionJob(jobId)).toEqual(
      expect.objectContaining({ status: 'processing', structuralCompletedAt: null }),
    );
  });

  it('uses stable per-attempt identity across retries and rejects conflicting rewrites', () => {
    const { jobId, claimToken } = claimedJob('retry');
    const firstInput = receiptInput(jobId, claimToken, {
      providerOutcome: 'provider_error',
      providerOutcomeCode: 'provider_request_failed',
    });

    const first = commitIngestionPersistenceReceipt(firstInput);
    expect(commitIngestionPersistenceReceipt(firstInput)).toEqual(first);
    expect(listIngestionPersistenceReceipts(jobId)).toHaveLength(1);
    expect(() =>
      commitIngestionPersistenceReceipt({ ...firstInput, episodeId: 'different-episode' }),
    ).toThrow(
      expect.objectContaining<Partial<IngestionReceiptCommitError>>({
        code: 'identity_conflict',
      }),
    );

    const retry = retryOrCompleteIngestionJob({
      jobId,
      providerOutcome: 'provider_error',
      outcomeCode: 'provider_request_failed',
      now: 101,
      claimToken,
    });
    expect(retry).toEqual({ status: 'retrying', applied: true });
    const retryAt = 101 + INGESTION_RETRY_BASE_DELAY_MS;
    const secondClaim = claimIngestionJob(jobId, retryAt)!;
    const second = commitIngestionPersistenceReceipt(
      receiptInput(jobId, secondClaim, {
        deterministicFactIds: [],
        providerFactIds: ['fact-provider-2'],
        invalidatedFactIds: [],
        bridgedEvidenceFactIds: [],
        agentRunMemoryFactIds: [],
        activeFocusUpdated: false,
        providerOutcome: 'valid',
        providerOutcomeCode: null,
        persistedAt: retryAt + 1,
      }),
    );

    expect(second.attemptNumber).toBe(2);
    expect(listIngestionPersistenceReceipts(jobId)).toEqual([first, second]);
    expect(getIngestionJob(jobId)).toEqual(
      expect.objectContaining({ status: 'completed_enriched', attemptCount: 2 }),
    );
  });

  it('removes receipts with discarded jobs and full structured-memory cleanup', () => {
    const first = claimedJob('discard-one');
    commitIngestionPersistenceReceipt(
      receiptInput(first.jobId, first.claimToken, {
        providerOutcome: 'malformed',
        providerOutcomeCode: 'invalid_json',
      }),
    );
    retryOrCompleteIngestionJob({
      jobId: first.jobId,
      providerOutcome: 'malformed',
      outcomeCode: 'invalid_json',
      now: 101,
      claimToken: first.claimToken,
    });
    expect(discardIngestionJob(first.jobId)).toBe(true);
    expect(listIngestionPersistenceReceipts(first.jobId)).toEqual([]);

    const second = claimedJob('discard-all');
    commitIngestionPersistenceReceipt(
      receiptInput(second.jobId, second.claimToken, {
        providerOutcome: 'schema_invalid',
        providerOutcomeCode: 'missing_required_field',
      }),
    );
    retryOrCompleteIngestionJob({
      jobId: second.jobId,
      providerOutcome: 'schema_invalid',
      outcomeCode: 'missing_required_field',
      now: 101,
      claimToken: second.claimToken,
    });
    expect(discardPendingIngestionJobs()).toBe(1);
    expect(listIngestionPersistenceReceipts(second.jobId)).toEqual([]);

    const terminal = claimedJob('clear-all');
    commitIngestionPersistenceReceipt(receiptInput(terminal.jobId, terminal.claimToken));
    expect(listIngestionPersistenceReceipts(terminal.jobId)).toHaveLength(1);
    clearStructuredMemory();
    expect(listIngestionPersistenceReceipts(terminal.jobId)).toEqual([]);
  });
});
