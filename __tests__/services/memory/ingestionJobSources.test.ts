jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { encodeIngestionSourceSnapshot } from '../../../src/services/memory/ingestionSourceSnapshot';
import { ensureIngestionQueueSchema } from '../../../src/services/memory/ingestionQueueSchema';
import {
  claimIngestionJob,
  completeIngestionJob,
  enqueueIngestionJob,
} from '../../../src/services/memory/ingestionQueueStore';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import type { Message } from '../../../src/types/message';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

interface SourceFixtureOptions {
  suffix: string;
  memoryConversationId?: string;
  threadId?: string;
  taskId?: string | null;
  priorUserMessageId?: string;
  sourceStartMessageId?: string;
  intermediateMessageId?: string;
  sourceEndMessageId?: string;
  sourceRunId?: string | null;
  now?: number;
}

function sourceFixture(options: SourceFixtureOptions) {
  const priorUserMessageId = options.priorUserMessageId ?? `prior-${options.suffix}`;
  const sourceStartMessageId = options.sourceStartMessageId ?? `user-${options.suffix}`;
  const intermediateMessageId = options.intermediateMessageId ?? `middle-${options.suffix}`;
  const sourceEndMessageId = options.sourceEndMessageId ?? `assistant-${options.suffix}`;
  const messages: Message[] = [
    {
      id: priorUserMessageId,
      role: 'user',
      content: 'Prior request.',
      timestamp: 1,
    },
    {
      id: sourceStartMessageId,
      role: 'user',
      content: 'Current request.',
      timestamp: 2,
    },
    {
      id: intermediateMessageId,
      role: 'assistant',
      content: 'Intermediate response.',
      timestamp: 3,
    },
    {
      id: sourceEndMessageId,
      role: 'assistant',
      content: 'Final response.',
      timestamp: 4,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
  const now = options.now ?? 10;
  return {
    personaId: 'default',
    threadId: options.threadId ?? `thread-${options.suffix}`,
    threadTitle: null,
    memoryConversationId:
      options.memoryConversationId ?? options.threadId ?? `thread-${options.suffix}`,
    taskId: options.taskId ?? null,
    priorUserMessageId,
    sourceStartMessageId,
    sourceEndMessageId,
    sourceSnapshot: encodeIngestionSourceSnapshot({
      messages,
      sourceStartMessageId,
      sourceEndMessageId,
      priorUserMessageId,
    }),
    sourceRunId:
      options.sourceRunId === undefined ? `run-${options.suffix}` : options.sourceRunId,
    sourceAt: now,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed' as const,
    providerEnrichment: true,
    now,
  };
}

function sourceRows(jobId: string): Array<{ source_kind: string; source_id: string }> {
  return getMemoryDb().getAllSync(
    `SELECT source_kind, source_id
       FROM memory_ingestion_job_sources
      WHERE job_id = ?
      ORDER BY source_kind, source_id`,
    jobId,
  );
}

function rowCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

function retireExactSource(input: {
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  sourceKind: 'message' | 'turn' | 'run';
  sourceId: string;
  suffix: string;
}): void {
  const db = getMemoryDb();
  const retirementGroupId = `retirement-${input.suffix}`;
  db.runSync(
    `INSERT INTO memory_source_retirement_groups(id, reason, retired_at)
     VALUES (?, 'test', 1)`,
    retirementGroupId,
  );
  db.runSync(
    `INSERT INTO memory_retired_sources(
       retirement_group_id, memory_owner_id, memory_conversation_id,
       source_thread_id, task_id, source_kind, source_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    retirementGroupId,
    getLocalMemoryVaultOwnerId(db),
    input.memoryConversationId,
    input.sourceThreadId,
    input.taskId ?? '',
    input.sourceKind,
    input.sourceId,
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

describe('canonical ingestion job source index', () => {
  it('retains every exact alias after terminal snapshot cleanup and removes them with the job', () => {
    const input = sourceFixture({ suffix: 'lifetime' });
    const job = enqueueIngestionJob(input)!;
    const expected = [
      { source_kind: 'message', source_id: 'assistant-lifetime' },
      { source_kind: 'message', source_id: 'middle-lifetime' },
      { source_kind: 'message', source_id: 'prior-lifetime' },
      { source_kind: 'message', source_id: 'user-lifetime' },
      { source_kind: 'run', source_id: 'run-lifetime' },
      { source_kind: 'turn', source_id: 'assistant-lifetime' },
    ];
    expect(sourceRows(job.id)).toEqual(expected);
    expect(() =>
      getMemoryDb().runSync(
        'DELETE FROM memory_ingestion_job_sources WHERE job_id = ?',
        job.id,
      ),
    ).toThrow('memory_ingestion_job_source_immutable');

    const claimToken = claimIngestionJob(job.id, 20)!;
    expect(
      completeIngestionJob(job.id, 'completed_structural', 'structural_only', 21, claimToken),
    ).toBe(true);
    expect(rowCount('memory_ingestion_source_snapshots')).toBe(0);
    expect(sourceRows(job.id)).toEqual(expected);
    expect(enqueueIngestionJob(input)?.id).toBe(job.id);
    expect(() =>
      getMemoryDb().runSync(
        'DELETE FROM memory_ingestion_job_sources WHERE job_id = ?',
        job.id,
      ),
    ).toThrow('memory_ingestion_job_source_immutable');

    expect(
      getMemoryDb().runSync('DELETE FROM memory_ingestion_jobs WHERE id = ?', job.id).changes,
    ).toBe(1);
    expect(sourceRows(job.id)).toEqual([]);
  });

  it.each([
    ['prior', 'prior-fence'],
    ['intermediate', 'middle-fence'],
  ] as const)('fences enqueue when the exact %s message alias is retired', (_label, sourceId) => {
    const input = sourceFixture({ suffix: 'fence' });
    retireExactSource({
      memoryConversationId: input.memoryConversationId,
      sourceThreadId: input.threadId,
      taskId: input.taskId,
      sourceKind: 'message',
      sourceId,
      suffix: sourceId,
    });

    expect(enqueueIngestionJob(input)).toBeNull();
    expect(rowCount('memory_ingestion_jobs')).toBe(0);
    expect(rowCount('memory_ingestion_job_sources')).toBe(0);
  });

  it('keeps exact retired message aliases isolated across sibling threads and tasks', () => {
    const base = sourceFixture({
      suffix: 'isolated-base',
      memoryConversationId: 'root-isolated',
      threadId: 'thread-isolated',
      taskId: 'task-isolated',
      intermediateMessageId: 'shared-intermediate',
    });
    retireExactSource({
      memoryConversationId: base.memoryConversationId,
      sourceThreadId: base.threadId,
      taskId: base.taskId,
      sourceKind: 'message',
      sourceId: 'shared-intermediate',
      suffix: 'isolated',
    });

    expect(enqueueIngestionJob(base)).toBeNull();
    expect(
      enqueueIngestionJob(
        sourceFixture({
          suffix: 'isolated-thread-sibling',
          memoryConversationId: base.memoryConversationId,
          threadId: 'thread-sibling',
          taskId: base.taskId,
          intermediateMessageId: 'shared-intermediate',
        }),
      ),
    ).not.toBeNull();
    expect(
      enqueueIngestionJob(
        sourceFixture({
          suffix: 'isolated-task-sibling',
          memoryConversationId: base.memoryConversationId,
          threadId: base.threadId,
          taskId: 'task-sibling',
          intermediateMessageId: 'shared-intermediate',
        }),
      ),
    ).not.toBeNull();
  });

  it('replays idempotently and never repairs a missing authoritative alias from the snapshot', () => {
    const input = sourceFixture({ suffix: 'replay' });
    const first = enqueueIngestionJob(input)!;
    expect(enqueueIngestionJob(input)?.id).toBe(first.id);
    expect(rowCount('memory_ingestion_jobs')).toBe(1);
    expect(sourceRows(first.id)).toHaveLength(6);

    getMemoryDb().execSync('DROP TRIGGER trg_memory_ingestion_job_source_delete_guard');
    getMemoryDb().runSync(
      `DELETE FROM memory_ingestion_job_sources
        WHERE job_id = ? AND source_kind = 'message' AND source_id = 'middle-replay'`,
      first.id,
    );
    expect(() => enqueueIngestionJob(input)).toThrow(
      'memory_ingestion_job_sources_conflict',
    );
    expect(sourceRows(first.id)).toHaveLength(5);
  });

  it('rolls back the job and snapshot when exact alias persistence fails', () => {
    getMemoryDb().execSync(`
      CREATE TRIGGER test_reject_ingestion_job_source
      BEFORE INSERT ON memory_ingestion_job_sources
      BEGIN
        SELECT RAISE(ABORT, 'test_ingestion_job_source_failed');
      END;
    `);

    expect(() => enqueueIngestionJob(sourceFixture({ suffix: 'rollback' }))).toThrow(
      'test_ingestion_job_source_failed',
    );
    expect(rowCount('memory_ingestion_jobs')).toBe(0);
    expect(rowCount('memory_ingestion_source_snapshots')).toBe(0);
    expect(rowCount('memory_ingestion_job_sources')).toBe(0);
  });

  it('bootstraps complete active aliases and provable terminal aliases without deleting jobs', () => {
    const active = enqueueIngestionJob(sourceFixture({ suffix: 'bootstrap-active' }))!;
    const terminal = enqueueIngestionJob(sourceFixture({ suffix: 'bootstrap-terminal' }))!;
    const claimToken = claimIngestionJob(terminal.id, 20)!;
    expect(
      completeIngestionJob(
        terminal.id,
        'completed_structural',
        'structural_only',
        21,
        claimToken,
      ),
    ).toBe(true);
    getMemoryDb().runSync(
      `INSERT INTO memory_ingestion_receipts(
         job_id, attempt_number, episode_id, deterministic_fact_ids_json,
         provider_fact_ids_json, invalidated_fact_ids_json,
         bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json,
         active_focus_updated, open_threads_updated, provider_outcome,
         provider_outcome_code, persisted_at
       ) VALUES (?, 1, NULL, '[]', '[]', '[]', '[]', '[]', 0, 0,
                 'structural_only', NULL, 21)`,
      terminal.id,
    );

    getMemoryDb().execSync('DROP TABLE memory_ingestion_job_sources');
    ensureIngestionQueueSchema(getMemoryDb());

    expect(rowCount('memory_ingestion_jobs')).toBe(2);
    expect(rowCount('memory_ingestion_receipts')).toBe(1);
    expect(sourceRows(active.id)).toEqual([
      { source_kind: 'message', source_id: 'assistant-bootstrap-active' },
      { source_kind: 'message', source_id: 'middle-bootstrap-active' },
      { source_kind: 'message', source_id: 'prior-bootstrap-active' },
      { source_kind: 'message', source_id: 'user-bootstrap-active' },
      { source_kind: 'run', source_id: 'run-bootstrap-active' },
      { source_kind: 'turn', source_id: 'assistant-bootstrap-active' },
    ]);
    expect(sourceRows(terminal.id)).toEqual([
      { source_kind: 'message', source_id: 'assistant-bootstrap-terminal' },
      { source_kind: 'message', source_id: 'prior-bootstrap-terminal' },
      { source_kind: 'message', source_id: 'user-bootstrap-terminal' },
      { source_kind: 'run', source_id: 'run-bootstrap-terminal' },
      { source_kind: 'turn', source_id: 'assistant-bootstrap-terminal' },
    ]);
  });
});
