jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { loadVerifiedFactContributionAggregatesInTransaction } from '../../../src/services/memory/factContributionAggregateStore';
import { VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS } from '../../../src/services/memory/factContributionAggregateResourceBudget';
import {
  buildMemoryFactContributionId,
  decodeMemoryFactContributionPayload,
  encodeMemoryFactContributionPayload,
  normalizeMemoryFactContributionSourceScope,
} from '../../../src/services/memory/factContributionCodec';
import {
  loadFactContributionReplay,
  type MemoryFactContributionWriteContext,
} from '../../../src/services/memory/factContributionStore';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import type { RecordFactInput } from '../../../src/services/memory/facts/types';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';

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
  jest.restoreAllMocks();
});

function context(
  index: number,
  aliases = [{ sourceKind: 'message' as const, sourceId: `message-${index}` }],
): MemoryFactContributionWriteContext {
  return {
    memoryConversationId: 'aggregate-conversation',
    sourceThreadId: 'aggregate-thread',
    taskId: null,
    producer: {
      producerId: 'aggregate_store_test',
      producerEventId: `event-${index}`,
    },
    sourceAliases: aliases,
  };
}

function contributionIdForFact(factId: string): string {
  return getMemoryDb().getFirstSync<{ id: string }>(
    'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
    factId,
  )!.id;
}

function createContribution(
  index: number,
  overrides: Partial<RecordFactInput> = {},
  writeContext = context(index),
): { contributionId: string; factId: string; context: MemoryFactContributionWriteContext } {
  const subject = upsertEntity({ type: 'self', name: `user-${index}`, now: index + 1 });
  const created = recordFactWithContribution(
    {
      subjectId: subject.id,
      predicate: `aggregate_state_${index}`,
      objectText: `value-${index}`,
      scope: 'global',
      sourceMessageId: `message-${index}`,
      now: 100 + index,
      ...overrides,
    },
    grounded,
    writeContext,
  );
  return {
    contributionId: contributionIdForFact(created.fact.id),
    factId: created.fact.id,
    context: writeContext,
  };
}

function fakeContributionId(seed: string): string {
  return `mfc_${seed.repeat(64).slice(0, 64)}`;
}

function dropParentMutationTriggers(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_dependents;
  `);
}

describe('verified fact contribution aggregate loading', () => {
  it('loads 128 parents with bounded bulk reads and preserves the frozen request', () => {
    const ids: string[] = [];
    for (let index = 0; index < VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.parents; index += 1) {
      ids.push(createContribution(index).contributionId);
    }
    const requested = Object.freeze([...ids].reverse());
    const original = [...requested];
    const db = getMemoryDb();
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    const loaded = loadVerifiedFactContributionAggregatesInTransaction(db, requested);

    expect(loaded.aggregates).toHaveLength(128);
    expect(loaded.missingContributionIds).toEqual([]);
    expect(requested).toEqual(original);
    expect(Object.isFrozen(loaded.aggregates)).toBe(true);
    expect(Object.isFrozen(loaded.aggregates[0]!.payload)).toBe(true);
    expect(Object.isFrozen(loaded.aggregates[0]!.payload.input)).toBe(true);
    expect(Object.isFrozen(loaded.aggregates[0]!.payload.input.attributes)).toBe(true);
    expect(getAllSpy).toHaveBeenCalledTimes(6);
    expect(
      getAllSpy.mock.calls.every((call) => {
        const sql = call[0];
        return typeof sql !== 'string' || !sql.includes('WHERE contribution_id = ?');
      }),
    ).toBe(true);
  });

  it('uses ECMAScript ordinal order for mixed-script aliases', () => {
    const aliases = [
      { sourceKind: 'turn' as const, sourceId: 'ä-turn' },
      { sourceKind: 'message' as const, sourceId: 'β-message' },
      { sourceKind: 'run' as const, sourceId: '消息-run' },
      { sourceKind: 'message' as const, sourceId: 'Z-message' },
    ];
    const writeContext = context(1, aliases);
    const created = createContribution(
      1,
      {
        sourceMessageId: 'β-message',
        sourceTurnId: 'ä-turn',
        sourceRunId: '消息-run',
      },
      writeContext,
    );

    const loaded = loadVerifiedFactContributionAggregatesInTransaction(getMemoryDb(), [
      created.contributionId,
    ]);

    expect(loaded.aggregates[0]!.sourceAliases).toEqual([
      { sourceKind: 'message', sourceId: 'Z-message' },
      { sourceKind: 'message', sourceId: 'β-message' },
      { sourceKind: 'run', sourceId: '消息-run' },
      { sourceKind: 'turn', sourceId: 'ä-turn' },
    ]);
  });

  it('reports an exact missing producer id without accepting duplicate or oversized requests', () => {
    const missing = fakeContributionId('a');
    expect(loadVerifiedFactContributionAggregatesInTransaction(getMemoryDb(), [missing])).toEqual({
      aggregates: [],
      missingContributionIds: [missing],
    });
    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(getMemoryDb(), [missing, missing]),
    ).toThrow('memory_fact_contribution_aggregate_request_invalid');
    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(
        getMemoryDb(),
        Array.from(
          { length: VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.parents + 1 },
          (_, index) => `mfc_${index.toString(16).padStart(64, '0')}`,
        ),
      ),
    ).toThrow('memory_fact_contribution_aggregate_request_invalid');
  });

  it('accepts a commitment-verified aggregate even after its exact source is retired', () => {
    const created = createContribution(1);
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    expect(
      retireExactMemorySources({
        reason: 'message_delete',
        requestedSources: [
          {
            memoryOwnerId: ownerId,
            memoryConversationId: 'aggregate-conversation',
            sourceThreadId: 'aggregate-thread',
            taskId: '',
            sourceKind: 'message',
            sourceId: 'message-1',
          },
        ],
        retiredAt: 500,
        retirementGroupId: 'aggregate-retirement',
      }),
    ).toMatchObject({
      status: 'retired',
      retirementGroupId: 'aggregate-retirement',
      retiredContributionCount: 1,
    });

    expect(
      loadVerifiedFactContributionAggregatesInTransaction(db, [created.contributionId]).aggregates,
    ).toHaveLength(1);
    expect(() => loadFactContributionReplay(created.context)).toThrow(
      'Memory persistence source withdrawn',
    );
  });

  it('loads a public replay from one SQLite transaction snapshot', () => {
    const created = createContribution(1);
    const db = getMemoryDb();
    const execSpy = jest.spyOn(db, 'execSync');

    expect(loadFactContributionReplay(created.context)?.id).toBe(created.contributionId);
    expect(
      execSpy.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('BEGIN IMMEDIATE TRANSACTION'),
      ),
    ).toBe(true);
    expect(
      execSpy.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('COMMIT')),
    ).toBe(true);
  });

  it('accepts an authorized childless exact self-target replacement operation', () => {
    const created = createContribution(1);
    const db = getMemoryDb();
    const row = db.getFirstSync<{
      payload_version: number;
      payload_json: string;
      payload_sha256: string;
      payload_byte_length: number;
    }>('SELECT * FROM memory_fact_contributions WHERE id = ?', created.contributionId)!;
    const payload = decodeMemoryFactContributionPayload({
      payloadVersion: row.payload_version,
      payloadJson: row.payload_json,
      payloadSha256: row.payload_sha256,
      payloadByteLength: row.payload_byte_length,
    });
    const encoded = encodeMemoryFactContributionPayload({
      ...payload,
      operation: { kind: 'exact_replacement', expectedCurrentFactId: created.factId },
    });
    dropParentMutationTriggers();
    db.runSync(
      `UPDATE memory_fact_contributions
          SET payload_version = ?, payload_json = ?, payload_sha256 = ?, payload_byte_length = ?
        WHERE id = ?`,
      encoded.payloadVersion,
      encoded.payloadJson,
      encoded.payloadSha256,
      encoded.payloadByteLength,
      created.contributionId,
    );

    const loaded = loadVerifiedFactContributionAggregatesInTransaction(db, [
      created.contributionId,
    ]);
    expect(loaded.aggregates[0]!.supersessionPlan).toMatchObject({
      snapshot: null,
      edges: [],
    });
  });

  it('rejects a resource-overweight parent page before reading child tables', () => {
    const ids: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      ids.push(createContribution(index).contributionId);
    }
    const db = getMemoryDb();
    dropParentMutationTriggers();
    db.runSync('UPDATE memory_fact_contributions SET source_set_count = 64');
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(() => loadVerifiedFactContributionAggregatesInTransaction(db, ids)).toThrow(
      'memory_fact_contribution_aggregate_resource_limit',
    );
    expect(
      getAllSpy.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('memory_fact_contribution_sources'),
      ),
    ).toHaveLength(0);
  });

  it('rejects oversized fact text before transferring full fact evidence', () => {
    const created = createContribution(1);
    const db = getMemoryDb();
    db.runSync(
      'UPDATE memory_facts SET predicate = ? WHERE id = ?',
      'x'.repeat(VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.factPredicateBytes + 1),
      created.factId,
    );
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(db, [created.contributionId]),
    ).toThrow('memory_fact_contribution_aggregate_resource_limit');
    expect(
      getAllSpy.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('SELECT fact.id, fact.memory_owner_id'),
      ),
    ).toBe(false);
  });

  it('rejects oversized predecessor text before transferring predecessor evidence', () => {
    const subject = upsertEntity({ type: 'self', name: 'preflight-user', now: 1 });
    const predecessor = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'blue',
        scope: 'global',
        sourceMessageId: 'message-1',
        now: 100,
      },
      grounded,
      context(1),
    );
    const successor = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'green',
        scope: 'global',
        sourceMessageId: 'message-2',
        supersedePrior: true,
        now: 200,
      },
      grounded,
      context(2),
    );
    const contributionId = contributionIdForFact(successor.fact.id);
    const db = getMemoryDb();
    db.runSync(
      'UPDATE memory_facts SET predicate = ? WHERE id = ?',
      'x'.repeat(VERIFIED_FACT_CONTRIBUTION_LOAD_LIMITS.predecessorPredicateBytes + 1),
      predecessor.fact.id,
    );
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(() => loadVerifiedFactContributionAggregatesInTransaction(db, [contributionId])).toThrow(
      'memory_fact_contribution_aggregate_resource_limit',
    );
    expect(
      getAllSpy.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('SELECT fact.id, fact.memory_owner_id'),
      ),
    ).toBe(false);
  });

  it.each([
    ['payload', 'payload_sha256'],
    ['producer', 'producer_event_id'],
  ] as const)('fails closed when immutable %s evidence is tampered', (_kind, column) => {
    const created = createContribution(1);
    const db = getMemoryDb();
    dropParentMutationTriggers();
    db.runSync(
      `UPDATE memory_fact_contributions SET ${column} = ? WHERE id = ?`,
      column === 'payload_sha256' ? '0'.repeat(64) : 'different-event',
      created.contributionId,
    );

    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(db, [created.contributionId]),
    ).toThrow();
  });

  it.each([
    ['memory kind', 'memory_kind', 'unsupported_kind'],
    ['creation time', 'created_at', 1_000],
  ] as const)('fails closed on an invalid fact %s', (_kind, column, value) => {
    const created = createContribution(1);
    const db = getMemoryDb();
    db.runSync(`UPDATE memory_facts SET ${column} = ? WHERE id = ?`, value, created.factId);

    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(db, [created.contributionId]),
    ).toThrow('memory_fact_contribution_aggregate_integrity_invalid');
  });

  it('fails closed on a missing committed source child and mismatched fact identity', () => {
    const sourceCorrupt = createContribution(1);
    const db = getMemoryDb();
    db.execSync(`
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_delete_immutable;
      DELETE FROM memory_fact_contribution_sources
       WHERE contribution_id = '${sourceCorrupt.contributionId}';
    `);
    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(db, [sourceCorrupt.contributionId]),
    ).toThrow();

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    const factCorrupt = createContribution(2);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET object_text = ? WHERE id = ?',
      'tampered-value',
      factCorrupt.factId,
    );
    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(getMemoryDb(), [
        factCorrupt.contributionId,
      ]),
    ).toThrow();
  });

  it.each([
    ['invalidation timestamp', 'invalid_at', 201],
    ['deletion state', 'deleted_at', 201],
  ] as const)('fails closed when predecessor %s changes', (_kind, column, value) => {
    const subject = upsertEntity({ type: 'self', name: 'supersession-user', now: 1 });
    const first = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'blue',
        scope: 'global',
        sourceMessageId: 'message-1',
        now: 100,
      },
      grounded,
      context(1),
    );
    const second = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'green',
        scope: 'global',
        sourceMessageId: 'message-2',
        supersedePrior: true,
        now: 200,
      },
      grounded,
      context(2),
    );
    const contributionId = contributionIdForFact(second.fact.id);
    const db = getMemoryDb();
    db.runSync(`UPDATE memory_facts SET ${column} = ? WHERE id = ?`, value, first.fact.id);
    const getAllSpy = jest.spyOn(db, 'getAllSync');

    expect(() =>
      loadVerifiedFactContributionAggregatesInTransaction(db, [contributionId]),
    ).toThrow();
    expect(getAllSpy).toHaveBeenCalledTimes(7);
  });

  it('fails closed when a snapshot-backed successor creation time predates its contribution', () => {
    const subject = upsertEntity({ type: 'self', name: 'snapshot-time-user', now: 1 });
    recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'blue',
        scope: 'global',
        sourceMessageId: 'message-1',
        now: 100,
      },
      grounded,
      context(1),
    );
    const successor = recordFactWithContribution(
      {
        subjectId: subject.id,
        predicate: 'favorite_color',
        objectText: 'green',
        scope: 'global',
        sourceMessageId: 'message-2',
        supersedePrior: true,
        now: 200,
      },
      grounded,
      context(2),
    );
    const contributionId = contributionIdForFact(successor.fact.id);
    const db = getMemoryDb();
    db.runSync('UPDATE memory_facts SET created_at = 199 WHERE id = ?', successor.fact.id);

    expect(() => loadVerifiedFactContributionAggregatesInTransaction(db, [contributionId])).toThrow(
      'memory_fact_contribution_aggregate_integrity_invalid',
    );
  });

  it.each(['snapshot', 'edge', 'source'] as const)(
    'fails closed when a committed %s child set is altered',
    (child) => {
      const subject = upsertEntity({ type: 'self', name: 'child-user', now: 1 });
      recordFactWithContribution(
        {
          subjectId: subject.id,
          predicate: 'favorite_color',
          objectText: 'blue',
          scope: 'global',
          sourceMessageId: 'message-1',
          now: 100,
        },
        grounded,
        context(1),
      );
      const successor = recordFactWithContribution(
        {
          subjectId: subject.id,
          predicate: 'favorite_color',
          objectText: 'green',
          scope: 'global',
          sourceMessageId: 'message-2',
          supersedePrior: true,
          now: 200,
        },
        grounded,
        context(2),
      );
      const contributionId = contributionIdForFact(successor.fact.id);
      const db = getMemoryDb();
      if (child === 'snapshot') {
        db.execSync(
          'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_immutable;',
        );
        db.runSync(
          `UPDATE memory_fact_contribution_supersession_snapshots
              SET successor_review_state_baseline = 'verified'
            WHERE contribution_id = ?`,
          contributionId,
        );
      } else if (child === 'edge') {
        db.execSync(`
          DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;
          DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_snapshot;
        `);
        db.runSync(
          'DELETE FROM memory_fact_contribution_supersessions WHERE contribution_id = ?',
          contributionId,
        );
      } else {
        db.execSync('DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_count;');
        db.runSync(
          `INSERT INTO memory_fact_contribution_sources(
             contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
             task_id, source_kind, source_id
           ) SELECT contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
                    task_id, 'run', 'extra-run'
               FROM memory_fact_contribution_sources
              WHERE contribution_id = ? LIMIT 1`,
          contributionId,
        );
      }

      expect(() =>
        loadVerifiedFactContributionAggregatesInTransaction(db, [contributionId]),
      ).toThrow();
    },
  );

  it.each(['source', 'snapshot', 'edge'] as const)(
    'detects an orphan %s child for a missing requested parent',
    (child) => {
      const id = fakeContributionId(child === 'source' ? 'b' : child === 'snapshot' ? 'c' : 'd');
      const db = getMemoryDb();
      const ownerId = getLocalMemoryVaultOwnerId(db);
      if (child === 'source') {
        db.execSync('DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_parent_insert;');
        db.runSync(
          `INSERT INTO memory_fact_contribution_sources(
             contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
             task_id, source_kind, source_id
           ) VALUES (?, ?, 'aggregate-conversation', 'aggregate-thread', '', 'message', 'orphan')`,
          id,
          ownerId,
        );
      } else if (child === 'snapshot') {
        db.execSync(
          'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_parent_insert;',
        );
        db.runSync(
          `INSERT INTO memory_fact_contribution_supersession_snapshots(
             contribution_id, successor_fact_id, superseded_at, snapshot_version,
             pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
             successor_review_state_baseline, successor_sensitivity_floor,
             successor_sensitivity_policy_version
           ) VALUES (?, 'orphan-successor', 100, 1, 0, 0, 0, 'auto', 'normal', 2)`,
          id,
        );
      } else {
        db.execSync(
          'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;',
        );
        db.runSync(
          `INSERT INTO memory_fact_contribution_supersessions(
             contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
           ) VALUES (?, 'orphan-predecessor', 'orphan-successor', 100)`,
          id,
        );
      }

      expect(() => loadVerifiedFactContributionAggregatesInTransaction(db, [id])).toThrow();
    },
  );

  it('derives the deterministic producer id from exact scope without normalization', () => {
    const created = createContribution(1);
    const db = getMemoryDb();
    const ownerId = getLocalMemoryVaultOwnerId(db);
    const scope = normalizeMemoryFactContributionSourceScope({
      memoryOwnerId: ownerId,
      memoryConversationId: 'aggregate-conversation',
      sourceThreadId: 'aggregate-thread',
      taskId: null,
    });
    expect(
      buildMemoryFactContributionId({
        scope,
        producer: created.context.producer,
      }),
    ).toBe(created.contributionId);
  });
});
