jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { runMemoryTransaction } from '../../../src/services/memory/access/transaction';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import type { PersistedExactMemorySourceIdentity } from '../../../src/services/memory/exactMemorySourceIdentity';
import { recordFactWithContributionInTransaction } from '../../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { purgeRetiredCausalPayloadsInTransaction } from '../../../src/services/memory/retiredCausalPayloadPurge';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  MEMORY_SOURCE_RETIREMENT_REASONS,
  type MemorySourceRetirementReason,
  type SourceRetirementOperationInput,
} from '../../../src/services/memory/sourceRetirementOperationCodec';
import {
  loadExistingSourceRetirementFencesInTransaction,
  loadPriorRetiredFactContributionsInTransaction,
  loadVerifiedSourceRetirementOperationInTransaction,
  persistSourceRetirementOperationInTransaction,
} from '../../../src/services/memory/sourceRetirementStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const NONEXISTENT_CONTRIBUTION = `mfc_${'f'.repeat(64)}`;
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

function source(
  ownerId: string,
  sourceKind: PersistedExactMemorySourceIdentity['sourceKind'],
  sourceId: string,
  overrides: Partial<PersistedExactMemorySourceIdentity> = {},
): PersistedExactMemorySourceIdentity {
  return {
    memoryOwnerId: ownerId,
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: '',
    sourceKind,
    sourceId,
    ...overrides,
  };
}

function operation(
  overrides: Partial<SourceRetirementOperationInput> = {},
): SourceRetirementOperationInput {
  const db = getMemoryDb();
  const ownerId = getLocalMemoryVaultOwnerId(db);
  const seeded = seedRetirableFact('1');
  const requestedSources = [seeded.sources[0]!];
  return {
    retirementGroupId: 'retirement-group-1',
    memoryOwnerId: ownerId,
    reason: 'message_edit',
    retiredAt: 500,
    requestedSources,
    closedSources: seeded.sources,
    retiredContributionIds: [seeded.contributionId],
    retiredFactIds: [seeded.factId],
    ...overrides,
  };
}

function seedRetirableFact(suffix: string): {
  factId: string;
  contributionId: string;
  sources: PersistedExactMemorySourceIdentity[];
} {
  const db = getMemoryDb();
  const ownerId = getLocalMemoryVaultOwnerId(db);
  const messageId = `message-${suffix}`;
  const turnId = `turn-${suffix}`;
  const subjectId = upsertEntity({ name: `user-${suffix}`, type: 'self', now: 10 }).id;
  const recorded = runMemoryTransaction(() =>
    recordFactWithContributionInTransaction(
      {
        subjectId,
        predicate: `retirement_test_${suffix}`,
        objectText: `value-${suffix}`,
        scope: 'global',
        sourceMessageId: messageId,
        sourceTurnId: turnId,
        now: 100,
      },
      grounded,
      {
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        taskId: null,
        producer: {
          producerId: 'source_retirement_store_test',
          producerEventId: `event-${suffix}`,
        },
        sourceAliases: [
          { sourceKind: 'message', sourceId: messageId },
          { sourceKind: 'turn', sourceId: turnId },
        ],
      },
    ),
  );
  return {
    factId: recorded.result.fact.id,
    contributionId: recorded.contributionId,
    sources: [source(ownerId, 'message', messageId), source(ownerId, 'turn', turnId)],
  };
}

function tableCount(table: string): number {
  return (
    getMemoryDb().getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      ?.count ?? 0
  );
}

function reinsertExactRow(
  db: ReturnType<typeof getMemoryDb>,
  table: string,
  row: Readonly<Record<string, string | number | null>>,
): void {
  const columns = Object.keys(row);
  db.runSync(
    `INSERT INTO ${table}(${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
    ...columns.map((column) => row[column] ?? null),
  );
}

describe('source retirement store', () => {
  it('persists and reloads one complete sealed operation inside its caller transaction', () => {
    const db = getMemoryDb();
    const input = operation();
    const second = seedRetirableFact('2');
    input.closedSources = [...input.closedSources, ...second.sources];
    input.retiredContributionIds = [second.contributionId, ...input.retiredContributionIds];
    input.retiredFactIds = [second.factId, ...input.retiredFactIds];
    const expectedContributionIds = [...input.retiredContributionIds].sort();
    const expectedFactIds = [...input.retiredFactIds].sort();

    const persisted = runMemoryTransaction(() =>
      persistSourceRetirementOperationInTransaction(db, input),
    );

    expect(persisted).toMatchObject({
      retirementGroupId: input.retirementGroupId,
      memoryOwnerId: input.memoryOwnerId,
      reason: input.reason,
      retiredAt: input.retiredAt,
      retiredContributionIds: expectedContributionIds,
      retiredFactIds: expectedFactIds,
    });
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
    expect(tableCount('memory_source_retirement_requests')).toBe(1);
    expect(tableCount('memory_retired_sources')).toBe(4);
    expect(tableCount('memory_retired_fact_contributions')).toBe(2);
    expect(tableCount('memory_retired_facts')).toBe(2);

    const reloaded = runMemoryTransaction(() =>
      loadVerifiedSourceRetirementOperationInTransaction(db, input.retirementGroupId),
    );
    expect(reloaded).toEqual(persisted);
  });

  it('requires an existing transaction for every coherent read and write boundary', () => {
    const db = getMemoryDb();
    const input = operation();

    expect(() => persistSourceRetirementOperationInTransaction(db, input)).toThrow(
      'memory_source_retirement_transaction_required',
    );
    expect(() =>
      loadVerifiedSourceRetirementOperationInTransaction(db, input.retirementGroupId),
    ).toThrow('memory_source_retirement_transaction_required');
    expect(() => loadExistingSourceRetirementFencesInTransaction(db, [])).toThrow(
      'memory_source_retirement_transaction_required',
    );
    expect(() => loadPriorRetiredFactContributionsInTransaction(db, [])).toThrow(
      'memory_source_retirement_transaction_required',
    );
  });

  it.each(MEMORY_SOURCE_RETIREMENT_REASONS)(
    'accepts only the canonical %s reason',
    (reason: MemorySourceRetirementReason) => {
      const db = getMemoryDb();
      const persisted = runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(
          db,
          operation({ reason, retirementGroupId: `retirement-${reason}` }),
        ),
      );
      expect(persisted.reason).toBe(reason);
    },
  );

  it('rejects unknown fields, invalid reasons, owner drift, and an unclosed request', () => {
    const db = getMemoryDb();
    const base = operation();
    const cases: unknown[] = [
      { ...base, unexpected: true },
      { ...base, reason: 'message_deleted' },
      { ...base, memoryOwnerId: 'foreign-owner' },
      { ...base, closedSources: [base.closedSources[1]!] },
    ];

    for (const candidate of cases) {
      expect(() =>
        runMemoryTransaction(() => persistSourceRetirementOperationInTransaction(db, candidate)),
      ).toThrow();
    }
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
  });

  it('resolves only exact source fences and prior retired contributions in bounded batches', () => {
    const db = getMemoryDb();
    const input = operation();
    runMemoryTransaction(() => persistSourceRetirementOperationInTransaction(db, input));
    const ownerId = input.memoryOwnerId;
    const candidates = [
      ...input.closedSources,
      source(ownerId, 'message', 'message-1', { sourceThreadId: 'thread-2' }),
      source(ownerId, 'run', 'turn-1'),
    ];

    const result = runMemoryTransaction(() => ({
      fences: loadExistingSourceRetirementFencesInTransaction(db, candidates),
      contributions: loadPriorRetiredFactContributionsInTransaction(db, [
        NONEXISTENT_CONTRIBUTION,
        input.retiredContributionIds[0]!,
      ]),
    }));

    expect(result.fences).toHaveLength(2);
    expect(result.fences.map((entry) => entry.source)).toEqual(
      expect.arrayContaining(input.closedSources),
    );
    expect(result.contributions).toEqual([
      {
        retirementGroupId: input.retirementGroupId,
        contributionId: input.retiredContributionIds[0],
      },
    ]);
    const overflow = Array.from(
      { length: 129 },
      (_, index) => `mfc_${index.toString(16).padStart(64, '0')}`,
    );
    expect(() =>
      runMemoryTransaction(() => loadPriorRetiredFactContributionsInTransaction(db, overflow)),
    ).toThrow('memory_source_retirement_lookup_contribution_ids_invalid');
  });

  it('uses locale-independent ordinal order for mixed-script child sets and lookups', () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const mixed = ['🙂', 'العربية', 'Ａ', '日本語', 'a'].map((id) =>
      source(ownerId, 'message', id),
    );
    const expected = [...mixed].sort((left, right) => {
      const leftKey = JSON.stringify([
        left.memoryOwnerId,
        left.memoryConversationId,
        left.sourceThreadId,
        left.taskId,
        left.sourceKind,
        left.sourceId,
      ]);
      const rightKey = JSON.stringify([
        right.memoryOwnerId,
        right.memoryConversationId,
        right.sourceThreadId,
        right.taskId,
        right.sourceKind,
        right.sourceId,
      ]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

    const persisted = runMemoryTransaction(() =>
      persistSourceRetirementOperationInTransaction(
        db,
        operation({
          requestedSources: mixed,
          closedSources: mixed,
          retiredContributionIds: [],
          retiredFactIds: [],
        }),
      ),
    );
    const fences = runMemoryTransaction(() =>
      loadExistingSourceRetirementFencesInTransaction(db, [...mixed].reverse()),
    );

    expect(persisted.requestedSources).toEqual(expected);
    expect(fences.map((entry) => entry.source)).toEqual(expected);
  });

  it('accepts exactly 256 requested sources and rejects 257 without writes', () => {
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const maximum = Array.from({ length: 256 }, (_, index) =>
      source(ownerId, 'message', `message-${index}`),
    );

    const persisted = runMemoryTransaction(() =>
      persistSourceRetirementOperationInTransaction(
        db,
        operation({
          requestedSources: maximum,
          closedSources: maximum,
          retiredContributionIds: [],
          retiredFactIds: [],
        }),
      ),
    );
    expect(persisted.requestedSources).toHaveLength(256);

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    const freshDb = getMemoryDb();
    const freshOwnerId = getLocalMemoryVaultOwnerId(freshDb);
    const overflow = Array.from({ length: 257 }, (_, index) =>
      source(freshOwnerId, 'message', `overflow-${index}`),
    );
    expect(() =>
      runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(
          freshDb,
          operation({
            memoryOwnerId: freshOwnerId,
            requestedSources: overflow,
            closedSources: overflow,
          }),
        ),
      ),
    ).toThrow('memory_source_retirement_requested_sources_invalid');
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
  });

  it('enforces parent identity, child counts, and immutable rows at the database boundary', () => {
    const db = getMemoryDb();
    const input = operation();
    const unrelated = seedRetirableFact('unrelated-delete-guard');
    const retiredContributionRow = db.getFirstSync<Record<string, string | number | null>>(
      'SELECT * FROM memory_fact_contributions WHERE id = ?',
      input.retiredContributionIds[0],
    );
    const retiredFactRow = db.getFirstSync<Record<string, string | number | null>>(
      'SELECT * FROM memory_facts WHERE id = ?',
      input.retiredFactIds[0],
    );
    if (!retiredContributionRow || !retiredFactRow)
      throw new Error('retired parent fixture missing');
    runMemoryTransaction(() => persistSourceRetirementOperationInTransaction(db, input));

    expect(() =>
      db.runSync(
        `INSERT INTO memory_retired_facts(fact_id, retirement_group_id)
         VALUES ('orphan-fact', 'missing-group')`,
      ),
    ).toThrow('memory_retired_fact_parent_invalid');
    expect(() =>
      db.runSync(
        `INSERT INTO memory_source_retirement_requests(
           retirement_group_id, memory_owner_id, memory_conversation_id,
           source_thread_id, task_id, source_kind, source_id
         ) VALUES (?, ?, 'conversation-1', 'thread-1', '', 'message', 'message-extra')`,
        input.retirementGroupId,
        input.memoryOwnerId,
      ),
    ).toThrow('memory_source_retirement_request_count_exceeded');

    const mutations = [
      'UPDATE memory_source_retirement_groups SET retired_at = 501',
      'DELETE FROM memory_source_retirement_groups',
      "UPDATE memory_source_retirement_requests SET source_id = 'changed'",
      'DELETE FROM memory_source_retirement_requests',
      "UPDATE memory_retired_sources SET source_id = 'changed'",
      'DELETE FROM memory_retired_sources',
      "UPDATE memory_retired_fact_contributions SET retirement_group_id = 'changed'",
      'DELETE FROM memory_retired_fact_contributions',
      "UPDATE memory_retired_facts SET retirement_group_id = 'changed'",
      'DELETE FROM memory_retired_facts',
    ];
    for (const sql of mutations) expect(() => db.execSync(sql)).toThrow('immutable');

    expect(() =>
      db.runSync(
        "UPDATE memory_fact_contributions SET memory_owner_id = 'foreign-owner' WHERE id = ?",
        input.retiredContributionIds[0],
      ),
    ).toThrow('immutable');
    expect(() =>
      db.runSync(
        "UPDATE memory_facts SET memory_owner_id = 'foreign-owner' WHERE id = ?",
        input.retiredFactIds[0],
      ),
    ).toThrow('memory_retired_fact_parent_immutable');

    expect(
      db.runSync(
        'UPDATE memory_facts SET invalid_at = 700, deleted_at = 700 WHERE id = ?',
        input.retiredFactIds[0],
      ).changes,
    ).toBe(1);
    expect(
      db.runSync(
        'DELETE FROM memory_fact_contributions WHERE id = ?',
        input.retiredContributionIds[0],
      ).changes,
    ).toBe(1);
    expect(() => reinsertExactRow(db, 'memory_fact_contributions', retiredContributionRow)).toThrow(
      'memory_fact_contribution_immutable',
    );
    expect(
      db.runSync('DELETE FROM memory_facts WHERE id = ?', input.retiredFactIds[0]).changes,
    ).toBe(1);
    expect(() => reinsertExactRow(db, 'memory_facts', retiredFactRow)).toThrow(
      'memory_retired_fact_replay_forbidden',
    );
    expect(() =>
      db.runSync('DELETE FROM memory_fact_contributions WHERE id = ?', unrelated.contributionId),
    ).toThrow('memory_fact_contribution_immutable');
    expect(() => db.runSync('DELETE FROM memory_facts WHERE id = ?', unrelated.factId)).toThrow(
      'memory_fact_delete_not_authorized',
    );
    expect(
      runMemoryTransaction(() =>
        loadVerifiedSourceRetirementOperationInTransaction(db, input.retirementGroupId),
      ),
    ).toEqual(
      expect.objectContaining({
        retiredContributionIds: input.retiredContributionIds,
        retiredFactIds: input.retiredFactIds,
      }),
    );

    closeMemoryDb();
    const reopened = getMemoryDb();
    expect(() =>
      reopened.runSync(
        'DELETE FROM memory_fact_contributions WHERE id = ?',
        unrelated.contributionId,
      ),
    ).toThrow('memory_fact_contribution_immutable');
    expect(() =>
      reopened.runSync('DELETE FROM memory_facts WHERE id = ?', unrelated.factId),
    ).toThrow('memory_fact_delete_not_authorized');
  });

  it('treats an exact retry after committed payload purge as an idempotent no-op', () => {
    const db = getMemoryDb();
    const input = operation({ retirementGroupId: 'retirement-idempotent-purge' });

    const first = runMemoryTransaction(() => {
      persistSourceRetirementOperationInTransaction(db, input);
      return purgeRetiredCausalPayloadsInTransaction(db, {
        retiredContributionIds: input.retiredContributionIds,
        retiredFactIds: input.retiredFactIds,
      });
    });
    const replay = runMemoryTransaction(() =>
      purgeRetiredCausalPayloadsInTransaction(db, {
        retiredContributionIds: input.retiredContributionIds,
        retiredFactIds: input.retiredFactIds,
      }),
    );

    expect(first).toEqual({ contributionPayloads: 1, factPayloads: 1 });
    expect(replay).toEqual({ contributionPayloads: 0, factPayloads: 0 });
    expect(
      runMemoryTransaction(() =>
        loadVerifiedSourceRetirementOperationInTransaction(db, input.retirementGroupId),
      ),
    ).toEqual(
      expect.objectContaining({
        retiredContributionIds: input.retiredContributionIds,
        retiredFactIds: input.retiredFactIds,
      }),
    );
  });

  it('rolls back the complete operation even when its caller catches a child failure', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TRIGGER force_retired_fact_failure
      BEFORE INSERT ON memory_retired_facts
      BEGIN SELECT RAISE(ABORT, 'forced_retired_fact_failure'); END
    `);

    let failure: unknown;
    runMemoryTransaction(() => {
      try {
        persistSourceRetirementOperationInTransaction(db, operation());
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toEqual(
      expect.objectContaining({ message: expect.stringContaining('forced_retired_fact_failure') }),
    );
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(tableCount('memory_source_retirement_requests')).toBe(0);
    expect(tableCount('memory_retired_sources')).toBe(0);
    expect(tableCount('memory_retired_fact_contributions')).toBe(0);
    expect(tableCount('memory_retired_facts')).toBe(0);
  });

  it('rejects nonexistent and foreign-owner fact or contribution identities', () => {
    const db = getMemoryDb();
    const base = operation();
    expect(() =>
      runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(db, {
          ...base,
          retirementGroupId: 'missing-contribution-group',
          retiredContributionIds: [NONEXISTENT_CONTRIBUTION],
          retiredFactIds: [],
        }),
      ),
    ).toThrow('memory_retired_fact_contribution_parent_invalid');
    expect(() =>
      runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(db, {
          ...base,
          retirementGroupId: 'missing-fact-group',
          retiredContributionIds: [],
          retiredFactIds: ['missing-fact'],
        }),
      ),
    ).toThrow('memory_retired_fact_parent_invalid');

    db.runSync(
      "UPDATE memory_facts SET memory_owner_id = 'foreign-owner' WHERE id = ?",
      base.retiredFactIds[0],
    );
    expect(() =>
      runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(db, {
          ...base,
          retirementGroupId: 'foreign-fact-group',
          retiredContributionIds: [],
        }),
      ),
    ).toThrow('memory_retired_fact_parent_invalid');

    const foreignContribution = seedRetirableFact('foreign-contribution');
    db.execSync('DROP TRIGGER trg_memory_fact_contribution_immutable');
    db.runSync(
      "UPDATE memory_fact_contributions SET memory_owner_id = 'foreign-owner' WHERE id = ?",
      foreignContribution.contributionId,
    );
    expect(() =>
      runMemoryTransaction(() =>
        persistSourceRetirementOperationInTransaction(db, {
          ...base,
          retirementGroupId: 'foreign-contribution-group',
          retiredContributionIds: [foreignContribution.contributionId],
          retiredFactIds: [],
        }),
      ),
    ).toThrow('memory_retired_fact_contribution_parent_invalid');
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
  });

  it('detects committed metadata tampering when reloading child sets', () => {
    const db = getMemoryDb();
    const input = operation();
    runMemoryTransaction(() => persistSourceRetirementOperationInTransaction(db, input));
    db.execSync('DROP TRIGGER trg_memory_source_retirement_group_update_immutable');
    db.runSync(
      `UPDATE memory_source_retirement_groups
          SET closed_source_set_sha256 = ?
        WHERE id = ?`,
      '0'.repeat(64),
      input.retirementGroupId,
    );
    db.execSync(`
      CREATE TRIGGER trg_memory_source_retirement_group_update_immutable
      BEFORE UPDATE ON memory_source_retirement_groups
      BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_group_immutable'); END
    `);

    expect(() =>
      runMemoryTransaction(() =>
        loadVerifiedSourceRetirementOperationInTransaction(db, input.retirementGroupId),
      ),
    ).toThrow('memory_source_retirement_schema_reset_required');
    expect(() =>
      runMemoryTransaction(() =>
        loadExistingSourceRetirementFencesInTransaction(db, input.closedSources),
      ),
    ).toThrow('memory_source_retirement_schema_reset_required');
    expect(() =>
      runMemoryTransaction(() =>
        loadPriorRetiredFactContributionsInTransaction(db, input.retiredContributionIds),
      ),
    ).toThrow('memory_source_retirement_schema_reset_required');
    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_source_retirement_schema_reset_required');
  });
});
