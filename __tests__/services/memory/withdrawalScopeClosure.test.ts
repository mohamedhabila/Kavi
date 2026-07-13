jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  addFactEvidence,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import { editWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import { enqueueIngestionJob as enqueueStrictIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import * as memoryChangeNotifications from '../../../src/services/memory/changeNotifications';
import {
  cloneMemoryFactForWithdrawal,
  insertMemoryIngestionReceiptForWithdrawal,
  requireMemoryIngestionJob,
} from '../../helpers/memoryWithdrawalFixtures';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const CONVERSATION_ID = 'conversation-closure';

function requireJob(input: {
  threadId: string;
  taskId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceRunId: string;
}) {
  return requireMemoryIngestionJob({
    personaId: 'default',
    threadTitle: null,
    memoryConversationId: CONVERSATION_ID,
    sourceAt: 2_000,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 2_000,
    ...input,
  });
}

function ids(table: string, column = 'id'): string[] {
  return getMemoryDb()
    .getAllSync<Record<string, string>>(`SELECT ${column} FROM ${table}`)
    .map((row) => row[column]);
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

it('closes exact fact and receipt lineage without deleting a different task scope', () => {
  const subject = upsertEntity({ name: 'closure-user', type: 'self', now: 100 });
  const target = recordFact({
    subjectId: subject.id,
    predicate: 'private_value',
    objectText: 'private closure value',
    scope: 'session',
    originConversationId: CONVERSATION_ID,
    originThreadId: 'thread-a',
    originTaskId: 'task-a',
    taskId: 'task-a',
    sourceMessageId: 'message-a',
    sourceTurnId: 'turn-a',
    sourceRunId: 'run-a',
    supersedePrior: false,
    now: 200,
  }).fact;
  const duplicateFactId = 'fact-closure-thread-b';
  cloneMemoryFactForWithdrawal(target.id, duplicateFactId, {
    origin_thread_id: 'thread-b',
    origin_task_id: 'task-b',
    task_id: 'task-b',
    source_message_id: 'message-b',
    source_turn_id: 'turn-b',
    source_run_id: 'run-b',
  });
  const retainedFact = recordFact({
    subjectId: subject.id,
    predicate: 'unrelated_value',
    objectText: 'retain this fact',
    scope: 'session',
    originConversationId: CONVERSATION_ID,
    originThreadId: 'thread-a',
    originTaskId: 'task-retained',
    taskId: 'task-retained',
    sourceMessageId: 'message-unrelated-fact',
    sourceTurnId: 'turn-unrelated-fact',
    sourceRunId: 'run-unrelated-fact',
    supersedePrior: false,
    now: 201,
  }).fact;

  const episodeA = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-a',
    taskId: 'task-a',
    summary: 'private episode a',
    messageIds: ['message-a', 'message-a-chain'],
    sourceStartMessageId: 'message-a',
    sourceEndMessageId: 'turn-a',
    now: 300,
  });
  const episodeB = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-b',
    taskId: 'task-b',
    summary: 'private episode b',
    messageIds: ['message-b'],
    sourceStartMessageId: 'message-b',
    sourceEndMessageId: 'turn-b',
    now: 301,
  });
  const chainedEpisode = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-a',
    taskId: 'task-a',
    summary: 'private chained episode',
    messageIds: ['message-a-chain'],
    sourceStartMessageId: 'message-a-chain',
    sourceEndMessageId: 'turn-a-chain',
    now: 302,
  });
  const unrelatedEpisode = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-unrelated',
    taskId: 'task-a',
    summary: 'unrelated episode retained',
    messageIds: ['message-a'],
    sourceStartMessageId: 'message-a',
    sourceEndMessageId: 'turn-a',
    now: 303,
  });
  if (!episodeA || !episodeB || !chainedEpisode || !unrelatedEpisode) {
    throw new Error('test episode missing');
  }
  addFactEvidence({
    factId: retainedFact.id,
    episodeId: episodeA.id,
    messageId: 'message-evidence-only',
    quote: 'evidence removed with its withdrawn episode',
    now: 304,
  });

  for (const scope of [
    { threadId: 'thread-a', taskId: 'task-a' },
    { threadId: 'thread-b', taskId: 'task-b' },
    { threadId: 'thread-c', taskId: 'task-c' },
  ]) {
    editWorkingBlock(
      'active_focus',
      'private scope state',
      { conversationId: CONVERSATION_ID, ...scope },
      { now: 400 },
    );
    editWorkingBlock(
      'open_threads',
      'private derived open threads',
      { conversationId: CONVERSATION_ID, ...scope },
      { now: 401 },
    );
    editWorkingBlock(
      'compaction_summary',
      'private derived compaction summary',
      { conversationId: CONVERSATION_ID, ...scope },
      { now: 402 },
    );
    editWorkingBlock(
      'task_stack',
      `structural task stack ${scope.taskId}`,
      { conversationId: CONVERSATION_ID, ...scope },
      { now: 403 },
    );
    upsertMemoryTask({
      id: scope.taskId,
      threadId: scope.threadId,
      title: 'private scope task',
      now: 500,
    });
  }
  editWorkingBlock(
    'active_focus',
    'unrelated state retained',
    {
      conversationId: CONVERSATION_ID,
      threadId: 'thread-c',
      taskId: 'task-unrelated',
    },
    { now: 401 },
  );
  editWorkingBlock(
    'task_stack',
    'unrelated structural task stack',
    {
      conversationId: CONVERSATION_ID,
      threadId: 'thread-c',
      taskId: 'task-unrelated',
    },
    { now: 404 },
  );
  upsertMemoryTask({
    id: 'task-unrelated',
    threadId: 'thread-c',
    title: 'unrelated task retained',
    now: 501,
  });

  const jobA = requireJob({
    threadId: 'thread-a',
    taskId: 'task-a',
    sourceStartMessageId: 'message-a',
    sourceEndMessageId: 'turn-a',
    sourceRunId: 'run-a',
  });
  const jobB = requireJob({
    threadId: 'thread-b',
    taskId: 'task-b',
    sourceStartMessageId: 'message-b',
    sourceEndMessageId: 'turn-b',
    sourceRunId: 'run-b',
  });
  const chainedEpisodeJob = requireJob({
    threadId: 'thread-a',
    taskId: 'task-a',
    sourceStartMessageId: 'message-a-chain',
    sourceEndMessageId: 'turn-a-chain',
    sourceRunId: 'run-a-chain',
  });
  const evidenceSourceJob = requireJob({
    threadId: 'thread-a',
    taskId: 'task-a',
    sourceStartMessageId: 'message-evidence-only',
    sourceEndMessageId: 'turn-evidence-only',
    sourceRunId: 'run-evidence-only',
  });
  const receiptJob = requireJob({
    threadId: 'thread-c',
    taskId: 'task-c',
    sourceStartMessageId: 'message-c',
    sourceEndMessageId: 'turn-c',
    sourceRunId: 'run-c',
  });
  insertMemoryIngestionReceiptForWithdrawal(receiptJob.id, JSON.stringify([target.id]));
  const sameSourceSiblingJob = requireJob({
    threadId: 'thread-c',
    taskId: 'task-c',
    sourceStartMessageId: 'message-c-sibling',
    sourceEndMessageId: 'turn-c-sibling',
    sourceRunId: 'run-c',
  });
  const unrelatedJob = requireJob({
    threadId: 'thread-c',
    taskId: 'task-unrelated',
    sourceStartMessageId: 'message-unrelated',
    sourceEndMessageId: 'turn-unrelated',
    sourceRunId: 'run-unrelated',
  });
  const otherScopeSameIdsJob = requireJob({
    threadId: 'thread-unrelated',
    taskId: 'task-a',
    sourceStartMessageId: 'message-a',
    sourceEndMessageId: 'turn-a',
    sourceRunId: 'run-a',
  });
  const notificationSpy = jest.spyOn(memoryChangeNotifications, 'notifyStructuredMemoryChanged');
  notificationSpy.mockClear();

  const result = withdrawMemoryFact(target.id, 3_000);

  expect(result.status).toBe('withdrawn');
  if (result.status !== 'withdrawn') throw new Error('expected withdrawal');
  expect(result.receipt.counts).toEqual(
    expect.objectContaining({
      facts: 1,
      episodes: 2,
      workingBlocks: 6,
      ingestionSourceSnapshots: 5,
      ingestionJobs: 5,
    }),
  );
  expect(notificationSpy).toHaveBeenLastCalledWith(null);
  expect(ids('memory_facts')).toEqual(expect.arrayContaining([duplicateFactId, retainedFact.id]));
  expect(ids('memory_facts')).toHaveLength(2);
  expect(ids('memory_episodes')).toEqual(
    expect.arrayContaining([episodeB.id, unrelatedEpisode.id]),
  );
  expect(ids('memory_episodes')).toHaveLength(2);
  expect(ids('memory_tasks')).toEqual(
    expect.arrayContaining(['task-a', 'task-b', 'task-c', 'task-unrelated']),
  );
  expect(ids('memory_tasks')).toHaveLength(4);

  const remainingWorkingTaskIds = getMemoryDb()
    .getAllSync<{ task_id: string | null }>(
      "SELECT task_id FROM memory_working_blocks WHERE label = 'active_focus'",
    )
    .map((row) => row.task_id);
  expect(remainingWorkingTaskIds).toEqual(expect.arrayContaining(['task-b', 'task-unrelated']));
  expect(remainingWorkingTaskIds).toHaveLength(2);
  const remainingTaskStackIds = getMemoryDb()
    .getAllSync<{ task_id: string | null }>(
      "SELECT task_id FROM memory_working_blocks WHERE label = 'task_stack'",
    )
    .map((row) => row.task_id);
  expect(remainingTaskStackIds).toEqual(
    expect.arrayContaining(['task-a', 'task-b', 'task-c', 'task-unrelated']),
  );
  expect(remainingTaskStackIds).toHaveLength(4);
  expect(
    getMemoryDb()
      .getAllSync<{ label: string; task_id: string | null }>(
        "SELECT label, task_id FROM memory_working_blocks WHERE label IN ('open_threads', 'compaction_summary')",
      )
      .map((row) => row.task_id),
  ).toEqual(['task-b', 'task-b']);
  const remainingJobIds = ids('memory_ingestion_jobs');
  expect(remainingJobIds).toEqual(
    expect.arrayContaining([jobB.id, unrelatedJob.id, otherScopeSameIdsJob.id]),
  );
  for (const removedId of [
    jobA.id,
    chainedEpisodeJob.id,
    evidenceSourceJob.id,
    receiptJob.id,
    sameSourceSiblingJob.id,
  ]) {
    expect(remainingJobIds).not.toContain(removedId);
  }
  const remainingSnapshotJobIds = ids('memory_ingestion_source_snapshots', 'job_id');
  for (const removedId of [
    jobA.id,
    chainedEpisodeJob.id,
    evidenceSourceJob.id,
    receiptJob.id,
    sameSourceSiblingJob.id,
  ]) {
    expect(remainingSnapshotJobIds).not.toContain(removedId);
  }
  expect(ids('memory_ingestion_receipts', 'job_id')).toEqual([]);
  expect(
    getMemoryDb().getAllSync<{ source_thread_id: string; task_id: string }>(
      `SELECT source_thread_id, task_id FROM memory_withdrawal_sources
        WHERE source_kind = 'run' AND source_id IN ('run-b', 'run-c')`,
    ),
  ).toEqual([{ source_thread_id: 'thread-c', task_id: 'task-c' }]);
  expect(
    enqueueIngestionJob({
      personaId: 'default',
      memoryConversationId: CONVERSATION_ID,
      threadId: 'thread-c',
      threadTitle: null,
      taskId: 'task-c',
      sourceStartMessageId: 'message-c-new',
      sourceEndMessageId: 'turn-c-new',
      sourceRunId: 'run-c',
      sourceAt: 3_100,
      chatProviderId: null,
      chatModel: null,
      reason: 'turn_completed',
      providerEnrichment: true,
      now: 3_100,
    }),
  ).toBeNull();
  notificationSpy.mockRestore();
});
