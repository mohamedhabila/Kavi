jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  encodeIngestionSourceSnapshot,
  type EncodedIngestionSourceSnapshot,
} from '../../../src/services/memory/ingestionSourceSnapshot';
import {
  claimIngestionJob,
  completeIngestionJob,
  discardIngestionJob,
  discardPendingIngestionJobs,
  enqueueIngestionJob,
  getIngestionJob,
  getIngestionJobForSourceTurn,
  listPendingIngestionJobs,
  markIngestionJobStructuralComplete,
  retryOrCompleteIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import { __resetIngestionQueueForTests } from '../../../src/services/memory/ingestionQueue';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { ingestionSourceSnapshotFixture } from '../../helpers/ingestionSourceSnapshotFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function enqueueInput(suffix: string) {
  const sourceStartMessageId = `user-${suffix}`;
  const sourceEndMessageId = `assistant-${suffix}`;
  return {
    personaId: 'default',
    threadId: `conversation-${suffix}`,
    threadTitle: null,
    memoryConversationId: `conversation-${suffix}`,
    taskId: null,
    priorUserMessageId: null,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceSnapshot: ingestionSourceSnapshotFixture({
      sourceStartMessageId,
      sourceEndMessageId,
      priorUserMessageId: null,
    }),
    sourceRunId: null,
    sourceAt: 10,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed' as const,
    providerEnrichment: true,
    now: 10,
  };
}

function snapshotWithResponse(suffix: string, response: string): EncodedIngestionSourceSnapshot {
  const sourceStartMessageId = `user-${suffix}`;
  const sourceEndMessageId = `assistant-${suffix}`;
  return encodeIngestionSourceSnapshot({
    sourceStartMessageId,
    sourceEndMessageId,
    priorUserMessageId: null,
    messages: [
      {
        id: sourceStartMessageId,
        role: 'user',
        content: 'Deterministic test request.',
        timestamp: 1,
      },
      {
        id: sourceEndMessageId,
        role: 'assistant',
        content: response,
        timestamp: 2,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      },
    ],
  });
}

function tableCount(table: 'memory_ingestion_jobs' | 'memory_ingestion_source_snapshots'): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

function snapshotCount(jobId: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_ingestion_source_snapshots WHERE job_id = ?',
      jobId,
    )?.count ?? 0
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  initializeMemoryPolicyObservation();
});

afterEach(() => {
  __resetIngestionQueueForTests();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
});

describe('ingestion source snapshot store', () => {
  it('rolls back the queue row when durable snapshot persistence fails', () => {
    getMemoryDb().execSync(`
      CREATE TRIGGER test_reject_ingestion_snapshot
      BEFORE INSERT ON memory_ingestion_source_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'test_snapshot_insert_failed');
      END;
    `);

    expect(() => enqueueIngestionJob(enqueueInput('atomic'))).toThrow(
      'test_snapshot_insert_failed',
    );
    expect(tableCount('memory_ingestion_jobs')).toBe(0);
    expect(tableCount('memory_ingestion_source_snapshots')).toBe(0);
  });

  it('deduplicates the exact snapshot and rejects a different digest for the same source', () => {
    const input = enqueueInput('duplicate');
    const first = enqueueIngestionJob(input)!;
    const replay = enqueueIngestionJob(input)!;

    expect(replay.id).toBe(first.id);
    expect(tableCount('memory_ingestion_jobs')).toBe(1);
    expect(snapshotCount(first.id)).toBe(1);
    expect(() =>
      enqueueIngestionJob({
        ...input,
        sourceSnapshot: snapshotWithResponse('duplicate', 'Different durable response.'),
      }),
    ).toThrow('memory_ingestion_source_snapshot_conflict');
    expect(tableCount('memory_ingestion_jobs')).toBe(1);
    expect(snapshotCount(first.id)).toBe(1);
  });

  it('keeps a duplicate enqueue fail-close durable when the persisted payload is missing', () => {
    const input = enqueueInput('duplicate-missing');
    const job = enqueueIngestionJob(input)!;
    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_source_snapshot_active_delete');
    getMemoryDb().runSync('DELETE FROM memory_ingestion_source_snapshots WHERE job_id = ?', job.id);

    expect(() => enqueueIngestionJob(input)).toThrow('memory_ingestion_source_snapshot_missing');
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_snapshot_missing',
    });
    expect(snapshotCount(job.id)).toBe(0);
  });

  it('rejects raw snapshot rows without an active parent job', () => {
    const input = enqueueInput('parent-required');
    expect(() =>
      getMemoryDb().runSync(
        `INSERT INTO memory_ingestion_source_snapshots(job_id, payload_json, created_at)
         VALUES (?, ?, ?)`,
        'orphan-job',
        input.sourceSnapshot.payloadJson,
        10,
      ),
    ).toThrow('memory_ingestion_source_snapshot_parent_invalid');

    const job = enqueueIngestionJob(input)!;
    const claimToken = claimIngestionJob(job.id, 20)!;
    expect(
      completeIngestionJob(job.id, 'completed_structural', 'structural_only', 21, claimToken),
    ).toBe(true);
    expect(() =>
      getMemoryDb().runSync(
        `INSERT INTO memory_ingestion_source_snapshots(job_id, payload_json, created_at)
         VALUES (?, ?, ?)`,
        job.id,
        input.sourceSnapshot.payloadJson,
        22,
      ),
    ).toThrow('memory_ingestion_source_snapshot_parent_invalid');
  });

  it('fails an active job closed when its persisted payload is corrupted', () => {
    const job = enqueueIngestionJob(enqueueInput('corrupt'))!;
    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_source_snapshot_immutable');
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_source_snapshots SET payload_json = ? WHERE job_id = ?',
      '{"corrupt":true}',
      job.id,
    );

    expect(claimIngestionJob(job.id, 5)).toBeNull();
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_snapshot_invalid',
    });
    expect(snapshotCount(job.id)).toBe(0);
  });

  it('fails an active job closed when its persisted payload is missing', () => {
    const job = enqueueIngestionJob(enqueueInput('missing'))!;
    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_source_snapshot_active_delete');
    getMemoryDb().runSync('DELETE FROM memory_ingestion_source_snapshots WHERE job_id = ?', job.id);

    expect(claimIngestionJob(job.id, 20)).toBeNull();
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_snapshot_missing',
    });
  });

  it('keeps pending enumeration metadata-only and terminalizes a missing payload at claim', () => {
    const job = enqueueIngestionJob(enqueueInput('list-missing'))!;
    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_source_snapshot_active_delete');
    getMemoryDb().runSync('DELETE FROM memory_ingestion_source_snapshots WHERE job_id = ?', job.id);

    expect(listPendingIngestionJobs(10, 20)).toEqual([expect.objectContaining({ id: job.id })]);
    expect(claimIngestionJob(job.id, 20)).toBeNull();
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'failed',
      outcomeCode: 'source_snapshot_missing',
    });
  });

  it('terminalizes a corrupt payload discovered by exact source lookup', () => {
    const input = enqueueInput('source-corrupt');
    const job = enqueueIngestionJob(input)!;
    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_source_snapshot_immutable');
    getMemoryDb().runSync(
      'UPDATE memory_ingestion_source_snapshots SET payload_json = ? WHERE job_id = ?',
      '{"corrupt":true}',
      job.id,
    );

    expect(
      getIngestionJobForSourceTurn({
        memoryConversationId: input.memoryConversationId,
        sourceThreadId: input.threadId,
        sourceEndMessageId: input.sourceEndMessageId,
      }),
    ).toMatchObject({ status: 'failed', outcomeCode: 'source_snapshot_invalid' });
    expect(snapshotCount(job.id)).toBe(0);
  });

  it('keeps active payloads and their sealed metadata immutable', () => {
    const job = enqueueIngestionJob(enqueueInput('immutable'))!;
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_source_snapshots SET payload_json = ? WHERE job_id = ?',
        '{}',
        job.id,
      ),
    ).toThrow('memory_ingestion_source_snapshot_immutable');
    expect(() =>
      getMemoryDb().runSync(
        'DELETE FROM memory_ingestion_source_snapshots WHERE job_id = ?',
        job.id,
      ),
    ).toThrow('memory_ingestion_source_snapshot_immutable');
    expect(() =>
      getMemoryDb().runSync(
        'UPDATE memory_ingestion_jobs SET source_snapshot_sha256 = ? WHERE id = ?',
        'f'.repeat(64),
        job.id,
      ),
    ).toThrow('memory_ingestion_source_snapshot_immutable');
    expect(snapshotCount(job.id)).toBe(1);
  });

  it('deletes payload content when a job reaches a successful terminal state', () => {
    const job = enqueueIngestionJob(enqueueInput('terminal'))!;
    const claimToken = claimIngestionJob(job.id, 20)!;

    expect(
      completeIngestionJob(job.id, 'completed_structural', 'structural_only', 21, claimToken),
    ).toBe(true);
    expect(getIngestionJob(job.id)).toMatchObject({
      status: 'completed_structural',
      sourceSnapshotVersion: 1,
      sourceSnapshotSha256: job.sourceSnapshotSha256,
      sourceSnapshotByteLength: job.sourceSnapshotByteLength,
    });
    expect(snapshotCount(job.id)).toBe(0);
  });

  it.each(['failed', 'degraded', 'completed_structural', 'completed_enriched'] as const)(
    'cleans payload content for the %s terminal state while retaining metadata',
    (status) => {
      const job = enqueueIngestionJob(enqueueInput(`terminal-${status}`))!;
      if (status === 'failed' || status === 'degraded') {
        getMemoryDb().runSync(
          'UPDATE memory_ingestion_jobs SET attempt_count = 4 WHERE id = ?',
          job.id,
        );
      }
      const claimToken = claimIngestionJob(job.id, 20)!;
      if (status === 'degraded') {
        expect(markIngestionJobStructuralComplete(job.id, 21, claimToken)).toBe(true);
        expect(
          retryOrCompleteIngestionJob({
            jobId: job.id,
            providerOutcome: 'provider_error',
            outcomeCode: 'provider_request_failed',
            now: 22,
            claimToken,
          }),
        ).toMatchObject({ applied: true, status });
      } else if (status === 'failed') {
        expect(
          retryOrCompleteIngestionJob({
            jobId: job.id,
            providerOutcome: null,
            outcomeCode: 'processing_error',
            now: 22,
            claimToken,
          }),
        ).toMatchObject({ applied: true, status });
      } else {
        expect(
          completeIngestionJob(
            job.id,
            status,
            status === 'completed_enriched' ? 'valid' : 'structural_only',
            22,
            claimToken,
          ),
        ).toBe(true);
      }

      expect(getIngestionJob(job.id)).toMatchObject({
        status,
        sourceSnapshotVersion: 1,
        sourceSnapshotSha256: job.sourceSnapshotSha256,
        sourceSnapshotByteLength: job.sourceSnapshotByteLength,
      });
      expect(snapshotCount(job.id)).toBe(0);
    },
  );

  it('allows an exact terminal duplicate after payload cleanup', () => {
    const input = enqueueInput('terminal-replay');
    const job = enqueueIngestionJob(input)!;
    const claimToken = claimIngestionJob(job.id, 20)!;
    expect(completeIngestionJob(job.id, 'completed_enriched', 'valid', 21, claimToken)).toBe(true);
    expect(snapshotCount(job.id)).toBe(0);

    expect(enqueueIngestionJob(input)).toMatchObject({
      id: job.id,
      status: 'completed_enriched',
    });
    expect(snapshotCount(job.id)).toBe(0);
  });

  it('cleans payloads with individual discard, bulk discard, and structured-memory clear', () => {
    const individual = enqueueIngestionJob(enqueueInput('discard-one'))!;
    const bulk = enqueueIngestionJob(enqueueInput('discard-bulk'))!;
    expect(discardIngestionJob(individual.id)).toBe(true);
    expect(snapshotCount(individual.id)).toBe(0);
    expect(snapshotCount(bulk.id)).toBe(1);

    expect(discardPendingIngestionJobs()).toBe(1);
    expect(tableCount('memory_ingestion_jobs')).toBe(0);
    expect(tableCount('memory_ingestion_source_snapshots')).toBe(0);

    enqueueIngestionJob(enqueueInput('clear'));
    clearStructuredMemory();
    expect(tableCount('memory_ingestion_jobs')).toBe(0);
    expect(tableCount('memory_ingestion_source_snapshots')).toBe(0);
  });

  it('discards active jobs and payloads immediately when the user opts out', () => {
    enqueueIngestionJob(enqueueInput('opt-out'));
    expect(tableCount('memory_ingestion_source_snapshots')).toBe(1);

    useSettingsStore.setState({ disableLongTermMemory: true } as never);

    expect(tableCount('memory_ingestion_jobs')).toBe(0);
    expect(tableCount('memory_ingestion_source_snapshots')).toBe(0);
  });
});
