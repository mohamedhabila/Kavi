import type { MemoryDatabase } from './access/schemaGuard';

export interface RawContributionParentRow {
  requested_id: unknown;
  local_owner_id: unknown;
  id: unknown;
  fact_id: unknown;
  memory_owner_id: unknown;
  memory_conversation_id: unknown;
  source_thread_id: unknown;
  task_id: unknown;
  producer_id: unknown;
  producer_event_id: unknown;
  source_set_version: unknown;
  source_set_count: unknown;
  source_set_sha256: unknown;
  supersession_set_version: unknown;
  supersession_set_count: unknown;
  supersession_set_sha256: unknown;
  payload_version: unknown;
  payload_json: unknown;
  payload_sha256: unknown;
  payload_byte_length: unknown;
  contributed_at: unknown;
}

export interface RawContributionSourceRow {
  contribution_id: unknown;
  memory_owner_id: unknown;
  memory_conversation_id: unknown;
  source_thread_id: unknown;
  task_id: unknown;
  source_kind: unknown;
  source_id: unknown;
}

export interface RawSupersessionSnapshotRow {
  contribution_id: unknown;
  successor_fact_id: unknown;
  superseded_at: unknown;
  snapshot_version: unknown;
  pinned_input_explicit: unknown;
  review_state_input_explicit: unknown;
  successor_pinned_baseline: unknown;
  successor_review_state_baseline: unknown;
  successor_sensitivity_floor: unknown;
  successor_sensitivity_policy_version: unknown;
}

export interface RawSupersessionEdgeRow {
  contribution_id: unknown;
  predecessor_fact_id: unknown;
  successor_fact_id: unknown;
  superseded_at: unknown;
}

export interface RawFactEvidenceRow {
  id: unknown;
  memory_owner_id: unknown;
  memory_kind: unknown;
  scope: unknown;
  origin_conversation_id: unknown;
  origin_thread_id: unknown;
  origin_task_id: unknown;
  persona_id: unknown;
  subject_id: unknown;
  predicate: unknown;
  object_text: unknown;
  object_entity_id: unknown;
  created_at: unknown;
  invalid_at: unknown;
  deleted_at: unknown;
  pinned: unknown;
  review_state: unknown;
  sensitivity: unknown;
  sensitivity_policy_version: unknown;
  subject_name: unknown;
  subject_type: unknown;
  override_fact_id: unknown;
  override_memory_owner_id: unknown;
  override_pinned_override: unknown;
  override_pinned_at: unknown;
  override_review_state_override: unknown;
  override_review_state_at: unknown;
  override_sensitivity_floor: unknown;
  override_sensitivity_floor_at: unknown;
  override_explicit_invalidated_at: unknown;
  override_created_at: unknown;
  override_updated_at: unknown;
}

export interface RawPredecessorEvidenceRow {
  id: unknown;
  memory_owner_id: unknown;
  subject_id: unknown;
  predicate: unknown;
  scope: unknown;
  persona_id: unknown;
  origin_conversation_id: unknown;
  origin_thread_id: unknown;
  origin_task_id: unknown;
  invalid_at: unknown;
  deleted_at: unknown;
}

export interface RawContributionEvidenceBudgetRow {
  evidence_kind: unknown;
  evidence_id: unknown;
  predicate_byte_length: unknown;
  object_text_byte_length: unknown;
  subject_name_byte_length: unknown;
  subject_type_byte_length: unknown;
}

function requestedCte(count: number): string {
  return `WITH requested(id) AS (VALUES ${Array.from({ length: count }, () => '(?)').join(', ')})`;
}

export function loadRawContributionParents(
  db: MemoryDatabase,
  requestedIds: ReadonlyArray<string>,
): RawContributionParentRow[] {
  const cte = requestedCte(requestedIds.length);
  return db.getAllSync<RawContributionParentRow>(
    `${cte}
     SELECT requested.id AS requested_id, vault.owner_id AS local_owner_id,
            contribution.id, contribution.fact_id, contribution.memory_owner_id,
            contribution.memory_conversation_id, contribution.source_thread_id,
            contribution.task_id, contribution.producer_id, contribution.producer_event_id,
            contribution.source_set_version, contribution.source_set_count,
            contribution.source_set_sha256, contribution.supersession_set_version,
            contribution.supersession_set_count, contribution.supersession_set_sha256,
            contribution.payload_version, contribution.payload_json,
            contribution.payload_sha256, contribution.payload_byte_length,
            contribution.contributed_at
       FROM requested
       CROSS JOIN memory_vault_identity AS vault
       LEFT JOIN memory_fact_contributions AS contribution ON contribution.id = requested.id
      WHERE vault.singleton = 1
      ORDER BY requested.id ASC
      LIMIT ${requestedIds.length + 1}`,
    ...requestedIds,
  );
}

export function loadRawContributionEvidenceBudget(
  db: MemoryDatabase,
  input: {
    requestedIds: ReadonlyArray<string>;
    factCount: number;
    expectedEdges: number;
  },
): RawContributionEvidenceBudgetRow[] {
  if (input.factCount === 0 && input.expectedEdges === 0) return [];
  const cte = requestedCte(input.requestedIds.length);
  return db.getAllSync<RawContributionEvidenceBudgetRow>(
    `${cte}
     SELECT 'fact' AS evidence_kind, fact.id AS evidence_id,
            length(CAST(fact.predicate AS BLOB)) AS predicate_byte_length,
            length(CAST(fact.object_text AS BLOB)) AS object_text_byte_length,
            length(CAST(COALESCE(subject.canonical_name, '') AS BLOB))
              AS subject_name_byte_length,
            length(CAST(COALESCE(subject.type, '') AS BLOB)) AS subject_type_byte_length
       FROM memory_facts AS fact
       LEFT JOIN memory_entities AS subject ON subject.id = fact.subject_id
      WHERE fact.id IN (
        SELECT DISTINCT contribution.fact_id
          FROM memory_fact_contributions AS contribution
          JOIN requested ON requested.id = contribution.id
      )
     UNION ALL
     SELECT 'predecessor' AS evidence_kind, fact.id AS evidence_id,
            length(CAST(fact.predicate AS BLOB)) AS predicate_byte_length,
            0 AS object_text_byte_length, 0 AS subject_name_byte_length,
            0 AS subject_type_byte_length
       FROM memory_facts AS fact
      WHERE fact.id IN (
        SELECT DISTINCT edge.predecessor_fact_id
          FROM memory_fact_contribution_supersessions AS edge
          JOIN requested ON requested.id = edge.contribution_id
      )
      ORDER BY evidence_kind ASC, evidence_id ASC
      LIMIT ${input.factCount + input.expectedEdges + 1}`,
    ...input.requestedIds,
  );
}

export interface RawContributionAggregateRows {
  sources: RawContributionSourceRow[];
  snapshots: RawSupersessionSnapshotRow[];
  edges: RawSupersessionEdgeRow[];
  facts: RawFactEvidenceRow[];
  predecessors: RawPredecessorEvidenceRow[];
}

export function loadRawContributionAggregateRows(
  db: MemoryDatabase,
  input: {
    requestedIds: ReadonlyArray<string>;
    sourceChildren: number;
    expectedSnapshots: number;
    expectedEdges: number;
    factCount: number;
  },
): RawContributionAggregateRows {
  const cte = requestedCte(input.requestedIds.length);
  const sources = db.getAllSync<RawContributionSourceRow>(
    `${cte}
     SELECT source.contribution_id, source.memory_owner_id,
            source.memory_conversation_id, source.source_thread_id, source.task_id,
            source.source_kind, source.source_id
       FROM memory_fact_contribution_sources AS source
       JOIN requested ON requested.id = source.contribution_id
      ORDER BY source.contribution_id ASC, source.source_kind ASC, source.source_id ASC
      LIMIT ${input.sourceChildren + 1}`,
    ...input.requestedIds,
  );
  const snapshots = db.getAllSync<RawSupersessionSnapshotRow>(
    `${cte}
     SELECT snapshot.contribution_id, snapshot.successor_fact_id, snapshot.superseded_at,
            snapshot.snapshot_version, snapshot.pinned_input_explicit,
            snapshot.review_state_input_explicit, snapshot.successor_pinned_baseline,
            snapshot.successor_review_state_baseline, snapshot.successor_sensitivity_floor,
            snapshot.successor_sensitivity_policy_version
       FROM memory_fact_contribution_supersession_snapshots AS snapshot
       JOIN requested ON requested.id = snapshot.contribution_id
      ORDER BY snapshot.contribution_id ASC
      LIMIT ${input.expectedSnapshots + 1}`,
    ...input.requestedIds,
  );
  const edges = db.getAllSync<RawSupersessionEdgeRow>(
    `${cte}
     SELECT edge.contribution_id, edge.predecessor_fact_id,
            edge.successor_fact_id, edge.superseded_at
       FROM memory_fact_contribution_supersessions AS edge
       JOIN requested ON requested.id = edge.contribution_id
      ORDER BY edge.contribution_id ASC, edge.predecessor_fact_id ASC
      LIMIT ${input.expectedEdges + 1}`,
    ...input.requestedIds,
  );
  const facts =
    input.factCount === 0
      ? []
      : db.getAllSync<RawFactEvidenceRow>(
          `${cte}
           SELECT fact.id, fact.memory_owner_id, fact.memory_kind, fact.scope,
                  fact.origin_conversation_id, fact.origin_thread_id, fact.origin_task_id,
                  fact.persona_id, fact.subject_id, fact.predicate, fact.object_text,
                  fact.object_entity_id, fact.created_at, fact.invalid_at, fact.deleted_at,
                  fact.pinned, fact.review_state, fact.sensitivity,
                  fact.sensitivity_policy_version, subject.canonical_name AS subject_name,
                  subject.type AS subject_type,
                  explicit_override.fact_id AS override_fact_id,
                  explicit_override.memory_owner_id AS override_memory_owner_id,
                  explicit_override.pinned_override AS override_pinned_override,
                  explicit_override.pinned_at AS override_pinned_at,
                  explicit_override.review_state_override AS override_review_state_override,
                  explicit_override.review_state_at AS override_review_state_at,
                  explicit_override.sensitivity_floor AS override_sensitivity_floor,
                  explicit_override.sensitivity_floor_at AS override_sensitivity_floor_at,
                  explicit_override.explicit_invalidated_at AS override_explicit_invalidated_at,
                  explicit_override.created_at AS override_created_at,
                  explicit_override.updated_at AS override_updated_at
             FROM memory_facts AS fact
             LEFT JOIN memory_entities AS subject ON subject.id = fact.subject_id
             LEFT JOIN memory_fact_explicit_overrides AS explicit_override
               ON explicit_override.fact_id = fact.id
            WHERE fact.id IN (
              SELECT DISTINCT contribution.fact_id
                FROM memory_fact_contributions AS contribution
                JOIN requested ON requested.id = contribution.id
            )
            ORDER BY fact.id ASC
            LIMIT ${input.factCount + 1}`,
          ...input.requestedIds,
        );
  const predecessors =
    input.expectedEdges === 0
      ? []
      : db.getAllSync<RawPredecessorEvidenceRow>(
          `${cte}
           SELECT fact.id, fact.memory_owner_id, fact.subject_id, fact.predicate, fact.scope,
                  fact.persona_id, fact.origin_conversation_id, fact.origin_thread_id,
                  fact.origin_task_id, fact.invalid_at, fact.deleted_at
             FROM memory_facts AS fact
            WHERE fact.id IN (
              SELECT DISTINCT edge.predecessor_fact_id
                FROM memory_fact_contribution_supersessions AS edge
                JOIN requested ON requested.id = edge.contribution_id
            )
            ORDER BY fact.id ASC
            LIMIT ${input.expectedEdges + 1}`,
          ...input.requestedIds,
        );
  return { sources, snapshots, edges, facts, predecessors };
}
