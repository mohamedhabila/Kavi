jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithContributionInTransaction } from '../../../src/services/memory/facts/mutations';
import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueue';
import {
  claimIngestionJob,
  completeIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import { retireActiveMemoryPublicationsBeforeOptOut } from '../../../src/services/memory/memoryOptOutRetirement';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as sourceRetirementCoordinator from '../../../src/services/memory/sourceRetirementCoordinator';
import { withIngestionSourceSnapshot } from '../../helpers/ingestionSourceSnapshotFixture';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  jest.restoreAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function enqueuePublication(suffix: string, now: number) {
  return enqueueIngestionJob(
    withIngestionSourceSnapshot({
      threadId: `thread-${suffix}`,
      threadTitle: null,
      memoryConversationId: `conversation-${suffix}`,
      personaId: 'default',
      taskId: `task-${suffix}`,
      sourceStartMessageId: `user-${suffix}`,
      sourceEndMessageId: `assistant-${suffix}`,
      sourceRunId: null,
      sourceAt: now,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed' as const,
      providerEnrichment: false,
      now,
    }),
  )!;
}

function seedPublicationContribution(suffix: string, now: number): string {
  const subjectId = upsertEntity({ name: `subject-${suffix}`, type: 'self', now }).id;
  return runMemoryTransaction(() =>
    recordFactWithContributionInTransaction(
      {
        subjectId,
        predicate: '状态',
        objectText: 'نشط',
        attributes: { suffix },
        scope: 'session',
        originConversationId: `conversation-${suffix}`,
        originThreadId: `thread-${suffix}`,
        originTaskId: `task-${suffix}`,
        sourceMessageId: `user-${suffix}`,
        sourceTurnId: `assistant-${suffix}`,
        now,
      },
      { factClass: 'workflow', sourceAuthority: 'grounded_user' },
      {
        memoryConversationId: `conversation-${suffix}`,
        sourceThreadId: `thread-${suffix}`,
        taskId: `task-${suffix}`,
        producer: {
          producerId: 'memory_opt_out_retirement_test',
          producerEventId: `event-${suffix}`,
        },
        sourceAliases: [
          { sourceKind: 'message', sourceId: `user-${suffix}` },
          { sourceKind: 'turn', sourceId: `assistant-${suffix}` },
        ],
      },
    ),
  ).result.fact.id;
}

function countRows(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

describe('memory opt-out publication retirement', () => {
  it('retires unfinished publication work while preserving completed memory', () => {
    const pendingJob = enqueuePublication('pending', 10);
    const completedJob = enqueuePublication('completed', 20);
    const pendingFactId = seedPublicationContribution('pending', 30);
    const completedFactId = seedPublicationContribution('completed', 40);
    getMemoryDb().runSync(
      `INSERT INTO memory_consolidation_state(
         thread_id, last_consolidated_message_id, last_consolidated_at,
         turns_since_last, updated_at
       ) VALUES (?, ?, 30, 1, 30)`,
      'thread-pending',
      'assistant-pending',
    );
    const claimToken = claimIngestionJob(completedJob.id, 50)!;
    expect(
      completeIngestionJob(
        completedJob.id,
        'completed_structural',
        'structural_only',
        51,
        claimToken,
      ),
    ).toBe(true);

    const checkpoint = jest.spyOn(getMemoryDb(), 'execSync');
    expect(retireActiveMemoryPublicationsBeforeOptOut({ now: 100 })).toEqual({
      status: 'retired',
      retiredSourceCount: 3,
      publicationWithdrawals: [
        {
          sourceThreadId: 'thread-pending',
          sourceEndMessageId: 'assistant-pending',
        },
      ],
    });
    expect(checkpoint).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE)');
    checkpoint.mockRestore();
    expect(
      getMemoryDb().getAllSync<{ id: string; deleted_at: number | null }>(
        `SELECT id, deleted_at FROM memory_facts
          WHERE id IN (?, ?) ORDER BY id ASC`,
        pendingFactId,
        completedFactId,
      ),
    ).toEqual([{ id: completedFactId, deleted_at: null }]);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_retired_sources
          WHERE source_thread_id = ?`,
        'thread-pending',
      )?.count,
    ).toBe(3);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_retired_sources AS source
           JOIN memory_ingestion_job_sources AS job_source
             ON job_source.job_id = ?
            AND job_source.memory_owner_id = source.memory_owner_id
            AND job_source.memory_conversation_id = source.memory_conversation_id
            AND job_source.source_thread_id = source.source_thread_id
            AND job_source.task_id = source.task_id
            AND job_source.source_kind = source.source_kind
            AND job_source.source_id = source.source_id`,
        completedJob.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_ingestion_jobs WHERE id = ?`,
        pendingJob.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_ingestion_source_snapshots WHERE job_id = ?`,
        pendingJob.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_ingestion_jobs WHERE id = ?`,
        completedJob.id,
      )?.count,
    ).toBe(1);
    expect(
      getMemoryDb().getFirstSync<{
        last_consolidated_message_id: string;
        turns_since_last: number;
      }>(
        `SELECT last_consolidated_message_id, turns_since_last
           FROM memory_consolidation_state WHERE thread_id = ?`,
        'thread-pending',
      ),
    ).toEqual({
      last_consolidated_message_id: 'assistant-pending',
      turns_since_last: 0,
    });
  });

  it('rolls back every page on failure, then retires all pages exactly once', () => {
    runMemoryTransaction(() => {
      for (let index = 0; index < 130; index += 1) {
        enqueuePublication(`paged-${String(index).padStart(3, '0')}`, 10 + index);
      }
    });
    const retire = sourceRetirementCoordinator.retireExactMemorySources;
    const coordinatorSpy = jest.spyOn(sourceRetirementCoordinator, 'retireExactMemorySources');
    let calls = 0;
    coordinatorSpy.mockImplementation((request) => {
      calls += 1;
      if (calls === 2) throw new Error('forced_opt_out_page_failure');
      return retire(request);
    });
    try {
      expect(() => retireActiveMemoryPublicationsBeforeOptOut({ now: 500 })).toThrow(
        'forced_opt_out_page_failure',
      );
    } finally {
      coordinatorSpy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(countRows('memory_source_retirement_groups')).toBe(0);
    expect(countRows('memory_retired_sources')).toBe(0);

    expect(retireActiveMemoryPublicationsBeforeOptOut({ now: 500 })).toEqual({
      status: 'retired',
      retiredSourceCount: 390,
      publicationWithdrawals: expect.arrayContaining(
        Array.from({ length: 130 }, (_, index) => ({
          sourceThreadId: `thread-paged-${String(index).padStart(3, '0')}`,
          sourceEndMessageId: `assistant-paged-${String(index).padStart(3, '0')}`,
        })),
      ),
    });
    expect(countRows('memory_source_retirement_groups')).toBe(2);
    expect(countRows('memory_retired_sources')).toBe(390);
    expect(retireActiveMemoryPublicationsBeforeOptOut({ now: 600 })).toEqual({
      status: 'not_required',
      retiredSourceCount: 0,
      publicationWithdrawals: [],
    });
    expect(countRows('memory_source_retirement_groups')).toBe(2);

    enqueuePublication('after-reenable', 700);
    expect(retireActiveMemoryPublicationsBeforeOptOut({ now: 800 })).toEqual({
      status: 'retired',
      retiredSourceCount: 3,
      publicationWithdrawals: [
        {
          sourceThreadId: 'thread-after-reenable',
          sourceEndMessageId: 'assistant-after-reenable',
        },
      ],
    });
    expect(countRows('memory_source_retirement_groups')).toBe(3);
  });
});
