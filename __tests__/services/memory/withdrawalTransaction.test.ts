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
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { EMPTY_MEMORY_WITHDRAWAL_COUNTS } from '../../../src/services/memory/withdrawalTypes';
import { probeMemoryWithdrawalResiduals } from '../../../src/services/memory/withdrawalResidualProbe';
import * as memoryChangeNotifications from '../../../src/services/memory/changeNotifications';
import {
  insertMemoryIngestionReceiptForWithdrawal,
  insertMemoryRetrievalEventForWithdrawal,
  requireMemoryIngestionJob,
} from '../../helpers/memoryWithdrawalFixtures';
import {
  CODE_OWNED_NORMAL_TEST_SENSITIVITY,
  codeOwnedClosedTurnEpisodeFields,
  loadVerifiedFactRetirement,
  recordContributionBackedFact,
} from '../../helpers/memoryRetirementTestFixtures';

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
  replayFactId: string;
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
  targetContributionIds: string[];
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
  overrides: Partial<Parameters<typeof requireMemoryIngestionJob>[0]>,
): NonNullable<ReturnType<typeof requireMemoryIngestionJob>> {
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
  const target = recordContributionBackedFact(
    {
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
    },
    {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      taskId: TASK_ID,
      producerEventId: 'withdrawal-transaction-target',
      sensitivityDeclaration: CODE_OWNED_NORMAL_TEST_SENSITIVITY,
    },
  ).fact;
  const sharedSupport = recordContributionBackedFact(
    {
      subjectId: sharedEntity.id,
      predicate: 'private_preference',
      objectText: PRIVATE_VALUE,
      objectEntityId: orphanEntity.id,
      scope: 'session',
      originConversationId: CONVERSATION_ID,
      originThreadId: THREAD_ID,
      originTaskId: TASK_ID,
      taskId: TASK_ID,
      sourceMessageId: 'message-history',
      sourceTurnId: 'turn-history',
      sourceRunId: 'run-history',
      sourceSummary: PRIVATE_VALUE,
      supersedePrior: false,
      now: 1_001,
    },
    {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      taskId: TASK_ID,
      producerEventId: 'withdrawal-transaction-history',
      sensitivityDeclaration: CODE_OWNED_NORMAL_TEST_SENSITIVITY,
    },
  ).fact;
  if (sharedSupport.id !== target.id) {
    throw new Error('expected contribution-backed canonical fact replay');
  }
  const replayFactId = sharedSupport.id;

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
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: MESSAGE_ID,
      sourceAssistantMessageId: TURN_ID,
      userContent: PRIVATE_VALUE,
      assistantContent: PRIVATE_VALUE,
    }),
    accessPolicy: {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      personaId: 'default',
      taskId: TASK_ID,
      shareability: 'thread_only',
    },
    now: 1_200,
  });
  const otherThreadEpisode = recordEpisode({
    conversationId: CONVERSATION_ID,
    threadId: 'thread-other',
    taskId: TASK_ID,
    summary: 'other thread retained',
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: MESSAGE_ID,
      sourceAssistantMessageId: TURN_ID,
      userContent: 'other thread retained',
      assistantContent: 'other thread retained',
    }),
    accessPolicy: {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: 'thread-other',
      personaId: 'default',
      taskId: TASK_ID,
      shareability: 'thread_only',
    },
    now: 1_210,
  });
  const otherKindEpisode = recordThreadLocalEpisode({
    conversationId: CONVERSATION_ID,
    threadId: THREAD_ID,
    taskId: TASK_ID,
    summary: 'same id in turn-kind retained',
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: 'message-kind-negative',
      sourceAssistantMessageId: MESSAGE_ID,
      userContent: 'same id in turn-kind retained',
      assistantContent: 'same id in turn-kind retained',
    }),
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
  return {
    targetFactId: target.id,
    replayFactId,
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
    targetContributionIds: getMemoryDb()
      .getAllSync<{ id: string }>(
        'SELECT id FROM memory_fact_contributions WHERE fact_id = ? ORDER BY id',
        target.id,
      )
      .map((row) => row.id),
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
  it('purges only authoritative artifacts and seals a content-free retirement receipt', () => {
    const seeded = seedAuthoritativeLineage();
    expect(
      JSON.stringify(
        getMemoryDb().getAllSync(
          `SELECT payload_json FROM memory_fact_contributions
            WHERE id IN (${seeded.targetContributionIds.map(() => '?').join(', ')})`,
          ...seeded.targetContributionIds,
        ),
      ),
    ).toContain(PRIVATE_VALUE);
    const notificationSpy = jest.spyOn(memoryChangeNotifications, 'notifyStructuredMemoryChanged');
    notificationSpy.mockClear();

    const result = withdrawMemoryFact(seeded.targetFactId, 5_000);

    expect(result.status).toBe('withdrawn');
    if (result.status !== 'withdrawn') throw new Error('expected withdrawal');
    expect(result.receipt.counts).toEqual(
      expect.objectContaining({
        facts: 1,
        graphRelations: 1,
        factEvidence: 2,
        episodeAccessPolicies: 1,
        episodes: 1,
        reflections: 2,
        orphanEntities: 1,
        ingestionSourceSnapshots: 2,
        ingestionJobs: 2,
        ingestionReceipts: 2,
        retrievalEvents: 2,
      }),
    );
    expect(JSON.stringify(result)).not.toContain(PRIVATE_VALUE);
    expect(notificationSpy).toHaveBeenLastCalledWith(CONVERSATION_ID);

    expect(ids('memory_facts')).toEqual([seeded.collisionFactId]);
    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_facts WHERE id = ?', seeded.targetFactId),
    ).toBeNull();
    expect(ids('memory_fact_contributions')).toEqual([]);
    expect(ids('memory_retired_fact_contributions', 'contribution_id')).toEqual(
      seeded.targetContributionIds,
    );
    expect(ids('memory_fact_contribution_sources', 'contribution_id')).toEqual([]);
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
    const remainingSnapshotJobIds = ids('memory_ingestion_source_snapshots', 'job_id');
    for (const removedJobId of [seeded.targetJobId, seeded.linkedMalformedReceiptJobId]) {
      expect(remainingSnapshotJobIds).not.toContain(removedJobId);
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
      'SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id = ?',
      seeded.targetFactId,
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

    const verifiedRetirement = loadVerifiedFactRetirement(seeded.targetFactId);
    expect(verifiedRetirement).toMatchObject({
      reason: 'fact_withdrawal',
      retiredFactIds: [seeded.targetFactId],
    });
    expect(verifiedRetirement?.closedSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: THREAD_ID,
          taskId: TASK_ID,
          sourceKind: 'message',
          sourceId: MESSAGE_ID,
        }),
        expect.objectContaining({ sourceKind: 'turn', sourceId: TURN_ID }),
        expect.objectContaining({ sourceKind: 'run', sourceId: RUN_ID }),
        expect.objectContaining({ sourceKind: 'message', sourceId: 'message-history' }),
        expect.objectContaining({ sourceKind: 'turn', sourceId: 'turn-history' }),
        expect.objectContaining({ sourceKind: 'run', sourceId: 'run-history' }),
      ]),
    );
    expect(
      verifiedRetirement?.closedSources.some(
        (source) => source.sourceKind === 'turn' && source.sourceId === MESSAGE_ID,
      ),
    ).toBe(false);
    expect(JSON.stringify(verifiedRetirement)).not.toContain(PRIVATE_VALUE);
    expect(
      JSON.stringify({
        facts: getMemoryDb().getAllSync('SELECT * FROM memory_facts'),
        contributions: getMemoryDb().getAllSync('SELECT * FROM memory_fact_contributions'),
        episodes: getMemoryDb().getAllSync('SELECT * FROM memory_episodes'),
        evidence: getMemoryDb().getAllSync('SELECT * FROM memory_fact_evidence'),
        reflections: getMemoryDb().getAllSync('SELECT * FROM memory_reflections'),
        workingBlocks: getMemoryDb().getAllSync('SELECT * FROM memory_working_blocks'),
        ingestionJobs: getMemoryDb().getAllSync('SELECT * FROM memory_ingestion_jobs'),
        ingestionSnapshots: getMemoryDb().getAllSync(
          'SELECT * FROM memory_ingestion_source_snapshots',
        ),
      }),
    ).not.toContain(PRIVATE_VALUE);

    const residualProbe = probeMemoryWithdrawalResiduals(getMemoryDb(), {
      factIds: [seeded.targetFactId],
      retrievalTermStats: [],
      evidenceIds: seeded.evidenceIds,
      observationIds: [],
      verifiedProcedureObservationIds: [],
      episodeIds: [seeded.targetEpisodeId],
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

    const indirectReplay = withdrawMemoryFact(seeded.replayFactId, 6_000);
    expect(indirectReplay.status).toBe('already_withdrawn');
    if (indirectReplay.status !== 'already_withdrawn') throw new Error('expected replay');
    expect(indirectReplay.receipt.withdrawalId).toBe(result.receipt.withdrawalId);
    expect(indirectReplay.receipt.factId).toBe(seeded.replayFactId);
    expect(indirectReplay.receipt.counts).toEqual(EMPTY_MEMORY_WITHDRAWAL_COUNTS);
    notificationSpy.mockRestore();
  });
});
