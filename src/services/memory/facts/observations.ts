import { runAfterMemoryTransactionCommit, runMemoryTransaction } from '../access/transaction';
import { getSchemaReadyMemoryDb, type MemoryDatabase } from '../access/schemaGuard';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  isExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import type {
  MemoryEvidenceSourceKind,
  MemoryExternalEvidenceSignal,
} from '../memoryApplicabilityTypes';
import { newId } from '../schema';
import { notifyStructuredMemoryChanged } from '../changeNotifications';
import { assertMemoryPersistenceSourcesAreWritable } from '../withdrawalFence';
import {
  closedMemoryFactClass,
  closedMemorySourceAuthority,
  type MemoryFactClass,
  type MemorySourceAuthority,
} from './applicabilityProvenance';
import type { FactRow } from './types';

export type MemoryFactObservationRelation = 'supports' | 'conflicts';

export interface RecordMemoryFactObservationInput {
  factId: string;
  relation: MemoryFactObservationRelation;
  factClass: MemoryFactClass;
  sourceAuthority: Extract<
    MemorySourceAuthority,
    'grounded_user' | 'tool_observed' | 'external_source'
  >;
  sourceKind: MemoryEvidenceSourceKind;
  sourceId: string;
  sourceScope: MemoryAccessScopeIdentity;
  observedAt: number;
  createdAt?: number;
}

export interface MemoryFactObservation {
  id: string;
  factId: string;
  relation: MemoryFactObservationRelation;
  memoryOwnerId: string;
  factClass: MemoryFactClass;
  sourceAuthority: RecordMemoryFactObservationInput['sourceAuthority'];
  sourceKind: MemoryEvidenceSourceKind;
  sourceId: string;
  sourceConversationId: string;
  sourceThreadId: string;
  sourcePersonaId: string;
  sourceTaskId: string | null;
  observedAt: number;
  createdAt: number;
}

export interface RecordMemoryFactObservationResult {
  observation: MemoryFactObservation;
  status: 'created' | 'duplicate';
}

interface MemoryFactObservationRow {
  id: string;
  fact_id: string;
  relation: string;
  memory_owner_id: string;
  fact_class: string;
  source_authority: string;
  source_kind: string;
  source_id: string;
  source_conversation_id: string;
  source_thread_id: string;
  source_persona_id: string;
  source_task_id: string | null;
  observed_at: number;
  created_at: number;
}

const SOURCE_KIND_AUTHORITY: Readonly<Record<MemoryEvidenceSourceKind, MemorySourceAuthority>> = {
  user_message: 'grounded_user',
  tool_run: 'tool_observed',
  external_record: 'external_source',
};

function isMemoryEvidenceSourceKind(value: unknown): value is MemoryEvidenceSourceKind {
  return (
    typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_KIND_AUTHORITY, value)
  );
}

export const MEMORY_FACT_OBSERVATION_LOAD_LIMIT = 64;

function requireTimestamp(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function factMatchesScope(
  fact: FactRow,
  scope: ReturnType<typeof requireMemoryAccessScopeIdentity>,
): boolean {
  if (fact.memory_owner_id !== scope.memoryOwnerId) return false;
  if (fact.scope === 'global') {
    return (
      fact.persona_id === null &&
      fact.origin_conversation_id === null &&
      fact.origin_thread_id === null &&
      fact.origin_task_id === null
    );
  }
  if (fact.scope === 'persona') {
    return (
      fact.persona_id === scope.personaId &&
      fact.origin_conversation_id === null &&
      fact.origin_thread_id === null &&
      fact.origin_task_id === null
    );
  }
  if (fact.scope !== 'conversation' && fact.scope !== 'project' && fact.scope !== 'session') {
    return false;
  }
  if (fact.persona_id !== null) return false;
  if (fact.origin_conversation_id !== scope.memoryConversationId) return false;
  if (fact.scope === 'conversation' || fact.scope === 'project') {
    return (
      fact.origin_task_id === null &&
      (fact.origin_thread_id === null || isExactMemoryScopeId(fact.origin_thread_id))
    );
  }
  return (
    scope.taskId !== null &&
    fact.origin_thread_id === scope.sourceThreadId &&
    fact.origin_task_id === scope.taskId &&
    isExactMemoryScopeId(fact.origin_task_id)
  );
}

function factIsActiveAt(fact: FactRow, asOf: number): boolean {
  return (
    fact.deleted_at === null &&
    Number.isSafeInteger(fact.created_at) &&
    fact.created_at >= 0 &&
    fact.created_at <= asOf &&
    Number.isSafeInteger(fact.valid_at) &&
    fact.valid_at >= 0 &&
    fact.valid_at <= asOf &&
    (fact.invalid_at === null ||
      (Number.isSafeInteger(fact.invalid_at) && fact.invalid_at >= 0 && fact.invalid_at > asOf)) &&
    (fact.expires_at === null ||
      (Number.isSafeInteger(fact.expires_at) && fact.expires_at >= 0 && fact.expires_at > asOf))
  );
}

function rowToObservation(row: MemoryFactObservationRow): MemoryFactObservation {
  const factClass = closedMemoryFactClass(row.fact_class);
  const sourceAuthority = closedMemorySourceAuthority(row.source_authority);
  if (
    !isExactMemoryScopeId(row.id) ||
    !isExactMemoryScopeId(row.fact_id) ||
    !isExactMemoryScopeId(row.memory_owner_id) ||
    !factClass ||
    (sourceAuthority !== 'grounded_user' &&
      sourceAuthority !== 'tool_observed' &&
      sourceAuthority !== 'external_source') ||
    !isMemoryEvidenceSourceKind(row.source_kind) ||
    !isExactMemoryScopeId(row.source_id) ||
    !isExactMemoryScopeId(row.source_conversation_id) ||
    !isExactMemoryScopeId(row.source_thread_id) ||
    !isExactMemoryScopeId(row.source_persona_id) ||
    (row.source_task_id !== null && !isExactMemoryScopeId(row.source_task_id)) ||
    (row.relation !== 'supports' && row.relation !== 'conflicts') ||
    !Number.isSafeInteger(row.observed_at) ||
    row.observed_at < 0 ||
    !Number.isSafeInteger(row.created_at) ||
    row.created_at < row.observed_at
  ) {
    throw new Error('memory_fact_observation_row_invalid');
  }
  const sourceKind = row.source_kind as MemoryEvidenceSourceKind;
  if (SOURCE_KIND_AUTHORITY[sourceKind] !== sourceAuthority) {
    throw new Error('memory_fact_observation_row_invalid');
  }
  return {
    id: row.id,
    factId: row.fact_id,
    relation: row.relation,
    memoryOwnerId: row.memory_owner_id,
    factClass,
    sourceAuthority,
    sourceKind,
    sourceId: row.source_id,
    sourceConversationId: row.source_conversation_id,
    sourceThreadId: row.source_thread_id,
    sourcePersonaId: row.source_persona_id,
    sourceTaskId: row.source_task_id,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

function readObservationForSourceEvent(
  db: MemoryDatabase,
  input: Pick<MemoryFactObservation, 'factId' | 'memoryOwnerId' | 'sourceKind' | 'sourceId'>,
): MemoryFactObservation | null {
  const row = db.getFirstSync<MemoryFactObservationRow>(
    `SELECT * FROM memory_fact_observations
      WHERE fact_id = ?
        AND memory_owner_id = ?
        AND source_kind = ?
        AND source_id = ?
      LIMIT 1`,
    input.factId,
    input.memoryOwnerId,
    input.sourceKind,
    input.sourceId,
  );
  return row ? rowToObservation(row) : null;
}

function updateFactObservationState(
  db: MemoryDatabase,
  input: Pick<MemoryFactObservation, 'factId' | 'relation' | 'observedAt'>,
  createdAt: number,
): void {
  if (input.relation === 'conflicts') {
    db.runSync(
      `UPDATE memory_facts
          SET last_conflicted_at = MAX(COALESCE(last_conflicted_at, 0), ?),
              updated_at = MAX(updated_at, ?)
        WHERE id = ?`,
      input.observedAt,
      createdAt,
      input.factId,
    );
    return;
  }
  db.runSync(
    `UPDATE memory_facts
        SET last_confirmed_at = MAX(COALESCE(last_confirmed_at, 0), ?),
            updated_at = MAX(updated_at, ?)
      WHERE id = ?`,
    input.observedAt,
    createdAt,
    input.factId,
  );
}

export function recordMemoryFactObservation(
  input: RecordMemoryFactObservationInput,
  now = Date.now(),
): RecordMemoryFactObservationResult {
  let notificationConversationId: string | null = null;
  const result = runMemoryTransaction(() => {
    const db = getSchemaReadyMemoryDb();
    const createdAt = requireTimestamp(
      input.createdAt ?? now,
      'memory_fact_observation_created_invalid',
    );
    const currentTime = requireTimestamp(now, 'memory_fact_observation_clock_invalid');
    const observedAt = requireTimestamp(
      input.observedAt,
      'memory_fact_observation_observed_invalid',
    );
    if (observedAt > createdAt || createdAt > currentTime) {
      throw new Error('memory_fact_observation_time_order_invalid');
    }
    if (!isExactMemoryScopeId(input.factId))
      throw new Error('memory_fact_observation_fact_invalid');
    if (!isExactMemoryScopeId(input.sourceId)) {
      throw new Error('memory_fact_observation_source_invalid');
    }
    if (input.relation !== 'supports' && input.relation !== 'conflicts') {
      throw new Error('memory_fact_observation_relation_invalid');
    }
    const factClass = closedMemoryFactClass(input.factClass);
    const sourceAuthority = closedMemorySourceAuthority(input.sourceAuthority);
    if (!factClass || !sourceAuthority || !isMemoryEvidenceSourceKind(input.sourceKind)) {
      throw new Error('memory_fact_observation_authority_invalid');
    }
    const sourceScope = requireMemoryAccessScopeIdentity(input.sourceScope);
    const localOwnerId = getLocalMemoryVaultOwnerId(db);
    if (sourceScope.memoryOwnerId !== localOwnerId) {
      throw new Error('memory_fact_observation_owner_mismatch');
    }
    const fact = db.getFirstSync<FactRow>(
      `SELECT * FROM memory_facts
        WHERE id = ?
          AND memory_owner_id = ?
          AND deleted_at IS NULL
          AND valid_at <= ?
          AND created_at <= ?
          AND (invalid_at IS NULL OR invalid_at > ?)
          AND NOT EXISTS (
            SELECT 1
              FROM memory_fact_explicit_overrides AS explicit_override
             WHERE explicit_override.fact_id = memory_facts.id
               AND explicit_override.explicit_invalidated_at IS NOT NULL
          )
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1`,
      input.factId,
      localOwnerId,
      observedAt,
      observedAt,
      observedAt,
      observedAt,
    );
    if (!fact || !factIsActiveAt(fact, observedAt) || !factMatchesScope(fact, sourceScope)) {
      throw new Error('memory_fact_observation_target_invalid');
    }
    const persistedFactClass = closedMemoryFactClass(fact.fact_class);
    if (!persistedFactClass || persistedFactClass !== factClass) {
      throw new Error('memory_fact_observation_class_mismatch');
    }
    if (input.sourceKind === 'user_message' || input.sourceKind === 'tool_run') {
      assertMemoryPersistenceSourcesAreWritable(sourceScope, [
        {
          sourceKind: input.sourceKind === 'user_message' ? 'message' : 'run',
          sourceId: input.sourceId,
        },
      ]);
    }

    const identity = {
      factId: input.factId,
      relation: input.relation,
      memoryOwnerId: localOwnerId,
      factClass,
      sourceAuthority: input.sourceAuthority,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceConversationId: sourceScope.memoryConversationId,
      sourceThreadId: sourceScope.sourceThreadId,
      sourcePersonaId: sourceScope.personaId,
      sourceTaskId: sourceScope.taskId,
      observedAt,
    } as const;
    const existing = readObservationForSourceEvent(db, identity);
    if (existing) {
      if (
        existing.relation !== identity.relation ||
        existing.factClass !== identity.factClass ||
        existing.sourceAuthority !== identity.sourceAuthority ||
        existing.sourceConversationId !== identity.sourceConversationId ||
        existing.sourceThreadId !== identity.sourceThreadId ||
        existing.sourcePersonaId !== identity.sourcePersonaId ||
        existing.sourceTaskId !== identity.sourceTaskId ||
        existing.observedAt !== identity.observedAt
      ) {
        throw new Error('memory_fact_observation_identity_conflict');
      }
      return { observation: existing, status: 'duplicate' as const };
    }
    if (sourceAuthority !== SOURCE_KIND_AUTHORITY[input.sourceKind]) {
      throw new Error('memory_fact_observation_authority_invalid');
    }

    const id = newId('fact_observation');
    db.runSync(
      `INSERT INTO memory_fact_observations(
         id, fact_id, relation, memory_owner_id, fact_class, source_authority,
         source_kind, source_id, source_conversation_id, source_thread_id,
         source_persona_id, source_task_id, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      identity.factId,
      identity.relation,
      identity.memoryOwnerId,
      identity.factClass,
      identity.sourceAuthority,
      identity.sourceKind,
      identity.sourceId,
      identity.sourceConversationId,
      identity.sourceThreadId,
      identity.sourcePersonaId,
      identity.sourceTaskId,
      identity.observedAt,
      createdAt,
    );
    updateFactObservationState(db, identity, createdAt);
    notificationConversationId = fact.origin_conversation_id;
    return {
      observation: { id, ...identity, createdAt },
      status: 'created' as const,
    };
  });
  if (result.status === 'created') {
    runAfterMemoryTransactionCommit(() =>
      notifyStructuredMemoryChanged(notificationConversationId),
    );
  }
  return result;
}

export function loadActiveMemoryFactConflictSignals(input: {
  factIds: ReadonlyArray<string>;
  currentScope: MemoryAccessScopeIdentity;
  asOf: number;
}): MemoryExternalEvidenceSignal[] {
  if (!input.factIds.every(isExactMemoryScopeId)) {
    throw new Error('memory_fact_observation_fact_invalid');
  }
  const ids = Array.from(new Set(input.factIds));
  if (ids.length === 0) return [];
  if (ids.length > MEMORY_FACT_OBSERVATION_LOAD_LIMIT) {
    throw new Error('memory_fact_observation_load_limit_exceeded');
  }
  const scope = requireMemoryAccessScopeIdentity(input.currentScope);
  const asOf = requireTimestamp(input.asOf, 'memory_fact_observation_as_of_invalid');
  const db = getSchemaReadyMemoryDb();
  if (scope.memoryOwnerId !== getLocalMemoryVaultOwnerId(db)) {
    throw new Error('memory_fact_observation_owner_mismatch');
  }
  const authorizedFactIds = db
    .getAllSync<FactRow>(
      `SELECT * FROM memory_facts
        WHERE id IN (${ids.map(() => '?').join(', ')})
          AND memory_owner_id = ?
          AND scope IN ('global', 'persona', 'conversation', 'project', 'session')
          AND deleted_at IS NULL
          AND created_at <= ?
          AND valid_at <= ?
          AND (invalid_at IS NULL OR invalid_at > ?)
          AND NOT EXISTS (
            SELECT 1
              FROM memory_fact_explicit_overrides AS explicit_override
             WHERE explicit_override.fact_id = memory_facts.id
               AND explicit_override.explicit_invalidated_at IS NOT NULL
          )
          AND (expires_at IS NULL OR expires_at > ?)`,
      ...ids,
      scope.memoryOwnerId,
      asOf,
      asOf,
      asOf,
      asOf,
    )
    .filter((fact) => factIsActiveAt(fact, asOf) && factMatchesScope(fact, scope))
    .map((fact) => fact.id);
  if (authorizedFactIds.length === 0) return [];
  const rows = db.getAllSync<MemoryFactObservationRow>(
    `SELECT observation.*
       FROM memory_fact_observations AS observation
       JOIN memory_facts AS fact ON fact.id = observation.fact_id
      WHERE observation.fact_id IN (${authorizedFactIds.map(() => '?').join(', ')})
        AND observation.memory_owner_id = ?
        AND fact.memory_owner_id = observation.memory_owner_id
        AND observation.relation = 'conflicts'
        AND observation.observed_at <= ?
        AND observation.created_at <= ?
        AND NOT EXISTS (
          SELECT 1
            FROM memory_fact_observations AS support
           WHERE support.fact_id = observation.fact_id
             AND support.memory_owner_id = observation.memory_owner_id
             AND support.relation = 'supports'
             AND support.observed_at >= observation.observed_at
             AND support.observed_at <= ?
             AND support.created_at <= ?
        )
      ORDER BY observation.fact_id ASC, observation.observed_at DESC, observation.id ASC`,
    ...authorizedFactIds,
    scope.memoryOwnerId,
    asOf,
    asOf,
    asOf,
    asOf,
  );
  return rows.map(rowToObservation).map((observation) => ({
    factId: observation.factId,
    relation: observation.relation,
    factClass: observation.factClass,
    sourceAuthority: observation.sourceAuthority,
    sourceKind: observation.sourceKind,
    sourceId: observation.sourceId,
    observedAt: observation.observedAt,
  }));
}
