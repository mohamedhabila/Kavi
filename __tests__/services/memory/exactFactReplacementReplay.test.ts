jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  invalidateManagedMemoryFact,
  raiseScopedMemoryFactSensitivityFloor,
  setManagedMemoryFactPinned,
  setScopedMemoryFactReviewState,
} from '../../../src/services/memory/factExplicitOverrides';
import { loadFactExplicitOverrideInTransaction } from '../../../src/services/memory/factExplicitOverrideState';
import type { MemoryFactContributionWriteContext } from '../../../src/services/memory/factContributionStore';
import { replaceCurrentFactWithContribution } from '../../../src/services/memory/facts/exactReplacement';
import { recordFactWithContribution } from '../../../src/services/memory/facts/mutations';
import type {
  MemoryFact,
  RecordFactInput,
  ReplaceCurrentFactInput,
} from '../../../src/services/memory/facts/types';
import { resolveLocalMemoryAccessScope } from '../../../src/services/memory/memoryScopeStore';
import {
  clearStructuredMemory,
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
  clearStructuredMemory();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function globalFact(
  subjectId: string,
  objectText: string,
  sourceNumber: number,
  overrides: Partial<RecordFactInput> = {},
): RecordFactInput {
  return {
    subjectId,
    predicate: 'favorite_color',
    objectText,
    attributes: { sourceNumber },
    scope: 'global',
    sourceMessageId: `user-message-${sourceNumber}`,
    sourceTurnId: `assistant-turn-${sourceNumber}`,
    now: sourceNumber * 100,
    ...overrides,
  };
}

function contributionContext(
  producerEventId: string,
  sourceNumber: number,
): MemoryFactContributionWriteContext {
  return {
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: null,
    producer: { producerId: 'exact_replacement_replay_test', producerEventId },
    sourceAliases: [
      { sourceKind: 'message', sourceId: `user-message-${sourceNumber}` },
      { sourceKind: 'turn', sourceId: `assistant-turn-${sourceNumber}` },
    ],
  };
}

function rowCounts(): {
  facts: number;
  contributions: number;
  snapshots: number;
  edges: number;
} {
  const db = getMemoryDb();
  const count = (table: string): number =>
    db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0;
  return {
    facts: count('memory_facts'),
    contributions: count('memory_fact_contributions'),
    snapshots: count('memory_fact_contribution_supersession_snapshots'),
    edges: count('memory_fact_contribution_supersessions'),
  };
}

interface SeededReplacement {
  predecessor: MemoryFact;
  successor: MemoryFact;
  replacementInput: ReplaceCurrentFactInput;
  replacementContext: MemoryFactContributionWriteContext;
}

function seedChangedReplacement(
  overrides: Partial<ReplaceCurrentFactInput> = {},
): SeededReplacement {
  const subjectId = upsertEntity({ type: 'self', name: 'user', now: 1 }).id;
  const predecessor = recordFactWithContribution(
    globalFact(subjectId, 'blue', 1, { pinned: true, reviewState: 'verified' }),
    grounded,
    contributionContext('predecessor-event', 1),
  ).fact;
  const replacementInput: ReplaceCurrentFactInput = {
    ...globalFact(subjectId, 'green', 2, {
      attributes: { replacement: true },
      confidence: 0.7,
      importance: 0.6,
      pinned: true,
      reviewState: 'verified',
    }),
    expectedCurrentFactId: predecessor.id,
    ...overrides,
  };
  const replacementContext = contributionContext('replacement-event', 2);
  const replacement = replaceCurrentFactWithContribution(
    replacementInput,
    grounded,
    replacementContext,
  );
  if (replacement.status === 'conflict') {
    throw new Error(`seed replacement failed: ${replacement.conflict}`);
  }
  expect(replacement.status).toBe('created');
  return {
    predecessor,
    successor: replacement.fact,
    replacementInput,
    replacementContext,
  };
}

describe('contributed exact replacement replay', () => {
  it.each(['predecessor', 'successor'] as const)(
    'replays from the original %s endpoint without creating durable children',
    (expectedEndpoint) => {
      const seeded = seedChangedReplacement();
      const countsBeforeReplay = rowCounts();
      const expectedCurrentFactId =
        expectedEndpoint === 'predecessor' ? seeded.predecessor.id : seeded.successor.id;

      const replay = replaceCurrentFactWithContribution(
        { ...seeded.replacementInput, expectedCurrentFactId },
        grounded,
        seeded.replacementContext,
      );

      expect(replay).toMatchObject({
        status: 'duplicate',
        fact: { id: seeded.successor.id },
        superseded: [],
      });
      expect(rowCounts()).toEqual(countsBeforeReplay);
    },
  );

  it('inherits canonical predecessor overrides instead of a drifted row projection', () => {
    const subjectId = upsertEntity({ type: 'self', name: 'user', now: 1 }).id;
    const predecessor = recordFactWithContribution(
      globalFact(subjectId, 'blue', 1, { pinned: true }),
      grounded,
      contributionContext('predecessor-event', 1),
    ).fact;
    const currentScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
    });
    setManagedMemoryFactPinned({ factId: predecessor.id, pinned: false, now: 120 });
    setScopedMemoryFactReviewState({
      factId: predecessor.id,
      currentScope,
      reviewState: 'verified',
      now: 130,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: predecessor.id,
      currentScope,
      sensitivityFloor: 'sensitive',
      now: 140,
    });
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1, review_state = 'rejected', sensitivity = 'normal'
        WHERE id = ?`,
      predecessor.id,
    );

    const replacement = replaceCurrentFactWithContribution(
      {
        ...globalFact(subjectId, 'green', 2),
        expectedCurrentFactId: predecessor.id,
      },
      grounded,
      contributionContext('replacement-event', 2),
    );

    expect(replacement).toMatchObject({
      status: 'created',
      fact: { pinned: false, reviewState: 'verified', sensitivity: 'sensitive' },
    });
    if (replacement.status === 'conflict') throw new Error('unexpected replacement conflict');
    expect(
      getMemoryDb().getFirstSync(
        `SELECT successor_fact_id, successor_pinned_baseline,
                successor_review_state_baseline, successor_sensitivity_floor
           FROM memory_fact_contribution_supersession_snapshots`,
      ),
    ).toEqual({
      successor_fact_id: replacement.fact.id,
      successor_pinned_baseline: 0,
      successor_review_state_baseline: 'verified',
      successor_sensitivity_floor: 'sensitive',
    });
    expect(
      getMemoryDb().getFirstSync(
        'SELECT pinned, review_state, sensitivity FROM memory_facts WHERE id = ?',
        predecessor.id,
      ),
    ).toEqual({ pinned: 0, review_state: 'verified', sensitivity: 'sensitive' });
  });

  it('seals explicit false and auto intent without treating either as omission', () => {
    const seeded = seedChangedReplacement({ pinned: false, reviewState: 'auto' });
    expect(seeded.successor).toMatchObject({ pinned: false, reviewState: 'auto' });
    expect(
      getMemoryDb().getFirstSync(
        `SELECT pinned_input_explicit, review_state_input_explicit,
                successor_pinned_baseline, successor_review_state_baseline
           FROM memory_fact_contribution_supersession_snapshots`,
      ),
    ).toEqual({
      pinned_input_explicit: 1,
      review_state_input_explicit: 1,
      successor_pinned_baseline: 0,
      successor_review_state_baseline: 'auto',
    });

    getMemoryDb().runSync(
      "UPDATE memory_facts SET pinned = 1, review_state = 'rejected' WHERE id = ?",
      seeded.successor.id,
    );
    expect(
      replaceCurrentFactWithContribution(
        seeded.replacementInput,
        grounded,
        seeded.replacementContext,
      ),
    ).toMatchObject({
      status: 'duplicate',
      fact: { pinned: false, reviewState: 'rejected' },
      superseded: [],
    });
  });

  it('repairs the sealed pin while preserving later caution, aggregates, and clocks', () => {
    const seeded = seedChangedReplacement();
    recordFactWithContribution(
      globalFact(seeded.successor.subjectId, 'green', 3, {
        attributes: { note: 'The medical history was reviewed.' },
        confidence: 0.95,
        importance: 0.9,
        reviewState: 'rejected',
      }),
      grounded,
      contributionContext('later-duplicate-event', 3),
    );
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 0, sensitivity = 'normal', access_count = 7,
              last_recalled_at = 310, last_accessed_at = 320,
              last_presented_at = 330, updated_at = 340
        WHERE id = ?`,
      seeded.successor.id,
    );
    const stableBeforeReplay = getMemoryDb().getFirstSync(
      `SELECT attributes, confidence, importance, access_count, repeated_mention_count,
              last_recalled_at, last_reinforced_at, last_accessed_at, last_presented_at,
              last_confirmed_at, last_conflicted_at, retrievability, stability, decay_rate,
              valid_at, created_at, updated_at, expires_at
         FROM memory_facts
        WHERE id = ?`,
      seeded.successor.id,
    );
    const countsBeforeReplay = rowCounts();

    const replay = replaceCurrentFactWithContribution(
      seeded.replacementInput,
      grounded,
      seeded.replacementContext,
    );

    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: {
        id: seeded.successor.id,
        pinned: true,
        reviewState: 'rejected',
        sensitivity: 'sensitive',
      },
    });
    expect(
      getMemoryDb().getFirstSync(
        `SELECT attributes, confidence, importance, access_count, repeated_mention_count,
                last_recalled_at, last_reinforced_at, last_accessed_at, last_presented_at,
                last_confirmed_at, last_conflicted_at, retrievability, stability, decay_rate,
                valid_at, created_at, updated_at, expires_at
           FROM memory_facts
          WHERE id = ?`,
        seeded.successor.id,
      ),
    ).toEqual(stableBeforeReplay);
    expect(rowCounts()).toEqual(countsBeforeReplay);
  });

  it('reapplies canonical successor overrides during replay', () => {
    const seeded = seedChangedReplacement();
    const currentScope = resolveLocalMemoryAccessScope({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      personaId: 'default',
      taskId: null,
    });
    setManagedMemoryFactPinned({ factId: seeded.successor.id, pinned: false, now: 250 });
    setScopedMemoryFactReviewState({
      factId: seeded.successor.id,
      currentScope,
      reviewState: 'rejected',
      now: 260,
    });
    raiseScopedMemoryFactSensitivityFloor({
      factId: seeded.successor.id,
      currentScope,
      sensitivityFloor: 'restricted',
      now: 270,
    });
    const canonicalOverrides = loadFactExplicitOverrideInTransaction(seeded.successor.id);
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET pinned = 1, review_state = 'auto', sensitivity = 'normal'
        WHERE id = ?`,
      seeded.successor.id,
    );

    const replay = replaceCurrentFactWithContribution(
      seeded.replacementInput,
      grounded,
      seeded.replacementContext,
    );

    expect(replay).toMatchObject({
      status: 'duplicate',
      fact: {
        id: seeded.successor.id,
        pinned: false,
        reviewState: 'rejected',
        sensitivity: 'restricted',
      },
    });
    expect(loadFactExplicitOverrideInTransaction(seeded.successor.id)).toEqual(canonicalOverrides);
  });

  it('notifies only when replay repairs the active successor projection', () => {
    const seeded = seedChangedReplacement();
    const listener = jest.fn();
    const unsubscribe = subscribeToMemoryChanges(listener);
    try {
      replaceCurrentFactWithContribution(
        seeded.replacementInput,
        grounded,
        seeded.replacementContext,
      );
      expect(listener).not.toHaveBeenCalled();

      getMemoryDb().runSync('UPDATE memory_facts SET pinned = 0 WHERE id = ?', seeded.successor.id);
      replaceCurrentFactWithContribution(
        seeded.replacementInput,
        grounded,
        seeded.replacementContext,
      );
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('fails closed when the durable successor was invalidated and never resurrects it', () => {
    const seeded = seedChangedReplacement();
    invalidateManagedMemoryFact({ factId: seeded.successor.id, now: 300 });
    const countsBeforeReplay = rowCounts();

    expect(
      replaceCurrentFactWithContribution(
        seeded.replacementInput,
        grounded,
        seeded.replacementContext,
      ),
    ).toMatchObject({ status: 'conflict', conflict: 'target_changed' });
    expect(
      getMemoryDb().getFirstSync(
        'SELECT invalid_at, deleted_at FROM memory_facts WHERE id = ?',
        seeded.successor.id,
      ),
    ).toEqual({ invalid_at: 300, deleted_at: null });
    expect(rowCounts()).toEqual(countsBeforeReplay);
  });

  it('rejects changed payload at the same producer identity without mutating history', () => {
    const seeded = seedChangedReplacement();
    const countsBeforeReplay = rowCounts();
    const rowsBeforeReplay = getMemoryDb().getAllSync(
      `SELECT id, object_text, invalid_at, deleted_at
         FROM memory_facts
        ORDER BY created_at ASC, id ASC`,
    );

    expect(() =>
      replaceCurrentFactWithContribution(
        { ...seeded.replacementInput, objectText: 'purple' },
        grounded,
        seeded.replacementContext,
      ),
    ).toThrow('memory_fact_contribution_replay_mismatch');
    expect(rowCounts()).toEqual(countsBeforeReplay);
    expect(
      getMemoryDb().getAllSync(
        `SELECT id, object_text, invalid_at, deleted_at
           FROM memory_facts
          ORDER BY created_at ASC, id ASC`,
      ),
    ).toEqual(rowsBeforeReplay);
  });
});
