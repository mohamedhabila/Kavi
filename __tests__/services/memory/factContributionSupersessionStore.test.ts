jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { persistFactContributionSupersessionsInTransaction } from '../../../src/services/memory/factContributionSupersessionStore';
import { replaceCurrentFactWithContribution } from '../../../src/services/memory/facts/exactReplacement';
import {
  recordFactWithApplicability,
  recordFactWithContribution,
} from '../../../src/services/memory/facts/mutations';
import type { MemoryFact, RecordFactInput } from '../../../src/services/memory/facts/types';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const grounded = { factClass: 'subjective_user', sourceAuthority: 'grounded_user' } as const;

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

function globalFact(
  subjectId: string,
  objectText: string,
  now: number,
  overrides: Partial<RecordFactInput> = {},
): RecordFactInput {
  return {
    subjectId,
    predicate: 'favorite_color',
    objectText,
    scope: 'global',
    sourceMessageId: `message-${now}`,
    now,
    ...overrides,
  };
}

function context(now: number) {
  return {
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: null,
    producer: {
      producerId: 'supersession_store_test',
      producerEventId: `event-${now}`,
    },
    sourceAliases: [{ sourceKind: 'message' as const, sourceId: `message-${now}` }],
  };
}

function contributionIdFor(factId: string): string {
  return getMemoryDb().getFirstSync<{ id: string }>(
    'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
    factId,
  )!.id;
}

function supersessionCounts(): { snapshots: number; edges: number } {
  return {
    snapshots:
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersession_snapshots',
      )?.count ?? 0,
    edges:
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersessions',
      )?.count ?? 0,
  };
}

describe('fact contribution supersession store', () => {
  it('seals one resolved successor snapshot over every predecessor edge', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    recordFactWithApplicability(globalFact(subject.id, 'red', 110), grounded);
    const input = globalFact(subject.id, 'green', 200, {
      pinned: true,
      reviewState: 'verified',
      supersedePrior: true,
    });

    const created = recordFactWithContribution(input, grounded, context(200));

    expect(created).toMatchObject({ status: 'created' });
    expect(created.superseded).toHaveLength(2);
    expect(
      getMemoryDb().getFirstSync(
        `SELECT successor_fact_id, superseded_at, snapshot_version,
                pinned_input_explicit, review_state_input_explicit,
                successor_pinned_baseline, successor_review_state_baseline,
                successor_sensitivity_floor, successor_sensitivity_policy_version
           FROM memory_fact_contribution_supersession_snapshots`,
      ),
    ).toEqual({
      successor_fact_id: created.fact.id,
      superseded_at: 200,
      snapshot_version: 1,
      pinned_input_explicit: 1,
      review_state_input_explicit: 1,
      successor_pinned_baseline: 1,
      successor_review_state_baseline: 'verified',
      successor_sensitivity_floor: created.fact.sensitivity,
      successor_sensitivity_policy_version: 2,
    });
    expect(
      getMemoryDb().getAllSync(
        `SELECT predecessor_fact_id, successor_fact_id, superseded_at
           FROM memory_fact_contribution_supersessions
          ORDER BY predecessor_fact_id ASC`,
      ),
    ).toEqual(
      created.superseded
        .map((predecessor) => ({
          predecessor_fact_id: predecessor.id,
          successor_fact_id: created.fact.id,
          superseded_at: 200,
        }))
        .sort((left, right) => left.predecessor_fact_id.localeCompare(right.predecessor_fact_id)),
    );

    expect(recordFactWithContribution(input, grounded, context(200))).toMatchObject({
      status: 'duplicate',
      fact: { id: created.fact.id },
      superseded: [],
    });
    expect(supersessionCounts()).toEqual({ snapshots: 1, edges: 2 });
  });

  it('validates replay metadata without restoring a mutable successor projection', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, {
        pinned: true,
        reviewState: 'verified',
        supersedePrior: true,
      }),
      grounded,
      context(200),
    );
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 0, review_state = 'rejected', sensitivity = 'restricted'
        WHERE id = ?`,
      created.fact.id,
    );
    const laterProjection: MemoryFact = {
      ...created.fact,
      pinned: false,
      reviewState: 'rejected',
      sensitivity: 'restricted',
    };

    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId: contributionIdFor(created.fact.id),
        contributionStatus: 'replayed',
        successor: laterProjection,
        superseded: [],
        pinnedInputExplicit: true,
        reviewStateInputExplicit: true,
      }),
    ).not.toThrow();
    expect(
      getMemoryDb().getFirstSync(
        `SELECT successor_pinned_baseline, successor_review_state_baseline,
                successor_sensitivity_floor
           FROM memory_fact_contribution_supersession_snapshots`,
      ),
    ).toEqual({
      successor_pinned_baseline: 1,
      successor_review_state_baseline: 'verified',
      successor_sensitivity_floor: created.fact.sensitivity,
    });
  });

  it('rejects a snapshot written by a future sensitivity policy', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, { supersedePrior: true }),
      grounded,
      context(200),
    );
    getMemoryDb().execSync(
      'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_immutable;',
    );
    getMemoryDb().runSync(
      `UPDATE memory_fact_contribution_supersession_snapshots
          SET successor_sensitivity_policy_version = 3`,
    );

    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId: contributionIdFor(created.fact.id),
        contributionStatus: 'replayed',
        successor: created.fact,
        superseded: [],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_snapshot_invalid');
  });

  it('fails admission when explicit projection flags are corrupted to omission', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    recordFactWithContribution(
      globalFact(subject.id, 'green', 200, {
        pinned: true,
        reviewState: 'verified',
        supersedePrior: true,
      }),
      grounded,
      context(200),
    );
    getMemoryDb().execSync(
      'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_immutable;',
    );
    getMemoryDb().runSync(
      `UPDATE memory_fact_contribution_supersession_snapshots
          SET pinned_input_explicit = 0, review_state_input_explicit = 0`,
    );

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_contribution_admission_integrity_failed');
  });

  it('fails admission when a successor drops below its sealed sensitivity floor', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'my password is secret-value', 200, {
        supersedePrior: true,
      }),
      grounded,
      context(200),
    );
    expect(created.fact.sensitivity).toBe('restricted');
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET sensitivity = 'normal'
        WHERE id = ?`,
      created.fact.id,
    );

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_contribution_admission_integrity_failed');
  });

  it('requires the exact sealed edge set when replay supplies predecessors', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    recordFactWithApplicability(globalFact(subject.id, 'red', 110), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, { supersedePrior: true }),
      grounded,
      context(200),
    );
    const contributionId = contributionIdFor(created.fact.id);

    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId,
        contributionStatus: 'replayed',
        successor: created.fact,
        superseded: [created.superseded[0]!],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId,
        contributionStatus: 'replayed',
        successor: created.fact,
        superseded: created.superseded,
        pinnedInputExplicit: true,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');
    expect(supersessionCounts()).toEqual({ snapshots: 1, edges: 2 });
  });

  it('rejects replay after the durable successor becomes inactive', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, { supersedePrior: true }),
      grounded,
      context(200),
    );
    const replay = {
      contributionId: contributionIdFor(created.fact.id),
      contributionStatus: 'replayed' as const,
      successor: created.fact,
      superseded: [],
      pinnedInputExplicit: false,
      reviewStateInputExplicit: false,
    };

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 250, updated_at = 250 WHERE id = ?',
      created.fact.id,
    );
    expect(() => persistFactContributionSupersessionsInTransaction(replay)).toThrow(
      'memory_fact_contribution_replay_target_changed',
    );

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = NULL, deleted_at = 260, updated_at = 260 WHERE id = ?',
      created.fact.id,
    );
    expect(() => persistFactContributionSupersessionsInTransaction(replay)).toThrow(
      'memory_fact_contribution_replay_target_changed',
    );
    expect(supersessionCounts()).toEqual({ snapshots: 1, edges: 1 });
  });

  it('keeps same-value contributions childless and validates their parent on replay', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    const created = recordFactWithContribution(
      globalFact(subject.id, 'blue', 100),
      grounded,
      context(100),
    );
    const contributionId = contributionIdFor(created.fact.id);

    expect(supersessionCounts()).toEqual({ snapshots: 0, edges: 0 });
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId,
        contributionStatus: 'replayed',
        successor: { ...created.fact, createdAt: 101 },
        superseded: [],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_successor_mismatch');
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId,
        contributionStatus: 'replayed',
        successor: created.fact,
        superseded: [],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).not.toThrow();
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        contributionId: `mfc_${'0'.repeat(64)}`,
        contributionStatus: 'replayed',
        successor: created.fact,
        superseded: [],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_successor_mismatch');
  });

  it('rejects malformed flags and predecessor clocks before creating children', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 300),
      grounded,
      context(300),
    );
    const contributionId = contributionIdFor(created.fact.id);
    const base = {
      contributionId,
      contributionStatus: 'created' as const,
      successor: created.fact,
      pinnedInputExplicit: false,
      reviewStateInputExplicit: false,
    };

    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        ...base,
        pinnedInputExplicit: 0 as never,
        superseded: [],
      }),
    ).toThrow('memory_fact_contribution_supersession_projection_intent_invalid');
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        ...base,
        superseded: [
          { id: 'predecessor-a', invalidAt: 300 },
          { id: 'predecessor-b', invalidAt: 301 },
        ],
      }),
    ).toThrow('memory_fact_contribution_supersession_timestamp_mismatch');
    expect(supersessionCounts()).toEqual({ snapshots: 0, edges: 0 });
  });

  it('rolls back a contributed exact replacement collision before ledger persistence', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    const expected = recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const collision = recordFactWithApplicability(globalFact(subject.id, 'green', 110), grounded);

    expect(
      replaceCurrentFactWithContribution(
        {
          ...globalFact(subject.id, 'green', 200),
          expectedCurrentFactId: expected.fact.id,
        },
        grounded,
        context(200),
      ),
    ).toEqual({
      fact: null,
      status: 'conflict',
      superseded: [],
      conflict: 'replacement_collision',
    });
    expect(supersessionCounts()).toEqual({ snapshots: 0, edges: 0 });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getAllSync<{ id: string; invalid_at: number | null }>(
        'SELECT id, invalid_at FROM memory_facts ORDER BY id ASC',
      ),
    ).toEqual([expected.fact.id, collision.fact.id].sort().map((id) => ({ id, invalid_at: null })));
  });
});
