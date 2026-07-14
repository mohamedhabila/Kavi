jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { loadVerifiedFactContributionAggregatesInTransaction } from '../../../src/services/memory/factContributionAggregateStore';
import { recordFactWithContribution } from '../../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { planExactSourceRetirement } from '../../../src/services/memory/sourceRetirementPlanner';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const CONVERSATION_ID = 'retirement-explicit-conversation';
const THREAD_ID = 'retirement-explicit-thread';

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  jest.restoreAllMocks();
});

function contributionIds(factId: string): string[] {
  return getMemoryDb()
    .getAllSync<{ id: string }>(
      'SELECT id FROM memory_fact_contributions WHERE fact_id = ? ORDER BY contributed_at, id',
      factId,
    )
    .map(({ id }) => id);
}

function recordDuplicate(index: number, subjectId: string, expectedFactId?: string): string {
  const result = recordFactWithContribution(
    {
      subjectId,
      predicate: 'duplicate_explicit_state',
      objectText: 'shared-value',
      scope: 'global',
      attributes: { [`layer${index}`]: true },
      sourceMessageId: `retirement-explicit-message-${index}`,
      now: 100 * index,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId: CONVERSATION_ID,
      sourceThreadId: THREAD_ID,
      taskId: null,
      producer: {
        producerId: 'retirement_explicit_test',
        producerEventId: `event-${index}`,
      },
      sourceAliases: [{ sourceKind: 'message', sourceId: `retirement-explicit-message-${index}` }],
    },
  );
  if (expectedFactId && result.fact.id !== expectedFactId) {
    throw new Error('duplicate fact did not converge');
  }
  return result.fact.id;
}

function duplicatePair(): { factId: string; contributionIds: string[] } {
  const subject = upsertEntity({ type: 'self', name: 'retirement-explicit-user', now: 1 });
  const factId = recordDuplicate(1, subject.id);
  recordDuplicate(2, subject.id, factId);
  return { factId, contributionIds: contributionIds(factId) };
}

function insertExplicitOverride(input: {
  factId: string;
  pinnedOverride?: boolean;
  reviewStateOverride?: 'verified' | 'rejected';
  sensitivityFloor?: 'sensitive' | 'restricted';
  explicitInvalidatedAt?: number;
}): void {
  const clocks = [
    input.pinnedOverride === undefined ? null : 300,
    input.reviewStateOverride === undefined ? null : 310,
    input.sensitivityFloor === undefined ? null : 320,
  ] as const;
  const updatedAt = Math.max(
    input.explicitInvalidatedAt ?? 0,
    ...clocks.map((clock) => clock ?? 0),
  );
  const createdAt = Math.min(
    ...clocks.filter((clock): clock is number => clock !== null),
    updatedAt,
  );
  const db = getMemoryDb();
  db.runSync(
    `UPDATE memory_facts
        SET pinned = COALESCE(?, pinned), review_state = COALESCE(?, review_state),
            sensitivity = COALESCE(?, sensitivity),
            invalid_at = COALESCE(?, invalid_at), updated_at = MAX(updated_at, ?)
      WHERE id = ?`,
    input.pinnedOverride === undefined ? null : input.pinnedOverride ? 1 : 0,
    input.reviewStateOverride ?? null,
    input.sensitivityFloor ?? null,
    input.explicitInvalidatedAt ?? null,
    updatedAt,
    input.factId,
  );
  db.runSync(
    `INSERT INTO memory_fact_explicit_overrides(
       fact_id, memory_owner_id, pinned_override, pinned_at,
       review_state_override, review_state_at, sensitivity_floor,
       sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.factId,
    getLocalMemoryVaultOwnerId(db),
    input.pinnedOverride === undefined ? null : input.pinnedOverride ? 1 : 0,
    clocks[0],
    input.reviewStateOverride ?? null,
    clocks[1],
    input.sensitivityFloor ?? null,
    clocks[2],
    input.explicitInvalidatedAt ?? null,
    createdAt,
    updatedAt,
  );
}

function planPair(input: { factId: string; contributionIds: string[] }) {
  const activeAggregates = loadVerifiedFactContributionAggregatesInTransaction(
    getMemoryDb(),
    input.contributionIds,
  ).aggregates;
  return planExactSourceRetirement({
    requestedSources: [
      {
        memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
        memoryConversationId: CONVERSATION_ID,
        sourceThreadId: THREAD_ID,
        taskId: '',
        sourceKind: 'message',
        sourceId: 'retirement-explicit-message-1',
      },
    ],
    activeAggregates,
  });
}

describe('source retirement explicit projection', () => {
  it('preserves explicit pin, review, and sensitivity on partial rematerialization', () => {
    const pair = duplicatePair();
    insertExplicitOverride({
      factId: pair.factId,
      pinnedOverride: true,
      reviewStateOverride: 'verified',
      sensitivityFloor: 'sensitive',
    });

    expect(planPair(pair).rematerializations[0]).toMatchObject({
      factId: pair.factId,
      explicitInvalidatedAt: null,
      projection: {
        pinned: true,
        reviewState: 'verified',
        sensitivity: 'sensitive',
      },
    });
  });

  it('rematerializes partial content without clearing explicit invalidation', () => {
    const pair = duplicatePair();
    insertExplicitOverride({
      factId: pair.factId,
      pinnedOverride: true,
      reviewStateOverride: 'rejected',
      sensitivityFloor: 'restricted',
      explicitInvalidatedAt: 330,
    });

    const plan = planPair(pair);
    expect(plan.reactivations).toEqual([]);
    expect(plan.rematerializations[0]).toMatchObject({
      factId: pair.factId,
      explicitInvalidatedAt: 330,
      projection: {
        pinned: true,
        reviewState: 'rejected',
        sensitivity: 'restricted',
      },
    });
  });

  it('does not reactivate when explicit invalidation collides with a retired edge timestamp', () => {
    const subject = upsertEntity({ type: 'self', name: 'retirement-collision-user', now: 1 });
    const predecessor = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'collision_state',
        objectText: 'before',
        scope: 'global',
        sourceMessageId: 'retirement-explicit-message-1',
        now: 100,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      {
        memoryConversationId: CONVERSATION_ID,
        sourceThreadId: THREAD_ID,
        taskId: null,
        producer: { producerId: 'retirement_explicit_test', producerEventId: 'collision-1' },
        sourceAliases: [{ sourceKind: 'message', sourceId: 'retirement-explicit-message-1' }],
      },
    );
    const successor = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'collision_state',
        objectText: 'after',
        scope: 'global',
        sourceMessageId: 'retirement-explicit-message-2',
        supersedePrior: true,
        now: 200,
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
      {
        memoryConversationId: CONVERSATION_ID,
        sourceThreadId: THREAD_ID,
        taskId: null,
        producer: { producerId: 'retirement_explicit_test', producerEventId: 'collision-2' },
        sourceAliases: [{ sourceKind: 'message', sourceId: 'retirement-explicit-message-2' }],
      },
    );
    insertExplicitOverride({ factId: predecessor.fact.id, explicitInvalidatedAt: 200 });
    const ids = [...contributionIds(predecessor.fact.id), ...contributionIds(successor.fact.id)];
    const activeAggregates = loadVerifiedFactContributionAggregatesInTransaction(
      getMemoryDb(),
      ids,
    ).aggregates;
    const plan = planExactSourceRetirement({
      requestedSources: [
        {
          memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
          memoryConversationId: CONVERSATION_ID,
          sourceThreadId: THREAD_ID,
          taskId: '',
          sourceKind: 'message',
          sourceId: 'retirement-explicit-message-2',
        },
      ],
      activeAggregates,
    });

    expect(plan.reactivations).toEqual([]);
    expect(plan.survivors.map(({ factId }) => factId)).toContain(predecessor.fact.id);
  });

  it('keeps the no-override projection unchanged', () => {
    const pair = duplicatePair();
    const rematerialization = planPair(pair).rematerializations[0]!;

    expect(rematerialization.explicitInvalidatedAt).toBeNull();
    expect(rematerialization.projection).toMatchObject({
      pinned: false,
      reviewState: 'auto',
      sensitivity: 'normal',
    });
  });

  it('rejects different explicit intent for contributions that share one fact', () => {
    const pair = duplicatePair();
    insertExplicitOverride({ factId: pair.factId, pinnedOverride: true });
    const loaded = loadVerifiedFactContributionAggregatesInTransaction(
      getMemoryDb(),
      pair.contributionIds,
    ).aggregates;

    expect(() =>
      planExactSourceRetirement({
        requestedSources: [
          {
            memoryOwnerId: getLocalMemoryVaultOwnerId(getMemoryDb()),
            memoryConversationId: CONVERSATION_ID,
            sourceThreadId: THREAD_ID,
            taskId: '',
            sourceKind: 'message',
            sourceId: 'retirement-explicit-message-1',
          },
        ],
        activeAggregates: [
          loaded[0]!,
          {
            ...loaded[1]!,
            explicitProjection: {
              pinnedOverride: false,
              reviewStateOverride: null,
              sensitivityFloor: null,
              explicitInvalidatedAt: null,
            },
          },
        ],
      }),
    ).toThrow('memory_source_retirement_plan_aggregate_invalid');
  });
});
