jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  getEntityById,
  softDeleteEntity,
  upsertEntity,
} from '../../../src/services/memory/entities';
import { recordEpisode } from '../../../src/services/memory/episodes/mutations';
import {
  raiseScopedMemoryFactSensitivityFloor,
  setManagedMemoryFactPinned,
  setScopedMemoryFactReviewState,
} from '../../../src/services/memory/factExplicitOverrides';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { setFactLocalSimilarity } from '../../../src/services/memory/facts/factAccessMutations';
import { recordMemoryFactObservation } from '../../../src/services/memory/facts/observations';
import { createCurrentLocalSimilarityVector } from '../../../src/services/memory/localSimilarity';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotCurrent,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
  type MemoryAuthoritySnapshot,
} from '../../../src/services/memory/memoryAuthority';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { upsertReflection } from '../../../src/services/memory/reflections';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertMemoryTask } from '../../../src/services/memory/tasks';
import { clearWorkingBlock, editWorkingBlock } from '../../../src/services/memory/workingBlocks';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';

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

function snapshot(): MemoryAuthoritySnapshot {
  const current = captureMemoryAuthoritySnapshot();
  if (!current) throw new Error('expected enabled memory authority');
  return current;
}

function expectProjectionOnly(before: MemoryAuthoritySnapshot): void {
  expect(isMemoryProjectionSnapshotCurrent(before)).toBe(false);
  expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
}

function expectRestrictive(before: MemoryAuthoritySnapshot): void {
  expect(isMemoryProjectionSnapshotCurrent(before)).toBe(false);
  expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(false);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(false);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(false);
}

function expectUnchanged(before: MemoryAuthoritySnapshot): void {
  expect(isMemoryProjectionSnapshotCurrent(before)).toBe(true);
  expect(isMemoryProjectionSnapshotDurablyCurrent(before)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotCurrent(before)).toBe(true);
  expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(before)).toBe(true);
}

describe('memory authority mutation classification', () => {
  it('refreshes for new trusted working state and revokes on replacement or clear', () => {
    const scope = { conversationId: 'محادثة-١', threadId: 'خيط-١', taskId: 'مهمة-١' };
    const beforeInsert = snapshot();
    editWorkingBlock('task_stack', 'قيد التنفيذ: إعداد الرحلة', scope, { now: 10 });
    expectProjectionOnly(beforeInsert);

    const beforeNoOp = snapshot();
    editWorkingBlock('task_stack', 'قيد التنفيذ: إعداد الرحلة', scope, { now: 11 });
    expectUnchanged(beforeNoOp);

    const beforeReplacement = snapshot();
    editWorkingBlock('task_stack', 'مكتمل: إعداد الرحلة', scope, { now: 12 });
    expectRestrictive(beforeReplacement);

    const beforeClear = snapshot();
    expect(clearWorkingBlock('task_stack', scope, 13)).toBe(true);
    expectRestrictive(beforeClear);
  });

  it('refreshes for new facts and ranking changes, then revokes corrections and trust changes', () => {
    const entity = upsertEntity({ name: '利用者', type: 'self', now: 10 });
    const baseInput = {
      subjectId: entity.id,
      predicate: '希望する温度',
      objectText: '二十二度',
      scope: 'global' as const,
      importance: 0.4,
      now: 20,
    };
    const applicability = {
      factClass: 'subjective_user' as const,
      sourceAuthority: 'grounded_user' as const,
    };

    const beforeInsert = snapshot();
    const inserted = recordFactWithApplicability(baseInput, applicability).fact;
    expectProjectionOnly(beforeInsert);

    const beforeRankingChange = snapshot();
    expect(
      recordFactWithApplicability({ ...baseInput, importance: 0.9, now: 21 }, applicability).status,
    ).toBe('duplicate');
    expectProjectionOnly(beforeRankingChange);

    const beforeAdditiveAttribute = snapshot();
    recordFactWithApplicability(
      { ...baseInput, attributes: { وحدة: 'مئوية' }, now: 22 },
      applicability,
    );
    expectProjectionOnly(beforeAdditiveAttribute);

    const beforeAttributeReplacement = snapshot();
    recordFactWithApplicability(
      { ...baseInput, attributes: { وحدة: 'فهرنهايت' }, now: 23 },
      applicability,
    );
    expectRestrictive(beforeAttributeReplacement);

    const beforePin = snapshot();
    setManagedMemoryFactPinned({ factId: inserted.id, pinned: true, now: 24 });
    expectProjectionOnly(beforePin);

    const beforePinNoOp = snapshot();
    setManagedMemoryFactPinned({ factId: inserted.id, pinned: true, now: 25 });
    expectUnchanged(beforePinNoOp);

    const beforeUnpin = snapshot();
    setManagedMemoryFactPinned({ factId: inserted.id, pinned: false, now: 26 });
    expectRestrictive(beforeUnpin);

    const beforeReviewChange = snapshot();
    setScopedMemoryFactReviewState({
      factId: inserted.id,
      currentScope: {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: '会話-一',
        sourceThreadId: '糸-一',
        personaId: 'default',
        taskId: null,
      },
      reviewState: 'verified',
      now: 27,
    });
    expectRestrictive(beforeReviewChange);

    const beforeSensitivityChange = snapshot();
    raiseScopedMemoryFactSensitivityFloor({
      factId: inserted.id,
      currentScope: {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: '会話-一',
        sourceThreadId: '糸-一',
        personaId: 'default',
        taskId: null,
      },
      sensitivityFloor: 'restricted',
      now: 28,
    });
    expectRestrictive(beforeSensitivityChange);

    const beforeCorrection = snapshot();
    const correction = recordFactWithApplicability(
      { ...baseInput, objectText: '二十三度', supersedePrior: true, now: 29 },
      applicability,
    );
    expect(correction.superseded).toHaveLength(1);
    expectRestrictive(beforeCorrection);
  });

  it('refreshes for new episodes and ranking metadata, then revokes semantic replacement', () => {
    const baseEpisode = {
      conversationId: 'conversación-uno',
      threadId: 'hilo-uno',
      taskId: null,
      startedAt: 100,
      endedAt: 110,
      summary: '予約を確認した',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'mensaje-uno',
        sourceAssistantMessageId: 'mensaje-dos',
        userContent: '予約を確認して。',
        assistantContent: '予約を確認した。',
      }),
      importance: 0.4,
      accessPolicy: {
        memoryConversationId: 'conversación-uno',
        sourceThreadId: 'hilo-uno',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only' as const,
      },
    };

    const beforeInsert = snapshot();
    expect(recordEpisode({ ...baseEpisode, now: 120 })).not.toBeNull();
    expectProjectionOnly(beforeInsert);

    const beforeRankingChange = snapshot();
    expect(recordEpisode({ ...baseEpisode, importance: 0.9, now: 121 })).not.toBeNull();
    expectProjectionOnly(beforeRankingChange);

    const beforeRankingDecrease = snapshot();
    expect(recordEpisode({ ...baseEpisode, importance: 0.8, now: 122 })).not.toBeNull();
    expectRestrictive(beforeRankingDecrease);

    const beforeEmbeddingAddition = snapshot();
    expect(
      recordEpisode({ ...baseEpisode, importance: 0.8, embedding: [0.1, 0.2], now: 123 }),
    ).not.toBeNull();
    expectProjectionOnly(beforeEmbeddingAddition);

    const beforeEmbeddingReplacement = snapshot();
    expect(
      recordEpisode({ ...baseEpisode, importance: 0.8, embedding: [0.2, 0.1], now: 124 }),
    ).not.toBeNull();
    expectRestrictive(beforeEmbeddingReplacement);

    const beforeReplacement = snapshot();
    expect(
      recordEpisode({
        ...baseEpisode,
        summary: '予約を取り消した',
        importance: 0.8,
        embedding: [0.2, 0.1],
        now: 125,
      }),
    ).not.toBeNull();
    expectRestrictive(beforeReplacement);
  });

  it('refreshes supporting evidence and revokes conflicting evidence', () => {
    const fact = recordFactWithApplicability(
      {
        subjectId: 'entité-utilisateur',
        predicate: 'préférence',
        objectText: 'thé vert',
        scope: 'conversation',
        originConversationId: 'conversation-fr',
        originThreadId: 'fil-fr',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    const sourceScope = {
      memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
      memoryConversationId: 'conversation-fr',
      sourceThreadId: 'fil-fr',
      personaId: 'default',
      taskId: null,
    };

    const beforeSupport = snapshot();
    recordMemoryFactObservation(
      {
        factId: fact.id,
        relation: 'supports',
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        sourceKind: 'user_message',
        sourceId: 'message-appui',
        sourceScope,
        observedAt: 110,
        createdAt: 111,
      },
      111,
    );
    expectProjectionOnly(beforeSupport);

    const beforeConflict = snapshot();
    recordMemoryFactObservation(
      {
        factId: fact.id,
        relation: 'conflicts',
        factClass: 'subjective_user',
        sourceAuthority: 'grounded_user',
        sourceKind: 'user_message',
        sourceId: 'message-conflit',
        sourceScope,
        observedAt: 112,
        createdAt: 113,
      },
      113,
    );
    expectRestrictive(beforeConflict);
  });

  it('refreshes for a first local similarity vector and revokes vector replacement', () => {
    const fact = recordFactWithApplicability(
      {
        subjectId: 'persona-local',
        predicate: 'preferencia',
        objectText: 'té azul',
        scope: 'global',
        now: 200,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;
    const initialVector = createCurrentLocalSimilarityVector('preferencia té azul');
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_model = NULL,
              local_similarity_dimensions = NULL,
              local_similarity_vector = NULL,
              local_similarity_updated_at = NULL
        WHERE id = ?`,
      fact.id,
    );

    const beforeInitialVector = snapshot();
    expect(setFactLocalSimilarity(fact.id, initialVector, 201)).toBe(true);
    expectProjectionOnly(beforeInitialVector);

    const beforeTimestampRefresh = snapshot();
    expect(setFactLocalSimilarity(fact.id, initialVector, 202)).toBe(true);
    expectUnchanged(beforeTimestampRefresh);

    const beforeExactNoOp = snapshot();
    expect(setFactLocalSimilarity(fact.id, initialVector, 202)).toBe(false);
    expectUnchanged(beforeExactNoOp);

    const beforeVectorReplacement = snapshot();
    expect(
      setFactLocalSimilarity(
        fact.id,
        createCurrentLocalSimilarityVector('preferencia café negro'),
        203,
      ),
    ).toBe(true);
    expectRestrictive(beforeVectorReplacement);
  });

  it('refreshes new reflections and tasks, then revokes semantic replacements', () => {
    const beforeReflection = snapshot();
    upsertReflection({
      scope: 'thread',
      threadId: 'خيط-انعكاس',
      periodStart: 0,
      periodEnd: 100,
      kind: 'daily_focus',
      content: 'التركيز على إعداد الوثائق',
      sourceEpisodeIds: [],
      sourceFactIds: [],
      now: 50,
    });
    expectProjectionOnly(beforeReflection);

    const beforeReflectionReplacement = snapshot();
    upsertReflection({
      scope: 'thread',
      threadId: 'خيط-انعكاس',
      periodStart: 0,
      periodEnd: 100,
      kind: 'daily_focus',
      content: 'التركيز على مراجعة الوثائق',
      sourceEpisodeIds: [],
      sourceFactIds: [],
      now: 51,
    });
    expectRestrictive(beforeReflectionReplacement);

    const beforeTask = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      now: 60,
    });
    expectProjectionOnly(beforeTask);

    const beforeTaskNoOp = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      now: 61,
    });
    expectUnchanged(beforeTaskNoOp);

    const beforeTaskEmbedding = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      embedding: [0.1, 0.2],
      now: 62,
    });
    expectProjectionOnly(beforeTaskEmbedding);

    const beforeTaskEmbeddingReplacement = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      embedding: [0.2, 0.1],
      now: 63,
    });
    expectRestrictive(beforeTaskEmbeddingReplacement);

    const beforeTaskConfidenceIncrease = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      embedding: [0.2, 0.1],
      confidence: 0.8,
      now: 64,
    });
    expectProjectionOnly(beforeTaskConfidenceIncrease);

    const beforeTaskConfidenceDecrease = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      embedding: [0.2, 0.1],
      confidence: 0.7,
      now: 65,
    });
    expectRestrictive(beforeTaskConfidenceDecrease);

    const beforeTaskReplacement = snapshot();
    upsertMemoryTask({
      id: 'задача-один',
      threadId: 'поток-один',
      title: 'Подготовить поездку',
      state: 'completed',
      embedding: [0.2, 0.1],
      confidence: 0.7,
      now: 66,
    });
    expectRestrictive(beforeTaskReplacement);
  });

  it('refreshes entity names and aliases, ignores private metadata, and revokes deletion', () => {
    const beforeCreate = snapshot();
    const entity = upsertEntity({ name: 'مشروع سري', type: 'project', now: 10 });
    expectProjectionOnly(beforeCreate);

    const beforeAlias = snapshot();
    upsertEntity({
      name: 'مشروع سري',
      type: 'project',
      aliases: ['الاسم البديل'],
      now: 11,
    });
    expectProjectionOnly(beforeAlias);

    const beforePrivateMetadata = snapshot();
    upsertEntity({
      name: 'مشروع سري',
      type: 'project',
      attributes: { local_note: 'لا يدخل الاسترجاع' },
      now: 12,
    });
    expectUnchanged(beforePrivateMetadata);

    const beforeDelete = snapshot();

    expect(softDeleteEntity(entity.id, 13)).toBe(true);
    expect(getEntityById(entity.id)).toBeNull();
    expectRestrictive(beforeDelete);

    const beforeNoOp = snapshot();
    expect(softDeleteEntity(entity.id, 14)).toBe(false);
    expectUnchanged(beforeNoOp);
  });
});
