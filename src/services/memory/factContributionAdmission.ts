import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import { runAfterMemoryTransactionCommit } from './access/transaction';
import type { getMemoryDb } from './database';
import {
  buildMemoryFactContributionId,
  encodeMemoryFactContributionPayload,
  type MemoryFactContributionSourceAlias,
  type MemoryFactContributionSourceScope,
} from './factContributionCodec';
import {
  buildFactContributionSourceChildCommitment,
  buildFactContributionSupersessionChildCommitment,
} from './factContributionChildCommitments';
import {
  assertFactContributionAdmissionIntegrity,
  buildLegacyFactSnapshotPayload,
} from './factContributionAdmissionIntegrity';
import {
  MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION,
  type MemoryFactLegacyQuarantineReason,
} from './factContributionAdmissionSchema';
import {
  buildLegacyFactAdmissionProofIndex,
  proveLegacyFactContributionSources,
} from './factContributionAdmissionProof';
import {
  quarantineLegacyFacts,
  type LegacyFactQuarantineEntry,
} from './factContributionLegacyQuarantine';
import type { FactRow } from './facts/types';
import { requireFactMutationTimestamp } from './facts/mutationValidation';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';
import {
  advanceRestrictiveMemoryAuthorityRevisions,
  invalidateRestrictiveMemoryAuthorityProcessEpoch,
} from './memoryAuthorityState';
import { sha256HexUtf8 } from '../../utils/sha256';

type MemoryDb = ReturnType<typeof getMemoryDb>;
type SqlValue = string | number | null;

const LEGACY_FACT_SNAPSHOT_PRODUCER_ID = 'legacy_fact_snapshot_v1';
const MAX_ADMISSION_BATCH_BINDINGS = 800;

interface AdmissionMarkerRow {
  version: number;
  completed_at: number;
  admitted_count: number;
  quarantined_count: number;
}

interface RetiredSourceRow {
  memory_owner_id: string;
  memory_conversation_id: string;
  source_thread_id: string;
  task_id: string;
  source_kind: string;
  source_id: string;
}

interface LegacyFactAdmissionEntry {
  row: FactRow;
  scope: MemoryFactContributionSourceScope;
  aliases: MemoryFactContributionSourceAlias[];
}

export interface FactContributionAdmissionResult {
  status: 'completed' | 'already_completed';
  version: typeof MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION;
  completedAt: number;
  admittedCount: number;
  quarantinedCount: number;
}

const ADMISSION_INTEGRITY_FAILURE = 'memory_fact_contribution_admission_integrity_failed';

class FactContributionAdmissionIntegrityFailure extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(ADMISSION_INTEGRITY_FAILURE);
    this.name = 'FactContributionAdmissionIntegrityFailure';
    this.cause = cause;
  }
}

export function isFactContributionAdmissionIntegrityFailure(
  error: unknown,
): error is FactContributionAdmissionIntegrityFailure {
  return error instanceof FactContributionAdmissionIntegrityFailure;
}

function assertRecoverableAdmissionIntegrity(db: MemoryDb): void {
  try {
    assertFactContributionAdmissionIntegrity(db);
  } catch (cause) {
    throw new FactContributionAdmissionIntegrityFailure(cause);
  }
}

function exactSourceKey(input: {
  scope: MemoryFactContributionSourceScope;
  alias: MemoryFactContributionSourceAlias;
}): string {
  return JSON.stringify([
    input.scope.memoryOwnerId,
    input.scope.memoryConversationId,
    input.scope.sourceThreadId,
    input.scope.taskId,
    input.alias.sourceKind,
    input.alias.sourceId,
  ]);
}

function retiredSourceKey(row: RetiredSourceRow): string {
  return JSON.stringify([
    row.memory_owner_id,
    row.memory_conversation_id,
    row.source_thread_id,
    row.task_id,
    row.source_kind,
    row.source_id,
  ]);
}

function hasRetiredAlias(
  retiredSourceKeys: ReadonlySet<string>,
  scope: MemoryFactContributionSourceScope,
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>,
): boolean {
  return aliases.some((alias) => retiredSourceKeys.has(exactSourceKey({ scope, alias })));
}

function legacyProducerEventId(input: {
  factId: string;
  payloadSha256: string;
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
}): string {
  return `legacy_fact_${sha256HexUtf8(
    JSON.stringify([
      input.factId,
      input.payloadSha256,
      input.aliases.map((alias) => [alias.sourceKind, alias.sourceId]),
    ]),
  )}`;
}

function insertBatchedRows(input: {
  db: MemoryDb;
  table: string;
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<SqlValue>>;
}): void {
  const batchSize = Math.max(1, Math.floor(MAX_ADMISSION_BATCH_BINDINGS / input.columns.length));
  for (let offset = 0; offset < input.rows.length; offset += batchSize) {
    const batch = input.rows.slice(offset, offset + batchSize);
    const placeholders = batch.map(() => `(${input.columns.map(() => '?').join(', ')})`).join(', ');
    input.db.runSync(
      `INSERT INTO ${input.table}(${input.columns.join(', ')}) VALUES ${placeholders}`,
      ...batch.flat(),
    );
  }
}

function prepareLegacyContribution(input: {
  row: FactRow;
  scope: MemoryFactContributionSourceScope;
  aliases: ReadonlyArray<MemoryFactContributionSourceAlias>;
}): { contribution: SqlValue[]; sources: SqlValue[][] } {
  const payload = buildLegacyFactSnapshotPayload(input.row);
  const encoded = encodeMemoryFactContributionPayload(payload);
  const producer = {
    producerId: LEGACY_FACT_SNAPSHOT_PRODUCER_ID,
    producerEventId: legacyProducerEventId({
      factId: input.row.id,
      payloadSha256: encoded.payloadSha256,
      aliases: input.aliases,
    }),
  };
  const contributionId = buildMemoryFactContributionId({ scope: input.scope, producer });
  const sourceSetCommitment = buildFactContributionSourceChildCommitment({
    contributionId,
    scope: input.scope,
    sourceAliases: input.aliases,
  });
  const supersessionSetCommitment = buildFactContributionSupersessionChildCommitment({
    contributionId,
    snapshot: null,
    edges: [],
  });
  return {
    contribution: [
      contributionId,
      input.row.id,
      input.scope.memoryOwnerId,
      input.scope.memoryConversationId,
      input.scope.sourceThreadId,
      input.scope.taskId,
      producer.producerId,
      producer.producerEventId,
      sourceSetCommitment.version,
      sourceSetCommitment.count,
      sourceSetCommitment.sha256,
      supersessionSetCommitment.version,
      supersessionSetCommitment.count,
      supersessionSetCommitment.sha256,
      encoded.payloadVersion,
      encoded.payloadJson,
      encoded.payloadSha256,
      encoded.payloadByteLength,
      payload.input.now,
    ],
    sources: input.aliases.map((alias) => [
      contributionId,
      input.scope.memoryOwnerId,
      input.scope.memoryConversationId,
      input.scope.sourceThreadId,
      input.scope.taskId,
      alias.sourceKind,
      alias.sourceId,
    ]),
  };
}

function persistLegacyContributions(
  db: MemoryDb,
  entries: ReadonlyArray<LegacyFactAdmissionEntry>,
): void {
  const prepared = entries.map(prepareLegacyContribution);
  insertBatchedRows({
    db,
    table: 'memory_fact_contributions',
    columns: [
      'id',
      'fact_id',
      'memory_owner_id',
      'memory_conversation_id',
      'source_thread_id',
      'task_id',
      'producer_id',
      'producer_event_id',
      'source_set_version',
      'source_set_count',
      'source_set_sha256',
      'supersession_set_version',
      'supersession_set_count',
      'supersession_set_sha256',
      'payload_version',
      'payload_json',
      'payload_sha256',
      'payload_byte_length',
      'contributed_at',
    ],
    rows: prepared.map(({ contribution }) => contribution),
  });
  insertBatchedRows({
    db,
    table: 'memory_fact_contribution_sources',
    columns: [
      'contribution_id',
      'memory_owner_id',
      'memory_conversation_id',
      'source_thread_id',
      'task_id',
      'source_kind',
      'source_id',
    ],
    rows: prepared.flatMap(({ sources }) => sources),
  });
}

function payloadFailureReason(error: unknown): MemoryFactLegacyQuarantineReason {
  return error instanceof Error && error.message === 'memory_fact_contribution_payload_too_large'
    ? 'limits_exceeded'
    : 'payload_invalid';
}

function markerResult(
  marker: AdmissionMarkerRow,
  status: FactContributionAdmissionResult['status'],
): FactContributionAdmissionResult {
  if (marker.version !== MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION) {
    throw new Error('memory_fact_contribution_admission_version_invalid');
  }
  return {
    status,
    version: MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION,
    completedAt: marker.completed_at,
    admittedCount: marker.admitted_count,
    quarantinedCount: marker.quarantined_count,
  };
}

/**
 * Cross the legacy boundary exactly once. Runtime never reads unbacked facts:
 * each row is either admitted with exact provenance or made non-retrievable.
 */
export function admitLegacyFactContributions(
  db: MemoryDb,
  now = Date.now(),
): FactContributionAdmissionResult {
  const completedAt = requireFactMutationTimestamp(
    now,
    'memory_fact_contribution_admission_clock_invalid',
  );
  const marker = db.getFirstSync<AdmissionMarkerRow>(
    `SELECT version, completed_at, admitted_count, quarantined_count
       FROM memory_fact_contribution_admission WHERE singleton = 1 LIMIT 1`,
  );
  if (marker) {
    assertRecoverableAdmissionIntegrity(db);
    return markerResult(marker, 'already_completed');
  }

  let restrictiveProjectionChanged = false;
  const result = runMemoryDatabaseSavepoint<FactContributionAdmissionResult>(db, (database) => {
    const memoryOwnerId = getLocalMemoryVaultOwnerId(database);
    const proofIndex = buildLegacyFactAdmissionProofIndex(database);
    const contributedFactIds = new Set(
      database
        .getAllSync<{ fact_id: string }>('SELECT DISTINCT fact_id FROM memory_fact_contributions')
        .map(({ fact_id }) => fact_id),
    );
    const retiredSourceKeys = new Set(
      database
        .getAllSync<RetiredSourceRow>(
          `SELECT memory_owner_id, memory_conversation_id, source_thread_id,
                  task_id, source_kind, source_id
             FROM memory_retired_sources`,
        )
        .map(retiredSourceKey),
    );
    const admissions: LegacyFactAdmissionEntry[] = [];
    const quarantines: LegacyFactQuarantineEntry[] = [];
    for (const row of database.getAllSync<FactRow>(
      'SELECT * FROM memory_facts WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC',
    )) {
      if (contributedFactIds.has(row.id)) continue;
      let rejection: MemoryFactLegacyQuarantineReason | null =
        row.memory_owner_id === memoryOwnerId ? null : 'identity_invalid';
      if (rejection === null) {
        try {
          buildLegacyFactSnapshotPayload(row);
        } catch (error) {
          rejection = payloadFailureReason(error);
        }
      }
      const proof =
        rejection === null
          ? proveLegacyFactContributionSources({ row, memoryOwnerId, index: proofIndex })
          : null;
      if (proof?.status === 'rejected') rejection = proof.reason;
      if (
        rejection === null &&
        proof?.status === 'proven' &&
        hasRetiredAlias(retiredSourceKeys, proof.scope, proof.aliases)
      ) {
        rejection = 'source_retired';
      }
      if (rejection !== null || proof?.status !== 'proven') {
        quarantines.push({
          row,
          reason: rejection ?? 'source_scope_unproven',
        });
        continue;
      }
      admissions.push({ row, scope: proof.scope, aliases: proof.aliases });
    }
    persistLegacyContributions(database, admissions);
    restrictiveProjectionChanged = quarantineLegacyFacts({
      db: database,
      entries: quarantines,
      quarantinedAt: completedAt,
    });
    if (restrictiveProjectionChanged) {
      advanceRestrictiveMemoryAuthorityRevisions(database, memoryOwnerId);
    }
    assertRecoverableAdmissionIntegrity(database);
    database.runSync(
      `INSERT INTO memory_fact_contribution_admission(
         singleton, version, completed_at, admitted_count, quarantined_count
       ) VALUES (1, ?, ?, ?, ?)`,
      MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION,
      completedAt,
      admissions.length,
      quarantines.length,
    );
    return {
      status: 'completed',
      version: MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION,
      completedAt,
      admittedCount: admissions.length,
      quarantinedCount: quarantines.length,
    };
  });
  if (restrictiveProjectionChanged) {
    runAfterMemoryTransactionCommit(invalidateRestrictiveMemoryAuthorityProcessEpoch);
  }
  return result;
}
