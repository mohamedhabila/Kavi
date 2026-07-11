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
  recordEpisode,
  recordThreadLocalEpisode,
} from '../../../src/services/memory/episodes/mutations';
import { upsertReflection } from '../../../src/services/memory/reflections';
import {
  buildWorkingBlockScopeKey,
  editWorkingBlock,
} from '../../../src/services/memory/workingBlocks';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import { enqueueIngestionJob } from '../../../src/services/memory/ingestionQueueStore';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { EMPTY_MEMORY_WITHDRAWAL_COUNTS } from '../../../src/services/memory/withdrawalTypes';
import { probeMemoryWithdrawalResiduals } from '../../../src/services/memory/withdrawalResidualProbe';
import * as memoryChangeNotifications from '../../../src/services/memory/changeNotifications';
import {
  cloneMemoryFactForWithdrawal,
  insertMemoryIngestionReceiptForWithdrawal,
  insertMemoryRetrievalEventForWithdrawal,
  requireMemoryIngestionJob,
} from '../../helpers/memoryWithdrawalFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const PRIVATE_VALUE = 'PRIVATE-WITHDRAWAL-SENTINEL';
const CONVERSATION_ID = 'conversation-target';
const THREAD_ID = 'thread-target';
const TASK_ID = 'task-target';
const MESSAGE_ID = 'message-target';
const TURN_ID = 'turn-target';
const RUN_ID = 'run-target';

interface SeededLineage {
  targetFactId: string;
  historyFactId: string;
  collisionFactId: string;
  orphanEntityId: string;
  sharedEntityId: string;
  targetEpisodeId: string;
  otherThreadEpisodeId: string;
  otherKindEpisodeId: string;
  targetReflectionId: string;
  linkedMalformedReflectionId: string;
  unrelatedMalformedReflectionId: string;
  targetJobId: string;
  linkedMalformedReceiptJobId: string;
  unrelatedMalformedReceiptJobId: string;
  otherThreadJobId: string;
  otherKindJobId: string;
  evidenceIds: string[];
  targetChunkIds: number[];
  targetWorkingBlockScopeKey: string;
}

function insertReflection(
  id: string,
  sourceFactIdsJson: string,
  sourceEpisodeIdsJson: string,
  content: string,
): void {
  getMemoryDb().runSync(
    `INSERT INTO memory_reflections(
       id, scope, thread_id, task_id, period_start, period_end, kind, content,
       source_episode_ids_json, source_fact_ids_json, created_at, updated_at, deleted_at
     ) VALUES (?, 'task', ?, ?, 1, 2, 'task_period', ?, ?, ?, 1, 1, NULL)`,
    id,
    THREAD_ID,
    TASK_ID,
    content,
    sourceEpisodeIdsJson,
    sourceFactIdsJson,
  );
}

function requireJob(
  overrides: Partial<Parameters<typeof enqueueIngestionJob>[0]>,
): NonNullable<ReturnType<typeof enqueueIngestionJob>> {
  return requireMemoryIngestionJob({
    personaId: 'default',
    threadId: THREAD_ID,
    threadTitle: null,
    memoryConversationId: CONVERSATION_ID,
    taskId: TASK_ID,
    sourceStartMessageId: 'message-unrelated',
    sourceEndMessageId: 'turn-unrelated',
    sourceRunId: 'run-unrelated',
    sourceAt: 1_999,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 2_000,
    ...overrides,
  });
}

function seedAuthoritativeLineage(): SeededLineage {
  const sharedEntity = upsertEntity({ name: 'user', type: 'self', now: 1_000 });
  const orphanEntity = upsertEntity({ name: 'private-object', type: 'concept', now: 1_000 });
  const target = recordFact({
    subjectId: sharedEntity.id,
    predicate: 'private_preference',
    objectText: PRIVATE_VALUE,
    objectEntityId: orphanEntity.id,
    scope: 'session',
    originConversationId: CONVERSATION_ID,
    originThreadId: THREAD_ID,
    originTaskId: TASK_ID,
    taskId: TASK_ID,
    sourceMessageId: MESSAGE_ID,
    sourceTurnId: TURN_ID,
    sourceRunId: RUN_ID,
    sourceSummary: PRIVATE_VALUE,
    supersedePrior: false,
    now: 1_000,
  }).fact;
  const historyFactId = 'fact-history-same-identity';
  cloneMemoryFactForWithdrawal(target.id, historyFactId);

  const collision = recordFact({
    subjectId: sharedEntity.id,
    predicate: 'private_preference',
    objectText: 'different retained value',
    scope: 'session',
    originConversationId: CONVERSATION_ID,
    originThreadId: THREAD_ID,
    originTaskId: TASK_ID,
    taskId: TASK_ID,
    sourceMessageId: 'message-collision',
    sourceTurnId: 'turn-collision',
    sourceRunId: 'run-collision',
    supersedePrior: false,
    now: 1_100,
  }).fact;
  getMemoryDb().runSync(
    'UPDATE memory_facts SET content_hash = ? WHERE id = ?',
    target.contentHash,
    collision.id,
  );

  const targetEpisode = recordEpisode({
    conversationId: CONVERSATION_ID,
    threadId: THREAD_ID,
    taskId: TASK_ID,
    summary: `episode ${PRIVATE_VALUE}`,
    messageIds: [MESSAGE_ID],
    sourceStartMessageId: MESSAGE_ID,
    sourceEndMessageId: TURN_ID,
    accessPolicy: {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      personaId: 'default',
      taskId: TASK_ID,
      shareability: 'thread_only',
      sensitivity: 'normal',
    },
    now: 1_200,
  });
  const otherThreadEpisode = recordEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-other',
    taskId: TASK_ID,
    summary: 'other thread retained',
    messageIds: [MESSAGE_ID],
    sourceStartMessageId: MESSAGE_ID,
    sourceEndMessageId: TURN_ID,
    accessPolicy: {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: 'thread-other',
      personaId: 'default',
      taskId: TASK_ID,
      shareability: 'thread_only',
      sensitivity: 'normal',
    },
    now: 1_210,
  });
  const otherKindEpisode = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: THREAD_ID,
    taskId: TASK_ID,
    summary: 'same id in turn-kind retained',
    messageIds: ['message-kind-negative'],
    sourceStartMessageId: 'message-kind-negative',
    sourceEndMessageId: MESSAGE_ID,
    now: 1_220,
  });
  if (!targetEpisode || !otherThreadEpisode || !otherKindEpisode) {
    throw new Error('test episode missing');
  }
  const targetEvidence = addFactEvidence({
    factId: target.id,
    episodeId: targetEpisode.id,
    messageId: MESSAGE_ID,
    quote: PRIVATE_VALUE,
    now: 1_300,
  });

  insertMemoryRetrievalEventForWithdrawal(
    'retrieval-target',
    JSON.stringify([target.id, collision.id]),
    JSON.stringify([targetEpisode.id, otherThreadEpisode.id]),
    2,
    2,
  );
  insertMemoryRetrievalEventForWithdrawal(
    'retrieval-linked-malformed',
    `[${JSON.stringify(target.id)}`,
    '[]',
    1,
    0,
  );
  insertMemoryRetrievalEventForWithdrawal(
    'retrieval-unrelated-malformed',
    '{broken',
    '{broken',
    1,
    1,
  );
  const episodeEvidence = addFactEvidence({
    factId: collision.id,
    episodeId: targetEpisode.id,
    messageId: 'message-collision-evidence',
    quote: PRIVATE_VALUE,
    now: 1_301,
  });
  if (!targetEvidence || !episodeEvidence) throw new Error('test evidence missing');

  const targetReflection = upsertReflection({
    scope: 'task',
    threadId: THREAD_ID,
    taskId: TASK_ID,
    periodStart: 10,
    periodEnd: 20,
    kind: 'task_period',
    content: PRIVATE_VALUE,
    sourceEpisodeIds: [targetEpisode.id],
    sourceFactIds: [target.id],
    now: 1_400,
  });
  if (!targetReflection) throw new Error('test reflection missing');
  const linkedMalformedReflectionId = 'reflection-linked-malformed';
  insertReflection(
    linkedMalformedReflectionId,
    `[${JSON.stringify(target.id)}`,
    '[]',
    PRIVATE_VALUE,
  );
  const unrelatedMalformedReflectionId = 'reflection-unrelated-malformed';
  insertReflection(unrelatedMalformedReflectionId, '{broken', '{broken', 'retained');

  editWorkingBlock(
    'active_focus',
    PRIVATE_VALUE,
    { conversationId: CONVERSATION_ID, threadId: THREAD_ID, taskId: TASK_ID },
    { now: 1_500 },
  );
  editWorkingBlock(
    'active_focus',
    'other task retained',
    { conversationId: CONVERSATION_ID, threadId: THREAD_ID, taskId: 'task-other' },
    { now: 1_501 },
  );
  upsertMemoryTask({
    id: TASK_ID,
    threadId: THREAD_ID,
    title: PRIVATE_VALUE,
    summary: PRIVATE_VALUE,
    now: 1_600,
  });
  upsertMemoryTask({
    id: 'task-other',
    threadId: THREAD_ID,
    title: 'other task retained',
    now: 1_601,
  });

  const targetJob = requireJob({
    sourceStartMessageId: MESSAGE_ID,
    sourceEndMessageId: TURN_ID,
    sourceRunId: RUN_ID,
  });
  insertMemoryIngestionReceiptForWithdrawal(targetJob.id, JSON.stringify([target.id]));
  const linkedMalformedReceiptJob = requireJob({
    sourceEndMessageId: 'turn-linked-receipt',
  });
  insertMemoryIngestionReceiptForWithdrawal(
    linkedMalformedReceiptJob.id,
    `[${JSON.stringify(target.id)}`,
  );
  const unrelatedMalformedReceiptJob = requireJob({
    sourceStartMessageId: 'message-unrelated-receipt',
    sourceEndMessageId: 'turn-unrelated-receipt',
    sourceRunId: 'run-unrelated-receipt',
  });
  insertMemoryIngestionReceiptForWithdrawal(unrelatedMalformedReceiptJob.id, '{broken');
  const otherThreadJob = requireJob({
    threadId: 'thread-other',
    sourceStartMessageId: MESSAGE_ID,
    sourceEndMessageId: TURN_ID,
    sourceRunId: RUN_ID,
  });
  const otherKindJob = requireJob({
    sourceStartMessageId: 'message-kind-job',
    sourceEndMessageId: 'turn-kind-job',
    sourceRunId: MESSAGE_ID,
  });
  const targetChunkIds = getMemoryDb()
    .getAllSync<{ id: number }>(
      'SELECT id FROM memory_chunks WHERE source LIKE ?',
      `%${targetEpisode.id}`,
    )
    .map((row) => row.id);

  return {
    targetFactId: target.id,
    historyFactId,
    collisionFactId: collision.id,
    orphanEntityId: orphanEntity.id,
    sharedEntityId: sharedEntity.id,
    targetEpisodeId: targetEpisode.id,
    otherThreadEpisodeId: otherThreadEpisode.id,
    otherKindEpisodeId: otherKindEpisode.id,
    targetReflectionId: targetReflection.id,
    linkedMalformedReflectionId,
    unrelatedMalformedReflectionId,
    targetJobId: targetJob.id,
    linkedMalformedReceiptJobId: linkedMalformedReceiptJob.id,
    unrelatedMalformedReceiptJobId: unrelatedMalformedReceiptJob.id,
    otherThreadJobId: otherThreadJob.id,
    otherKindJobId: otherKindJob.id,
    evidenceIds: [targetEvidence.id, episodeEvidence.id],
    targetChunkIds,
    targetWorkingBlockScopeKey: buildWorkingBlockScopeKey({
      conversationId: CONVERSATION_ID,
      threadId: THREAD_ID,
      taskId: TASK_ID,
    }),
  };
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

describe('atomic memory withdrawal', () => {
  it('purges only authoritative lineage and leaves a content-free scoped tombstone', () => {
    const seeded = seedAuthoritativeLineage();
    const notificationSpy = jest.spyOn(
      memoryChangeNotifications,
      'notifyStructuredMemoryChanged',
    );
    notificationSpy.mockClear();

    const result = withdrawMemoryFact(seeded.targetFactId, 5_000);

    expect(result.status).toBe('withdrawn');
    if (result.status !== 'withdrawn') throw new Error('expected withdrawal');
    expect(result.receipt.counts).toEqual(
      expect.objectContaining({
        facts: 2,
        graphRelations: 2,
        factEvidence: 2,
        episodeAccessPolicies: 1,
        episodes: 1,
        chunks: 1,
        reflections: 2,
        orphanEntities: 1,
        ingestionJobs: 2,
        ingestionReceipts: 2,
        retrievalEvents: 2,
      }),
    );
    expect(JSON.stringify(result)).not.toContain(PRIVATE_VALUE);
    expect(notificationSpy).toHaveBeenLastCalledWith(CONVERSATION_ID);

    expect(ids('memory_facts')).toEqual([seeded.collisionFactId]);
    expect(ids('memory_entities')).toContain(seeded.sharedEntityId);
    expect(ids('memory_entities')).not.toContain(seeded.orphanEntityId);
    expect(ids('memory_fact_evidence')).toEqual([]);
    expect(ids('memory_episodes')).toEqual(
      expect.arrayContaining([seeded.otherThreadEpisodeId, seeded.otherKindEpisodeId]),
    );
    expect(ids('memory_episodes')).not.toContain(seeded.targetEpisodeId);
    expect(
      getMemoryDb().getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        seeded.targetEpisodeId,
      ),
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync(
        'SELECT episode_id FROM memory_episode_access_policies WHERE episode_id = ?',
        seeded.otherThreadEpisodeId,
      ),
    ).toEqual({ episode_id: seeded.otherThreadEpisodeId });
    expect(ids('memory_reflections')).toEqual(
      expect.arrayContaining([seeded.unrelatedMalformedReflectionId]),
    );
    expect(ids('memory_reflections')).not.toContain(seeded.targetReflectionId);
    expect(ids('memory_reflections')).not.toContain(seeded.linkedMalformedReflectionId);

    const workingScopes = getMemoryDb().getAllSync<{ task_id: string | null }>(
      "SELECT task_id FROM memory_working_blocks WHERE label = 'active_focus'",
    );
    expect(workingScopes).toEqual([{ task_id: 'task-other' }]);
    expect(ids('memory_tasks')).toEqual(expect.arrayContaining([TASK_ID, 'task-other']));
    expect(ids('memory_tasks')).toHaveLength(2);
    const remainingJobIds = ids('memory_ingestion_jobs');
    expect(remainingJobIds).toEqual(
      expect.arrayContaining([
        seeded.unrelatedMalformedReceiptJobId,
        seeded.otherThreadJobId,
        seeded.otherKindJobId,
      ]),
    );
    for (const removedJobId of [seeded.targetJobId, seeded.linkedMalformedReceiptJobId]) {
      expect(remainingJobIds).not.toContain(removedJobId);
    }
    expect(ids('memory_ingestion_receipts', 'job_id')).toEqual([
      seeded.unrelatedMalformedReceiptJobId,
    ]);
    expect(
      getMemoryDb().getFirstSync<{
        selected_fact_ids_json: string;
        selected_episode_ids_json: string;
        selected_fact_count: number;
        selected_episode_count: number;
      }>(
        `SELECT selected_fact_ids_json, selected_episode_ids_json,
                selected_fact_count, selected_episode_count
           FROM memory_retrieval_events WHERE id = 'retrieval-target'`,
      ),
    ).toEqual({
      selected_fact_ids_json: JSON.stringify([seeded.collisionFactId]),
      selected_episode_ids_json: JSON.stringify([seeded.otherThreadEpisodeId]),
      selected_fact_count: 2,
      selected_episode_count: 2,
    });
    expect(ids('memory_retrieval_events')).toEqual(
      expect.arrayContaining(['retrieval-target', 'retrieval-unrelated-malformed']),
    );
    expect(ids('memory_retrieval_events')).not.toContain('retrieval-linked-malformed');

    const removedTerms = getMemoryDb().getFirstSync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id IN (?, ?)`,
      seeded.targetFactId,
      seeded.historyFactId,
    );
    expect(removedTerms?.count).toBe(0);
    const expectedStats = getMemoryDb().getAllSync<{
      unit: string;
      memory_kind: string;
      fact_count: number;
      total_weight: number;
    }>(
      `SELECT unit, memory_kind, COUNT(*) AS fact_count, SUM(weight) AS total_weight
         FROM memory_fact_terms GROUP BY unit, memory_kind ORDER BY unit, memory_kind`,
    );
    const actualStats = getMemoryDb().getAllSync<{
      unit: string;
      memory_kind: string;
      fact_count: number;
      total_weight: number;
    }>(
      `SELECT unit, memory_kind, fact_count, total_weight
         FROM memory_fact_term_stats ORDER BY unit, memory_kind`,
    );
    expect(actualStats).toHaveLength(expectedStats.length);
    for (const expected of expectedStats) {
      const actual = actualStats.find(
        (row) => row.unit === expected.unit && row.memory_kind === expected.memory_kind,
      );
      expect(actual?.fact_count).toBe(expected.fact_count);
      expect(actual?.total_weight).toBeCloseTo(expected.total_weight, 12);
    }

    const sourceRows = getMemoryDb().getAllSync<{
      memory_conversation_id: string;
      source_thread_id: string;
      task_id: string;
      source_kind: string;
      source_id: string;
    }>('SELECT * FROM memory_withdrawal_sources');
    expect(sourceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memory_conversation_id: CONVERSATION_ID,
          source_thread_id: THREAD_ID,
          task_id: TASK_ID,
          source_kind: 'message',
          source_id: MESSAGE_ID,
        }),
        expect.objectContaining({ source_kind: 'turn', source_id: TURN_ID }),
        expect.objectContaining({ source_kind: 'run', source_id: RUN_ID }),
      ]),
    );
    expect(
      sourceRows.some((row) => row.source_kind === 'turn' && row.source_id === MESSAGE_ID),
    ).toBe(false);
    expect(
      JSON.stringify(getMemoryDb().getAllSync('SELECT * FROM memory_withdrawals')),
    ).not.toContain(PRIVATE_VALUE);

    const residualProbe = probeMemoryWithdrawalResiduals(getMemoryDb(), {
      factIds: [seeded.targetFactId, seeded.historyFactId],
      retrievalTermStats: [],
      evidenceIds: seeded.evidenceIds,
      observationIds: [],
      episodeIds: [seeded.targetEpisodeId],
      chunkIds: seeded.targetChunkIds,
      reflectionIds: [seeded.targetReflectionId, seeded.linkedMalformedReflectionId],
      workingBlocks: [{ label: 'active_focus', scopeKey: seeded.targetWorkingBlockScopeKey }],
      entityIds: [seeded.orphanEntityId],
      ingestionJobIds: [seeded.targetJobId, seeded.linkedMalformedReceiptJobId],
      ingestionReceiptJobIds: [seeded.targetJobId, seeded.linkedMalformedReceiptJobId],
      affectedScopes: [
        {
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: THREAD_ID,
          taskId: TASK_ID,
        },
      ],
      sources: [
        {
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: THREAD_ID,
          taskId: TASK_ID,
          sourceKind: 'message',
          sourceId: MESSAGE_ID,
        },
        {
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: THREAD_ID,
          taskId: TASK_ID,
          sourceKind: 'turn',
          sourceId: TURN_ID,
        },
      ],
    });
    expect(residualProbe.status).toBe('clear');
    expect(Object.values(residualProbe.counts)).toEqual(
      Array(Object.keys(residualProbe.counts).length).fill(0),
    );
    expect(JSON.stringify(residualProbe)).not.toContain(PRIVATE_VALUE);

    const indirectReplay = withdrawMemoryFact(seeded.historyFactId, 6_000);
    expect(indirectReplay.status).toBe('already_withdrawn');
    if (indirectReplay.status !== 'already_withdrawn') throw new Error('expected replay');
    expect(indirectReplay.receipt.withdrawalId).toBe(result.receipt.withdrawalId);
    expect(indirectReplay.receipt.factId).toBe(seeded.historyFactId);
    expect(indirectReplay.receipt.counts).toEqual(EMPTY_MEMORY_WITHDRAWAL_COUNTS);
    notificationSpy.mockRestore();
  });
});
