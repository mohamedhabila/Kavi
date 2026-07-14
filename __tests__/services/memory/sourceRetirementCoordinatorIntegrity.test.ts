jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import {
  closeRetirementFixture,
  exactSource,
  localOwnerId,
  resetRetirementFixture,
  rowForFact,
  seedContribution,
  tableCount,
} from '../../helpers/sourceRetirementCoordinatorFixture';
import { getMemoryDb } from '../../../src/services/memory/database';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';

beforeEach(resetRetirementFixture);
afterEach(closeRetirementFixture);

function request(source = exactSource('message', 'message-integrity')): Record<string, unknown> {
  return {
    reason: 'message_delete',
    requestedSources: [source],
    retiredAt: 500,
    retirementGroupId: 'retirement-integrity',
  };
}

describe('exact source retirement integrity and rollback', () => {
  it('rejects foreign tuples, noncanonical reasons, unsafe clocks, and extra fields', () => {
    const foreign = exactSource('message', 'message-foreign', {
      memoryOwnerId: 'foreign-owner',
    });
    const cases: unknown[] = [
      request(foreign),
      { ...request(), reason: 'deleted_message' },
      { ...request(), retiredAt: -1 },
      { ...request(), retiredAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...request(), unknown: true },
      { ...request(), retirementGroupId: 'contains space' },
    ];

    for (const candidate of cases) {
      expect(() => retireExactMemorySources(candidate)).toThrow();
    }
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
  });

  it('rejects a retirement clock older than a newly retired contribution', () => {
    const seeded = seedContribution('future-clock', { now: 600 });

    expect(() =>
      retireExactMemorySources({
        ...request(seeded.messageSource),
        retiredAt: 500,
      }),
    ).toThrow('memory_source_retirement_clock_regression');
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toMatchObject({ invalid_at: null, deleted_at: null });
  });

  it('fails closed on a missing committed source child before writing a retirement group', () => {
    const seeded = seedContribution('missing-child');
    const db = getMemoryDb();
    db.execSync('DROP TRIGGER trg_memory_fact_contribution_source_delete_immutable');
    db.runSync(
      `DELETE FROM memory_fact_contribution_sources
        WHERE contribution_id = ? AND source_kind = 'turn'`,
      seeded.contributionId,
    );

    expect(() => retireExactMemorySources(request(seeded.messageSource))).toThrow(
      'memory_fact_contribution',
    );
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toMatchObject({ deleted_at: null });
  });

  it('fails closed on a tampered aggregate payload before any retirement write', () => {
    const seeded = seedContribution('tampered-payload');
    const db = getMemoryDb();
    db.execSync('DROP TRIGGER trg_memory_fact_contribution_immutable');
    db.runSync(
      `UPDATE memory_fact_contributions
          SET payload_sha256 = ?
        WHERE id = ?`,
      'f'.repeat(64),
      seeded.contributionId,
    );

    expect(() => retireExactMemorySources(request(seeded.messageSource))).toThrow(
      'memory_fact_contribution',
    );
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
  });

  it('rolls back the sealed ledger when a fact mutation fails after persistence', () => {
    const seeded = seedContribution('rollback');
    const db = getMemoryDb();
    db.execSync(`
      CREATE TRIGGER retirement_test_fact_update_failure
      BEFORE UPDATE ON memory_facts
      BEGIN SELECT RAISE(ABORT, 'retirement_test_injected_failure'); END;
    `);

    expect(() => retireExactMemorySources(request(seeded.messageSource))).toThrow(
      'retirement_test_injected_failure',
    );
    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(tableCount('memory_retired_sources')).toBe(0);
    expect(tableCount('memory_retired_fact_contributions')).toBe(0);
    expect(tableCount('memory_retired_facts')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toMatchObject({ invalid_at: null, deleted_at: null });
  });

  it('rolls back when an affected retrieval-term aggregate is inconsistent', () => {
    const seeded = seedContribution('retrieval-stat-rollback');
    const db = getMemoryDb();
    const key = db.getFirstSync<{ unit: string; memory_kind: string }>(
      `SELECT unit, memory_kind FROM memory_fact_terms
        WHERE fact_id = ? ORDER BY unit LIMIT 1`,
      seeded.fact.id,
    );
    if (!key) throw new Error('expected retrieval term');
    db.runSync(
      `UPDATE memory_fact_term_stats SET fact_count = fact_count + 1
        WHERE unit = ? AND memory_kind = ?`,
      key.unit,
      key.memory_kind,
    );

    expect(() => retireExactMemorySources(request(seeded.messageSource))).toThrow(
      'memory_source_retirement_retrieval_stat_invalid',
    );

    expect(tableCount('memory_source_retirement_groups')).toBe(0);
    expect(rowForFact(seeded.fact.id)).toMatchObject({ invalid_at: null, deleted_at: null });
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id = ?',
        seeded.fact.id,
      )?.count,
    ).toBeGreaterThan(0);
  });

  it('preserves a tombstoned fact explicit override exactly', () => {
    const seeded = seedContribution('override-rollback');
    const db = getMemoryDb();
    db.runSync(
      `INSERT INTO memory_fact_explicit_overrides(
         fact_id, memory_owner_id, pinned_override, pinned_at,
         review_state_override, review_state_at, sensitivity_floor,
         sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
       ) VALUES (?, ?, 1, 150, NULL, NULL, NULL, NULL, NULL, 150, 150)`,
      seeded.fact.id,
      localOwnerId(),
    );
    db.runSync('UPDATE memory_facts SET pinned = 1 WHERE id = ?', seeded.fact.id);

    const result = retireExactMemorySources(request(seeded.messageSource));

    expect(result).toMatchObject({ status: 'retired', tombstonedFactCount: 1 });
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
    expect(
      db.getFirstSync<{ pinned_override: number }>(
        'SELECT pinned_override FROM memory_fact_explicit_overrides WHERE fact_id = ?',
        seeded.fact.id,
      ),
    ).toEqual({ pinned_override: 1 });
    expect(rowForFact(seeded.fact.id)).toMatchObject({
      invalid_at: 500,
      deleted_at: 500,
      pinned: 1,
    });
  });

  it('rejects a duplicate explicit group id atomically', () => {
    const first = seedContribution('group-first');
    const second = seedContribution('group-second', { predicate: '第二' });
    retireExactMemorySources(request(first.messageSource));

    expect(() => retireExactMemorySources(request(second.messageSource))).toThrow();
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
    expect(rowForFact(second.fact.id)).toMatchObject({ deleted_at: null });
  });
});
