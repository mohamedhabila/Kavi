import type { MemoryDatabase } from './access/schemaGuard';
import type { VerifiedFactContributionAggregate } from './factContributionAggregateTypes';
import {
  buildFactLocalSimilarityText,
  createCurrentLocalSimilarityVector,
  serializeCurrentLocalSimilarityVector,
} from './localSimilarity';
import type { MemorySourceRetirementPlan } from './sourceRetirementPlan';
import type { FactContributionProjection } from './facts/factContributionProjection';
import { buildFactContentHash, hasExactFactContentIdentity } from './facts/contentIdentity';
import {
  deleteFactRetrievalTermsInTransaction,
  replaceFactRetrievalTermsInTransaction,
} from './facts/retrievalIndex';
import { rowToFact, type FactRow } from './facts/types';

const FACT_PAGE_SIZE = 128;

interface ProjectionMaterialization {
  factId: string;
  expectedInvalidAt: number | null;
  nextInvalidAt: number | null;
  projection: Readonly<FactContributionProjection>;
}

interface ExpectedTombstone {
  factId: string;
  invalidAt: number;
  deletedAt: number;
}

interface ExpectedProjection extends ProjectionMaterialization {
  contentHash: string;
  localSimilarityModel: string;
  localSimilarityDimensions: number;
  localSimilarityVector: string;
}

interface ExplicitOverrideRow {
  fact_id: string;
  memory_owner_id: string;
  pinned_override: number | null;
  pinned_at: number | null;
  review_state_override: string | null;
  review_state_at: number | null;
  sensitivity_floor: string | null;
  sensitivity_floor_at: number | null;
  explicit_invalidated_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RetrievalTermStatKey {
  unit: string;
  memoryKind: string;
}

export interface SourceRetirementFactMutationReceipt {
  tombstones: ReadonlyArray<Readonly<ExpectedTombstone>>;
  projections: ReadonlyArray<Readonly<ExpectedProjection>>;
}

function fail(code: string): never {
  throw new Error(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function factIdsForPlan(plan: Readonly<MemorySourceRetirementPlan>): string[] {
  const ids = [
    ...plan.tombstones.map(({ factId }) => factId),
    ...plan.reactivations.map(({ factId }) => factId),
    ...plan.rematerializations.map(({ factId }) => factId),
  ].sort(compareOrdinal);
  if (new Set(ids).size !== ids.length) {
    fail('memory_source_retirement_fact_plan_overlap');
  }
  return ids;
}

function loadFactRows(db: MemoryDatabase, factIds: ReadonlyArray<string>): Map<string, FactRow> {
  const rows: FactRow[] = [];
  for (let offset = 0; offset < factIds.length; offset += FACT_PAGE_SIZE) {
    const page = factIds.slice(offset, offset + FACT_PAGE_SIZE);
    rows.push(
      ...db.getAllSync<FactRow>(
        `SELECT * FROM memory_facts
          WHERE id IN (${page.map(() => '?').join(', ')})
          ORDER BY id ASC`,
        ...page,
      ),
    );
  }
  if (rows.length !== factIds.length) fail('memory_source_retirement_fact_missing');
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== factIds.length || factIds.some((id) => !byId.has(id))) {
    fail('memory_source_retirement_fact_graph_invalid');
  }
  return byId;
}

function loadRetrievalTermStatKeys(
  db: MemoryDatabase,
  factIds: ReadonlyArray<string>,
): Map<string, RetrievalTermStatKey> {
  const keys = new Map<string, RetrievalTermStatKey>();
  for (let offset = 0; offset < factIds.length; offset += FACT_PAGE_SIZE) {
    const page = factIds.slice(offset, offset + FACT_PAGE_SIZE);
    for (const row of db.getAllSync<{ unit: string; memory_kind: string }>(
      `SELECT DISTINCT unit, memory_kind FROM memory_fact_terms
        WHERE fact_id IN (${page.map(() => '?').join(', ')})`,
      ...page,
    )) {
      keys.set(JSON.stringify([row.unit, row.memory_kind]), {
        unit: row.unit,
        memoryKind: row.memory_kind,
      });
    }
  }
  return keys;
}

function assertRetrievalTermStats(
  db: MemoryDatabase,
  keys: ReadonlyMap<string, Readonly<RetrievalTermStatKey>>,
): void {
  for (const key of keys.values()) {
    const aggregate = db.getFirstSync<{ fact_count: number; total_weight: number }>(
      `SELECT COUNT(*) AS fact_count, COALESCE(SUM(weight), 0) AS total_weight
         FROM memory_fact_terms WHERE unit = ? AND memory_kind = ?`,
      key.unit,
      key.memoryKind,
    );
    const stat = db.getFirstSync<{ fact_count: number; total_weight: number }>(
      `SELECT fact_count, total_weight FROM memory_fact_term_stats
        WHERE unit = ? AND memory_kind = ? LIMIT 1`,
      key.unit,
      key.memoryKind,
    );
    const factCount = aggregate?.fact_count ?? 0;
    const totalWeight = aggregate?.total_weight ?? 0;
    if (
      (factCount === 0 && stat !== null) ||
      (factCount > 0 &&
        (!stat ||
          stat.fact_count !== factCount ||
          Math.abs(stat.total_weight - totalWeight) > 1e-9))
    ) {
      fail('memory_source_retirement_retrieval_stat_invalid');
    }
  }
}

function loadExplicitOverrides(
  db: MemoryDatabase,
  factIds: ReadonlyArray<string>,
): ReadonlyArray<Readonly<ExplicitOverrideRow>> {
  const rows: ExplicitOverrideRow[] = [];
  for (let offset = 0; offset < factIds.length; offset += FACT_PAGE_SIZE) {
    const page = factIds.slice(offset, offset + FACT_PAGE_SIZE);
    rows.push(
      ...db.getAllSync<ExplicitOverrideRow>(
        `SELECT fact_id, memory_owner_id, pinned_override, pinned_at,
                review_state_override, review_state_at, sensitivity_floor,
                sensitivity_floor_at, explicit_invalidated_at, created_at, updated_at
           FROM memory_fact_explicit_overrides
          WHERE fact_id IN (${page.map(() => '?').join(', ')})
          ORDER BY fact_id ASC`,
        ...page,
      ),
    );
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

function exactOverrideRowsMatch(
  left: ReadonlyArray<Readonly<ExplicitOverrideRow>>,
  right: ReadonlyArray<Readonly<ExplicitOverrideRow>>,
): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return Boolean(
      other &&
      row.fact_id === other.fact_id &&
      row.memory_owner_id === other.memory_owner_id &&
      row.pinned_override === other.pinned_override &&
      row.pinned_at === other.pinned_at &&
      row.review_state_override === other.review_state_override &&
      row.review_state_at === other.review_state_at &&
      row.sensitivity_floor === other.sensitivity_floor &&
      row.sensitivity_floor_at === other.sensitivity_floor_at &&
      row.explicit_invalidated_at === other.explicit_invalidated_at &&
      row.created_at === other.created_at &&
      row.updated_at === other.updated_at,
    );
  });
}

function evidenceByFactId(
  aggregates: ReadonlyArray<Readonly<VerifiedFactContributionAggregate>>,
): Map<string, Readonly<VerifiedFactContributionAggregate>['factEvidence']> {
  const evidence = new Map<string, Readonly<VerifiedFactContributionAggregate>['factEvidence']>();
  for (const aggregate of aggregates) {
    const previous = evidence.get(aggregate.factId);
    if (
      previous &&
      (previous.memoryOwnerId !== aggregate.factEvidence.memoryOwnerId ||
        previous.invalidAt !== aggregate.factEvidence.invalidAt ||
        previous.deletedAt !== aggregate.factEvidence.deletedAt)
    ) {
      fail('memory_source_retirement_fact_graph_invalid');
    }
    evidence.set(aggregate.factId, aggregate.factEvidence);
  }
  return evidence;
}

function assertLoadedLifecycle(input: {
  row: FactRow;
  memoryOwnerId: string;
  evidence: Readonly<VerifiedFactContributionAggregate>['factEvidence'];
}): void {
  if (
    input.row.id !== input.evidence.id ||
    input.row.memory_owner_id !== input.memoryOwnerId ||
    input.evidence.memoryOwnerId !== input.memoryOwnerId ||
    input.row.invalid_at !== input.evidence.invalidAt ||
    input.row.deleted_at !== input.evidence.deletedAt
  ) {
    fail('memory_source_retirement_fact_cas_mismatch');
  }
}

function projectionContentIdentity(
  projection: Readonly<FactContributionProjection>,
  memoryOwnerId: string,
) {
  return {
    memoryOwnerId,
    memoryKind: projection.memoryKind,
    scope: projection.scope,
    originConversationId: projection.originConversationId,
    originThreadId: projection.originThreadId,
    originTaskId: projection.originTaskId,
    personaId: projection.personaId,
    subjectId: projection.subjectId,
    predicate: projection.predicate,
    objectText: projection.objectText,
    objectEntityId: projection.objectEntityId,
  };
}

function assertNoActiveDuplicate(
  db: MemoryDatabase,
  input: {
    factId: string;
    memoryOwnerId: string;
    projection: Readonly<FactContributionProjection>;
    contentHash: string;
    nextInvalidAt: number | null;
  },
): void {
  if (input.nextInvalidAt !== null) return;
  const identity = projectionContentIdentity(input.projection, input.memoryOwnerId);
  const duplicate = db
    .getAllSync<FactRow>(
      `SELECT * FROM memory_facts
        WHERE content_hash = ? AND memory_owner_id = ? AND id != ?
          AND invalid_at IS NULL AND deleted_at IS NULL
        ORDER BY id ASC`,
      input.contentHash,
      input.memoryOwnerId,
      input.factId,
    )
    .some((row) =>
      hasExactFactContentIdentity(
        {
          memoryOwnerId: row.memory_owner_id,
          memoryKind: row.memory_kind,
          scope: row.scope,
          originConversationId: row.origin_conversation_id,
          originThreadId: row.origin_thread_id,
          originTaskId: row.origin_task_id,
          personaId: row.persona_id,
          subjectId: row.subject_id,
          predicate: row.predicate,
          objectText: row.object_text,
          objectEntityId: row.object_entity_id,
        },
        identity,
      ),
    );
  if (duplicate) fail('memory_source_retirement_active_fact_collision');
}

function applyProjection(
  db: MemoryDatabase,
  memoryOwnerId: string,
  input: ProjectionMaterialization,
): Readonly<ExpectedProjection> {
  const projection = input.projection;
  const identity = projectionContentIdentity(projection, memoryOwnerId);
  const contentHash = buildFactContentHash(identity);
  const localSimilarity = createCurrentLocalSimilarityVector(
    buildFactLocalSimilarityText({
      predicate: projection.predicate,
      objectText: projection.objectText,
      sourceSummary: projection.sourceSummary,
    }),
  );
  const localSimilarityVector = serializeCurrentLocalSimilarityVector(localSimilarity);
  assertNoActiveDuplicate(db, { ...input, memoryOwnerId, contentHash });
  const updated = db.runSync(
    `UPDATE memory_facts
        SET subject_id = ?, predicate = ?, object_text = ?, object_entity_id = ?,
            attributes = ?, confidence = ?, source_message_id = ?, source_run_id = ?,
            persona_id = ?, fact_class = ?, source_authority = ?, content_hash = ?,
            local_similarity_model = ?, local_similarity_dimensions = ?,
            local_similarity_vector = ?, local_similarity_updated_at = ?, valid_at = ?,
            invalid_at = ?, created_at = ?, updated_at = ?, pinned = ?, scope = ?,
            origin_conversation_id = ?, origin_thread_id = ?, origin_task_id = ?,
            source_turn_id = ?, source_summary = ?, importance = ?,
            repeated_mention_count = ?, last_reinforced_at = ?, decay_policy = ?,
            expires_at = ?, source_actor_id = ?, retrievability = ?, stability = ?,
            decay_rate = ?, review_state = ?, sensitivity = ?,
            sensitivity_policy_version = ?, memory_kind = ?
      WHERE id = ? AND memory_owner_id = ?
        AND invalid_at IS ? AND deleted_at IS NULL`,
    projection.subjectId,
    projection.predicate,
    projection.objectText,
    projection.objectEntityId,
    JSON.stringify(projection.attributes),
    projection.confidence,
    projection.sourceMessageId,
    projection.sourceRunId,
    projection.personaId,
    projection.factClass,
    projection.sourceAuthority,
    contentHash,
    localSimilarity.model,
    localSimilarity.dimensions,
    localSimilarityVector,
    projection.updatedAt,
    projection.validAt,
    input.nextInvalidAt,
    projection.createdAt,
    projection.updatedAt,
    projection.pinned ? 1 : 0,
    projection.scope,
    projection.originConversationId,
    projection.originThreadId,
    projection.originTaskId,
    projection.sourceTurnId,
    projection.sourceSummary,
    projection.importance,
    projection.repeatedMentionCount,
    projection.lastReinforcedAt,
    projection.decayPolicy,
    projection.expiresAt,
    projection.sourceActorId,
    projection.retrievability,
    projection.stability,
    projection.decayRate,
    projection.reviewState,
    projection.sensitivity,
    projection.sensitivityPolicyVersion,
    projection.memoryKind,
    input.factId,
    memoryOwnerId,
    input.expectedInvalidAt,
  );
  if ((updated.changes ?? 0) !== 1) fail('memory_source_retirement_fact_cas_mismatch');
  const row = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? AND memory_owner_id = ? LIMIT 1',
    input.factId,
    memoryOwnerId,
  );
  if (!row) fail('memory_source_retirement_fact_missing');
  replaceFactRetrievalTermsInTransaction(db, rowToFact(row));
  return Object.freeze({
    ...input,
    contentHash,
    localSimilarityModel: localSimilarity.model,
    localSimilarityDimensions: localSimilarity.dimensions,
    localSimilarityVector,
  });
}

function assertProjectionPostcondition(
  db: MemoryDatabase,
  row: FactRow,
  expected: Readonly<ExpectedProjection>,
): void {
  const projection = expected.projection;
  if (
    row.invalid_at !== expected.nextInvalidAt ||
    row.deleted_at !== null ||
    row.subject_id !== projection.subjectId ||
    row.predicate !== projection.predicate ||
    row.object_text !== projection.objectText ||
    row.object_entity_id !== projection.objectEntityId ||
    row.attributes !== JSON.stringify(projection.attributes) ||
    row.confidence !== projection.confidence ||
    row.source_message_id !== projection.sourceMessageId ||
    row.source_run_id !== projection.sourceRunId ||
    row.persona_id !== projection.personaId ||
    row.fact_class !== projection.factClass ||
    row.source_authority !== projection.sourceAuthority ||
    row.content_hash !== expected.contentHash ||
    row.local_similarity_model !== expected.localSimilarityModel ||
    row.local_similarity_dimensions !== expected.localSimilarityDimensions ||
    row.local_similarity_vector !== expected.localSimilarityVector ||
    row.local_similarity_updated_at !== projection.updatedAt ||
    row.valid_at !== projection.validAt ||
    row.created_at !== projection.createdAt ||
    row.updated_at !== projection.updatedAt ||
    row.pinned !== (projection.pinned ? 1 : 0) ||
    row.scope !== projection.scope ||
    row.origin_conversation_id !== projection.originConversationId ||
    row.origin_thread_id !== projection.originThreadId ||
    row.origin_task_id !== projection.originTaskId ||
    row.source_turn_id !== projection.sourceTurnId ||
    row.source_summary !== projection.sourceSummary ||
    row.importance !== projection.importance ||
    row.repeated_mention_count !== projection.repeatedMentionCount ||
    row.last_reinforced_at !== projection.lastReinforcedAt ||
    row.decay_policy !== projection.decayPolicy ||
    row.expires_at !== projection.expiresAt ||
    row.source_actor_id !== projection.sourceActorId ||
    row.retrievability !== projection.retrievability ||
    row.stability !== projection.stability ||
    row.decay_rate !== projection.decayRate ||
    row.review_state !== projection.reviewState ||
    row.sensitivity !== projection.sensitivity ||
    row.sensitivity_policy_version !== projection.sensitivityPolicyVersion ||
    row.memory_kind !== projection.memoryKind
  ) {
    fail('memory_source_retirement_projection_postcondition_invalid');
  }
  const invalidTerm = db.getFirstSync<{ present: number }>(
    `SELECT 1 AS present FROM memory_fact_terms
      WHERE fact_id = ? AND (source_run_id IS NOT ? OR memory_kind != ?)
      LIMIT 1`,
    expected.factId,
    projection.sourceRunId,
    projection.memoryKind,
  );
  if (invalidTerm) fail('memory_source_retirement_retrieval_index_invalid');
}

function exactTelemetryMatches(before: FactRow, after: FactRow): boolean {
  return (
    before.access_count === after.access_count &&
    before.last_recalled_at === after.last_recalled_at &&
    before.last_accessed_at === after.last_accessed_at &&
    before.last_presented_at === after.last_presented_at &&
    before.last_confirmed_at === after.last_confirmed_at &&
    before.last_conflicted_at === after.last_conflicted_at
  );
}

/** Apply only planner-authorized fact lifecycle and materialization mutations. */
export function applySourceRetirementFactPlanInTransaction(input: {
  db: MemoryDatabase;
  memoryOwnerId: string;
  retiredAt: number;
  activeAggregates: ReadonlyArray<Readonly<VerifiedFactContributionAggregate>>;
  plan: Readonly<MemorySourceRetirementPlan>;
}): Readonly<SourceRetirementFactMutationReceipt> {
  const factIds = factIdsForPlan(input.plan);
  const rows = loadFactRows(input.db, factIds);
  const affectedRetrievalStats = loadRetrievalTermStatKeys(input.db, factIds);
  const explicitOverrides = loadExplicitOverrides(input.db, factIds);
  const evidence = evidenceByFactId(input.activeAggregates);
  for (const factId of factIds) {
    const row = rows.get(factId) ?? fail('memory_source_retirement_fact_missing');
    const factEvidence =
      evidence.get(factId) ?? fail('memory_source_retirement_fact_graph_invalid');
    assertLoadedLifecycle({ row, memoryOwnerId: input.memoryOwnerId, evidence: factEvidence });
  }

  const tombstones: ExpectedTombstone[] = [];
  for (const action of input.plan.tombstones) {
    const row = rows.get(action.factId) ?? fail('memory_source_retirement_fact_missing');
    const invalidAt = row.invalid_at ?? input.retiredAt;
    const deletedAt = row.deleted_at ?? input.retiredAt;
    const updated = input.db.runSync(
      `UPDATE memory_facts
          SET invalid_at = COALESCE(invalid_at, ?),
              deleted_at = COALESCE(deleted_at, ?),
              updated_at = MAX(updated_at, ?),
              local_similarity_model = NULL,
              local_similarity_dimensions = NULL,
              local_similarity_vector = NULL,
              local_similarity_updated_at = NULL
        WHERE id = ? AND memory_owner_id = ?
          AND invalid_at IS ? AND deleted_at IS ?`,
      input.retiredAt,
      input.retiredAt,
      input.retiredAt,
      action.factId,
      input.memoryOwnerId,
      row.invalid_at,
      row.deleted_at,
    );
    if ((updated.changes ?? 0) !== 1) fail('memory_source_retirement_fact_cas_mismatch');
    deleteFactRetrievalTermsInTransaction(input.db, action.factId);
    tombstones.push(Object.freeze({ factId: action.factId, invalidAt, deletedAt }));
  }

  const projections: ExpectedProjection[] = [];
  for (const action of input.plan.reactivations) {
    projections.push(
      applyProjection(input.db, input.memoryOwnerId, {
        factId: action.factId,
        expectedInvalidAt: action.invalidatedAt,
        nextInvalidAt: null,
        projection: action.projection,
      }),
    );
  }
  for (const action of input.plan.rematerializations) {
    const row = rows.get(action.factId) ?? fail('memory_source_retirement_fact_missing');
    projections.push(
      applyProjection(input.db, input.memoryOwnerId, {
        factId: action.factId,
        expectedInvalidAt: row.invalid_at,
        nextInvalidAt: row.invalid_at,
        projection: action.projection,
      }),
    );
  }

  const finalRows = loadFactRows(input.db, factIds);
  for (const [key, value] of loadRetrievalTermStatKeys(input.db, factIds)) {
    affectedRetrievalStats.set(key, value);
  }
  for (const factId of factIds) {
    const before = rows.get(factId) ?? fail('memory_source_retirement_fact_missing');
    const after = finalRows.get(factId) ?? fail('memory_source_retirement_fact_missing');
    if (!exactTelemetryMatches(before, after)) {
      fail('memory_source_retirement_telemetry_postcondition_invalid');
    }
  }
  for (const expected of tombstones) {
    const row = finalRows.get(expected.factId) ?? fail('memory_source_retirement_fact_missing');
    if (
      row.invalid_at !== expected.invalidAt ||
      row.deleted_at !== expected.deletedAt ||
      row.local_similarity_model !== null ||
      row.local_similarity_dimensions !== null ||
      row.local_similarity_vector !== null ||
      row.local_similarity_updated_at !== null ||
      input.db.getFirstSync<{ present: number }>(
        'SELECT 1 AS present FROM memory_fact_terms WHERE fact_id = ? LIMIT 1',
        expected.factId,
      )
    ) {
      fail('memory_source_retirement_tombstone_postcondition_invalid');
    }
  }
  for (const expected of projections) {
    assertProjectionPostcondition(
      input.db,
      finalRows.get(expected.factId) ?? fail('memory_source_retirement_fact_missing'),
      expected,
    );
  }
  if (!exactOverrideRowsMatch(explicitOverrides, loadExplicitOverrides(input.db, factIds))) {
    fail('memory_source_retirement_explicit_override_postcondition_invalid');
  }
  assertRetrievalTermStats(input.db, affectedRetrievalStats);
  return Object.freeze({
    tombstones: Object.freeze(tombstones),
    projections: Object.freeze(projections),
  });
}
