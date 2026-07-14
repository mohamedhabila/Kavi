jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { decodeMemoryFactContributionPayload } from '../../../src/services/memory/factContributionCodec';
import {
  assertFactContributionSupersessionReplayInTransaction,
  loadVerifiedFactContributionSupersessionPlanInTransaction,
  prepareFactContributionSupersessionPlanInTransaction,
  type FactContributionSupersessionParentMetadata,
  type FactContributionSupersessionSemantics,
} from '../../../src/services/memory/factContributionSupersessionStore';
import { replaceCurrentFactWithContribution } from '../../../src/services/memory/facts/exactReplacement';
import {
  recordFactWithApplicability,
  recordFactWithContribution,
} from '../../../src/services/memory/facts/mutations';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
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

interface ContributionParentRow {
  id: string;
  fact_id: string;
  memory_owner_id: string;
  contributed_at: number;
  payload_version: number;
  payload_json: string;
  payload_sha256: string;
  payload_byte_length: number;
  supersession_set_version: number;
  supersession_set_count: number;
  supersession_set_sha256: string;
}

function contributionParent(contributionId: string): {
  parent: FactContributionSupersessionParentMetadata;
  commitment: { version: 1; count: number; sha256: string };
} {
  const row = getMemoryDb().getFirstSync<ContributionParentRow>(
    'SELECT * FROM memory_fact_contributions WHERE id = ? LIMIT 1',
    contributionId,
  );
  if (!row || row.supersession_set_version !== 1) throw new Error('test contribution missing');
  return {
    parent: {
      contributionId: row.id,
      factId: row.fact_id,
      memoryOwnerId: row.memory_owner_id,
      contributedAt: row.contributed_at,
      payload: decodeMemoryFactContributionPayload({
        payloadVersion: row.payload_version,
        payloadJson: row.payload_json,
        payloadSha256: row.payload_sha256,
        payloadByteLength: row.payload_byte_length,
      }),
    },
    commitment: {
      version: 1,
      count: row.supersession_set_count,
      sha256: row.supersession_set_sha256,
    },
  };
}

function assertSupersessionReplay(
  contributionId: string,
  semantics: FactContributionSupersessionSemantics,
): void {
  const { commitment, parent } = contributionParent(contributionId);
  const plan = loadVerifiedFactContributionSupersessionPlanInTransaction({
    contributionId,
    commitment,
  });
  assertFactContributionSupersessionReplayInTransaction({ parent, plan, semantics });
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
    expect(() =>
      assertSupersessionReplay(contributionIdFor(created.fact.id), {
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
      assertSupersessionReplay(contributionIdFor(created.fact.id), {
        superseded: [],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_commitment_mismatch');
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
      assertSupersessionReplay(contributionId, {
        superseded: [created.superseded[0]!],
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');
    expect(() =>
      assertSupersessionReplay(contributionId, {
        superseded: created.superseded,
        pinnedInputExplicit: true,
        reviewStateInputExplicit: false,
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');
    expect(supersessionCounts()).toEqual({ snapshots: 1, edges: 2 });
  });

  it('replays opaque predecessor ids in canonical ordinal order', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    const first = recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded).fact;
    const second = recordFactWithApplicability(globalFact(subject.id, 'red', 110), grounded).fact;
    const supplementaryId = 'fact_\u{10000}';
    const bmpId = 'fact_\uFFFD';
    getMemoryDb().runSync('UPDATE memory_facts SET id = ? WHERE id = ?', supplementaryId, first.id);
    getMemoryDb().runSync('UPDATE memory_facts SET id = ? WHERE id = ?', bmpId, second.id);

    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, { supersedePrior: true }),
      grounded,
      context(200),
    );
    expect(created.superseded.map((fact) => fact.id).sort()).toEqual(
      [supplementaryId, bmpId].sort(),
    );
    expect(() =>
      assertSupersessionReplay(contributionIdFor(created.fact.id), {
        superseded: created.superseded,
        pinnedInputExplicit: false,
        reviewStateInputExplicit: false,
      }),
    ).not.toThrow();
  });

  it('rejects replay after the durable successor becomes inactive', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    recordFactWithApplicability(globalFact(subject.id, 'blue', 100), grounded);
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 200, { supersedePrior: true }),
      grounded,
      context(200),
    );
    const contributionId = contributionIdFor(created.fact.id);
    const semantics = {
      superseded: [],
      pinnedInputExplicit: false,
      reviewStateInputExplicit: false,
    };

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = 250, updated_at = 250 WHERE id = ?',
      created.fact.id,
    );
    expect(() => assertSupersessionReplay(contributionId, semantics)).toThrow(
      'memory_fact_contribution_replay_target_changed',
    );

    getMemoryDb().runSync(
      'UPDATE memory_facts SET invalid_at = NULL, deleted_at = 260, updated_at = 260 WHERE id = ?',
      created.fact.id,
    );
    expect(() => assertSupersessionReplay(contributionId, semantics)).toThrow(
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
    const semantics = {
      superseded: [],
      pinnedInputExplicit: false,
      reviewStateInputExplicit: false,
    };
    expect(() => assertSupersessionReplay(contributionId, semantics)).not.toThrow();
    const { commitment, parent } = contributionParent(contributionId);
    expect(() =>
      prepareFactContributionSupersessionPlanInTransaction({
        parent,
        semantics: {
          superseded: [{ id: 'unexpected-predecessor', invalidAt: 100 }],
          pinnedInputExplicit: false,
          reviewStateInputExplicit: false,
        },
      }),
    ).toThrow('memory_fact_contribution_supersession_operation_mismatch');
    const plan = loadVerifiedFactContributionSupersessionPlanInTransaction({
      contributionId,
      commitment,
    });
    expect(() =>
      assertFactContributionSupersessionReplayInTransaction({
        parent: { ...parent, contributionId: `mfc_${'0'.repeat(64)}` },
        plan,
        semantics: {
          superseded: [],
          pinnedInputExplicit: false,
          reviewStateInputExplicit: false,
        },
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');

    getMemoryDb().runSync('UPDATE memory_facts SET created_at = 101 WHERE id = ?', created.fact.id);
    expect(() => assertSupersessionReplay(contributionId, semantics)).toThrow(
      'memory_fact_contribution_supersession_successor_mismatch',
    );
  });

  it('rejects malformed flags and predecessor clocks before creating children', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 1 });
    const created = recordFactWithContribution(
      globalFact(subject.id, 'green', 300),
      grounded,
      context(300),
    );
    const contributionId = contributionIdFor(created.fact.id);
    const { parent } = contributionParent(contributionId);

    expect(() =>
      prepareFactContributionSupersessionPlanInTransaction({
        parent,
        semantics: {
          pinnedInputExplicit: 0 as never,
          reviewStateInputExplicit: false,
          superseded: [],
        },
      }),
    ).toThrow('memory_fact_contribution_supersession_projection_intent_invalid');
    expect(() =>
      prepareFactContributionSupersessionPlanInTransaction({
        parent,
        semantics: {
          pinnedInputExplicit: false,
          reviewStateInputExplicit: false,
          superseded: [
            { id: 'predecessor-a', invalidAt: 300 },
            { id: 'predecessor-b', invalidAt: 301 },
          ],
        },
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
