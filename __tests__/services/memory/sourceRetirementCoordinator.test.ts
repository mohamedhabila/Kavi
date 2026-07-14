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
  seedReplacement,
  seedSharedContribution,
  tableCount,
} from '../../helpers/sourceRetirementCoordinatorFixture';
import { subscribeToMemoryChanges } from '../../../src/services/memory/changeNotifications';
import { getMemoryDb } from '../../../src/services/memory/database';
import { buildFactContentHash } from '../../../src/services/memory/facts/contentIdentity';
import { retireExactMemorySources } from '../../../src/services/memory/sourceRetirementCoordinator';

beforeEach(resetRetirementFixture);
afterEach(closeRetirementFixture);

function retire(
  requestedSources: ReadonlyArray<ReturnType<typeof exactSource>>,
  overrides: Record<string, unknown> = {},
) {
  return retireExactMemorySources({
    reason: 'message_edit',
    requestedSources,
    retiredAt: 500,
    ...overrides,
  });
}

describe('exact source retirement coordinator', () => {
  it('seals a source with no contribution and returns a content-free receipt', () => {
    const result = retire([exactSource('message', 'message-without-contribution')], {
      retirementGroupId: 'retirement-no-contribution',
    });

    expect(result).toEqual({
      status: 'retired',
      retirementGroupId: 'retirement-no-contribution',
      requestedSourceCount: 1,
      closedSourceCount: 1,
      retiredContributionCount: 0,
      tombstonedFactCount: 0,
      reactivatedFactCount: 0,
      rematerializedFactCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('message-without-contribution');
    expect(tableCount('memory_source_retirement_groups')).toBe(1);
  });

  it('tombstones one fact without deleting its immutable fact or contribution rows', () => {
    const seeded = seedContribution('single', { sourceSummary: 'ملخص للاختبار' });
    let notifications = 0;
    const unsubscribe = subscribeToMemoryChanges(() => {
      notifications += 1;
    });

    const result = retire([seeded.messageSource], {
      retirementGroupId: 'retirement-single',
    });
    unsubscribe();

    expect(result).toMatchObject({
      status: 'retired',
      closedSourceCount: 2,
      retiredContributionCount: 1,
      tombstonedFactCount: 1,
    });
    const row = rowForFact(seeded.fact.id);
    expect(row).toMatchObject({
      invalid_at: 500,
      deleted_at: 500,
      local_similarity_model: null,
      local_similarity_dimensions: null,
      local_similarity_vector: null,
      local_similarity_updated_at: null,
    });
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id = ?',
        seeded.fact.id,
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions WHERE id = ?',
        seeded.contributionId,
      )?.count,
    ).toBe(1);
    expect(tableCount('memory_facts')).toBe(1);
    expect(notifications).toBe(1);
  });

  it('retires multiple independent requests in one sealed operation', () => {
    const first = seedContribution('multiple-a', { predicate: '颜色', objectText: 'أزرق' });
    const second = seedContribution('multiple-b', { predicate: 'цвет', objectText: 'зелёный' });

    const result = retire([second.messageSource, first.messageSource], {
      retirementGroupId: 'retirement-multiple',
    });

    expect(result).toMatchObject({
      retiredContributionCount: 2,
      tombstonedFactCount: 2,
      closedSourceCount: 4,
    });
    expect(rowForFact(first.fact.id)).toMatchObject({ invalid_at: 500, deleted_at: 500 });
    expect(rowForFact(second.fact.id)).toMatchObject({ invalid_at: 500, deleted_at: 500 });
  });

  it('rematerializes a partially retired shared fact and preserves telemetry', () => {
    const first = seedContribution('shared-retire', {
      attributes: { origin: 'retired' },
      sourceSummary: 'ملخص قديم',
      now: 100,
    });
    const survivor = seedSharedContribution('shared-keep', first, {
      attributes: { origin: 'survivor', nested: { value: '保持' } },
      sourceSummary: '新しい要約',
      now: 150,
    });
    const db = getMemoryDb();
    db.runSync(
      `UPDATE memory_facts
          SET content_hash = 'v3_intentionally_stale', access_count = 7,
              last_recalled_at = 301, last_accessed_at = 302,
              last_presented_at = 303, last_confirmed_at = 304,
              last_conflicted_at = 305
        WHERE id = ?`,
      first.fact.id,
    );

    const result = retire([first.messageSource], {
      retirementGroupId: 'retirement-shared-partial',
    });
    const row = rowForFact(first.fact.id)!;
    const expectedHash = buildFactContentHash({
      memoryOwnerId: localOwnerId(),
      memoryKind: survivor.fact.memoryKind,
      scope: survivor.fact.scope,
      originConversationId: survivor.fact.originConversationId,
      originThreadId: survivor.fact.originThreadId,
      originTaskId: survivor.fact.originTaskId,
      personaId: survivor.fact.personaId,
      subjectId: survivor.fact.subjectId,
      predicate: survivor.fact.predicate,
      objectText: survivor.fact.objectText,
      objectEntityId: survivor.fact.objectEntityId,
    });

    expect(result).toMatchObject({
      retiredContributionCount: 1,
      tombstonedFactCount: 0,
      rematerializedFactCount: 1,
    });
    expect(row).toMatchObject({
      invalid_at: null,
      deleted_at: null,
      source_message_id: 'message-shared-keep',
      source_summary: '新しい要約',
      attributes: JSON.stringify({ nested: { value: '保持' }, origin: 'survivor' }),
      content_hash: expectedHash,
      access_count: 7,
      last_recalled_at: 301,
      last_accessed_at: 302,
      last_presented_at: 303,
      last_confirmed_at: 304,
      last_conflicted_at: 305,
    });
    expect(row.local_similarity_vector).not.toBeNull();
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_terms WHERE fact_id = ?',
        first.fact.id,
      )?.count,
    ).toBeGreaterThan(0);
  });

  it('closes a fixed-point successor chain when its predecessor loses all support', () => {
    const predecessor = seedContribution('chain-predecessor', { now: 100 });
    const successor = seedReplacement('chain-successor', predecessor, { now: 200 });
    const dependent = seedReplacement('chain-dependent', successor, { now: 300 });

    const result = retire([predecessor.messageSource], {
      retirementGroupId: 'retirement-fixed-point',
    });

    expect(result).toMatchObject({
      retiredContributionCount: 3,
      tombstonedFactCount: 3,
      closedSourceCount: 6,
    });
    for (const factId of [predecessor.fact.id, successor.fact.id, dependent.fact.id]) {
      expect(rowForFact(factId)).toMatchObject({ deleted_at: 500 });
    }
  });

  it('reactivates an exact predecessor only when the final supersession edge retires', () => {
    const predecessor = seedContribution('reactivate-predecessor', { now: 100 });
    const successor = seedReplacement('reactivate-successor', predecessor, { now: 200 });
    expect(rowForFact(predecessor.fact.id)).toMatchObject({ invalid_at: 200 });

    const result = retire([successor.messageSource], {
      retirementGroupId: 'retirement-reactivate',
    });

    expect(result).toMatchObject({
      retiredContributionCount: 1,
      tombstonedFactCount: 1,
      reactivatedFactCount: 1,
    });
    expect(rowForFact(predecessor.fact.id)).toMatchObject({
      invalid_at: null,
      deleted_at: null,
    });
    expect(rowForFact(successor.fact.id)).toMatchObject({
      invalid_at: 500,
      deleted_at: 500,
    });
  });

  it('keeps an exact explicit invalidation even when its timestamp equals the retired edge', () => {
    const predecessor = seedContribution('explicit-predecessor', { now: 100 });
    const successor = seedReplacement('explicit-successor', predecessor, { now: 200 });
    const db = getMemoryDb();
    db.runSync(
      `INSERT INTO memory_fact_explicit_overrides(
         fact_id, memory_owner_id, pinned_override, pinned_at,
         review_state_override, review_state_at, sensitivity_floor,
         sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
       ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 200, 200, 200)`,
      predecessor.fact.id,
      localOwnerId(),
    );

    const result = retire([successor.messageSource], {
      retirementGroupId: 'retirement-explicit-collision',
    });

    expect(result).toMatchObject({ reactivatedFactCount: 0, rematerializedFactCount: 0 });
    expect(rowForFact(predecessor.fact.id)).toMatchObject({
      invalid_at: 200,
      deleted_at: null,
    });
    expect(
      db.getFirstSync<{ explicit_invalidated_at: number }>(
        `SELECT explicit_invalidated_at FROM memory_fact_explicit_overrides
          WHERE fact_id = ? LIMIT 1`,
        predecessor.fact.id,
      ),
    ).toEqual({ explicit_invalidated_at: 200 });
  });

  it('returns a no-write idempotent result and supports mixed prior and new requests', () => {
    const prior = seedContribution('mixed-prior');
    const fresh = seedContribution('mixed-fresh', { predicate: '別の状態' });
    retire([prior.messageSource], { retirementGroupId: 'retirement-mixed-prior' });
    let notifications = 0;
    const unsubscribe = subscribeToMemoryChanges(() => {
      notifications += 1;
    });

    const replay = retire([prior.messageSource]);
    expect(replay).toEqual({
      status: 'already_retired',
      requestedSourceCount: 1,
      closedSourceCount: 0,
      retiredContributionCount: 0,
      tombstonedFactCount: 0,
      reactivatedFactCount: 0,
      rematerializedFactCount: 0,
    });
    expect(notifications).toBe(0);

    const mixed = retire([prior.turnSource, fresh.messageSource], {
      retirementGroupId: 'retirement-mixed-new',
    });
    unsubscribe();
    expect(mixed).toMatchObject({
      status: 'retired',
      requestedSourceCount: 2,
      retiredContributionCount: 1,
      tombstonedFactCount: 1,
    });
    expect(tableCount('memory_source_retirement_groups')).toBe(2);
    expect(notifications).toBe(1);
  });
});
