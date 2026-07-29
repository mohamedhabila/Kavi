import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';
import { runMemoryTransaction } from './access/transaction';
import { getMemoryDb } from './database';
import { listIngestionPersistenceReceipts } from './ingestionReceiptStore';
import type { IngestionPersistenceReceipt } from './ingestionReceiptStore';
import { markIngestionJobStructuralComplete } from './ingestionQueueStore';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import { ensureFactSchema } from './schema';

export type IngestionStructuralReceiptSource = Readonly<{
  memoryConversationId: string;
  sourceThreadId: string;
  personaId: string;
  taskId: string | null;
  sourceRunId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  sourceSnapshotSha256: string;
  sourceAt: number;
}>;

export type IngestionStructuralCheckpointReceipt = Readonly<{
  phase: 'structural_checkpoint';
  jobId: string;
  attemptNumber: number;
  source: IngestionStructuralReceiptSource;
  episodeId: string | null;
  deterministicFactIds: string[];
  invalidatedFactIds: string[];
  bridgedEvidenceFactIds: string[];
  agentRunMemoryFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  persistedAt: number;
}>;

export type IngestionProviderFinalReceipt = IngestionPersistenceReceipt &
  Readonly<{ phase: 'provider_final' }>;

export type IngestionDurabilityReceipt =
  | IngestionStructuralCheckpointReceipt
  | IngestionProviderFinalReceipt;

export type CommitIngestionStructuralCheckpointReceiptInput = Readonly<{
  jobId: string;
  claimToken: string;
  episodeId: string | null;
  deterministicFactIds: ReadonlyArray<string>;
  providerFactIds: ReadonlyArray<string>;
  invalidatedFactIds: ReadonlyArray<string>;
  bridgedEvidenceFactIds: ReadonlyArray<string>;
  agentRunMemoryFactIds: ReadonlyArray<string>;
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  persistedAt: number;
}>;

type StructuralReceiptClaimRow = {
  attempt_number: number;
  memory_conversation_id: string;
  thread_id: string;
  persona_id: string | null;
  task_id: string | null;
  source_run_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  source_snapshot_sha256: string | null;
  source_at: number;
};

type StructuralReceiptRow = StructuralReceiptClaimRow & {
  job_id: string;
  episode_id: string | null;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  invalidated_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
  active_focus_updated: number;
  open_threads_updated: number;
  persisted_at: number;
};

export type IngestionStructuralReceiptCommitErrorCode =
  | 'claim_lost'
  | 'identity_conflict'
  | 'transition_rejected';

export class IngestionStructuralReceiptCommitError extends Error {
  constructor(readonly code: IngestionStructuralReceiptCommitErrorCode) {
    super(`Memory structural checkpoint receipt commit failed: ${code}`);
    this.name = 'IngestionStructuralReceiptCommitError';
  }
}

function requireIdentity(value: unknown, label: string): string {
  if (!isExactMemoryProvenanceId(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requireScopeIdentity(value: unknown, label: string): string {
  if (!isExactMemoryScopeId(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function optionalIdentity(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireIdentity(value, label);
}

function optionalScopeIdentity(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireScopeIdentity(value, label);
}

function requireTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function requireSha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error('sourceSnapshotSha256 is invalid.');
  }
  return value;
}

function normalizeIds(values: ReadonlyArray<string>, label: string): string[] {
  const normalized = values.map((value) => requireIdentity(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicate identifiers.`);
  }
  return normalized;
}

function parseIds(value: string, label: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${label} is invalid.`);
  }
  return normalizeIds(parsed, label);
}

function sourceFromRow(row: StructuralReceiptClaimRow): IngestionStructuralReceiptSource {
  return {
    memoryConversationId: requireScopeIdentity(row.memory_conversation_id, 'memoryConversationId'),
    sourceThreadId: requireScopeIdentity(row.thread_id, 'sourceThreadId'),
    personaId: requireScopeIdentity(row.persona_id, 'personaId'),
    taskId: optionalScopeIdentity(row.task_id, 'taskId'),
    sourceRunId: optionalIdentity(row.source_run_id, 'sourceRunId'),
    sourceStartMessageId: optionalIdentity(row.source_start_message_id, 'sourceStartMessageId'),
    sourceEndMessageId: requireIdentity(row.source_end_message_id, 'sourceEndMessageId'),
    sourceSnapshotSha256: requireSha256(row.source_snapshot_sha256),
    sourceAt: requireTimestamp(row.source_at, 'sourceAt'),
  };
}

function rowToReceipt(row: StructuralReceiptRow): IngestionStructuralCheckpointReceipt {
  if (parseIds(row.provider_fact_ids_json, 'providerFactIds').length !== 0) {
    throw new Error('providerFactIds is invalid for a structural checkpoint receipt.');
  }
  return {
    phase: 'structural_checkpoint',
    jobId: requireScopeIdentity(row.job_id, 'jobId'),
    attemptNumber: row.attempt_number,
    source: sourceFromRow(row),
    episodeId: optionalIdentity(row.episode_id, 'episodeId'),
    deterministicFactIds: parseIds(row.deterministic_fact_ids_json, 'deterministicFactIds'),
    invalidatedFactIds: parseIds(row.invalidated_fact_ids_json, 'invalidatedFactIds'),
    bridgedEvidenceFactIds: parseIds(row.bridged_evidence_fact_ids_json, 'bridgedEvidenceFactIds'),
    agentRunMemoryFactIds: parseIds(row.agent_run_memory_fact_ids_json, 'agentRunMemoryFactIds'),
    activeFocusUpdated: row.active_focus_updated !== 0,
    openThreadsUpdated: row.open_threads_updated !== 0,
    persistedAt: requireTimestamp(row.persisted_at, 'persistedAt'),
  };
}

function receiptReplayMatches(
  existing: IngestionStructuralCheckpointReceipt,
  candidate: IngestionStructuralCheckpointReceipt,
): boolean {
  return (
    existing.phase === candidate.phase &&
    existing.jobId === candidate.jobId &&
    existing.attemptNumber === candidate.attemptNumber &&
    JSON.stringify(existing.source) === JSON.stringify(candidate.source) &&
    existing.episodeId === candidate.episodeId &&
    JSON.stringify(existing.deterministicFactIds) ===
      JSON.stringify(candidate.deterministicFactIds) &&
    JSON.stringify(existing.invalidatedFactIds) === JSON.stringify(candidate.invalidatedFactIds) &&
    JSON.stringify(existing.bridgedEvidenceFactIds) ===
      JSON.stringify(candidate.bridgedEvidenceFactIds) &&
    JSON.stringify(existing.agentRunMemoryFactIds) ===
      JSON.stringify(candidate.agentRunMemoryFactIds) &&
    (!candidate.activeFocusUpdated || existing.activeFocusUpdated) &&
    (!candidate.openThreadsUpdated || existing.openThreadsUpdated)
  );
}

export function commitIngestionStructuralCheckpointReceipt(
  input: CommitIngestionStructuralCheckpointReceiptInput,
): IngestionStructuralCheckpointReceipt {
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    const jobId = requireScopeIdentity(input.jobId, 'jobId');
    const claimToken = requireIdentity(input.claimToken, 'claimToken');
    const persistedAt = requireTimestamp(input.persistedAt, 'persistedAt');
    if (input.providerFactIds.length !== 0) {
      throw new Error('Structural checkpoint receipts cannot contain provider facts.');
    }
    const claim = db.getFirstSync<StructuralReceiptClaimRow>(
      `SELECT attempt_count AS attempt_number, memory_conversation_id, thread_id,
              persona_id, task_id, source_run_id, source_start_message_id,
              source_end_message_id, source_snapshot_sha256, source_at
         FROM memory_ingestion_jobs
        WHERE id = ?
          AND status = 'processing'
          AND claim_token = ?
          AND claim_process_epoch = ?
          AND lease_expires_at > ?
        LIMIT 1`,
      jobId,
      claimToken,
      getRuntimeProcessEpoch(),
      persistedAt,
    );
    if (!claim) throw new IngestionStructuralReceiptCommitError('claim_lost');

    const receipt: IngestionStructuralCheckpointReceipt = {
      phase: 'structural_checkpoint',
      jobId,
      attemptNumber: claim.attempt_number,
      source: sourceFromRow(claim),
      episodeId: input.episodeId === null ? null : requireIdentity(input.episodeId, 'episodeId'),
      deterministicFactIds: normalizeIds(input.deterministicFactIds, 'deterministicFactIds'),
      invalidatedFactIds: normalizeIds(input.invalidatedFactIds, 'invalidatedFactIds'),
      bridgedEvidenceFactIds: normalizeIds(input.bridgedEvidenceFactIds, 'bridgedEvidenceFactIds'),
      agentRunMemoryFactIds: normalizeIds(input.agentRunMemoryFactIds, 'agentRunMemoryFactIds'),
      activeFocusUpdated: input.activeFocusUpdated,
      openThreadsUpdated: input.openThreadsUpdated,
      persistedAt,
    };
    const inserted = db.runSync(
      `INSERT OR IGNORE INTO memory_ingestion_structural_receipts (
         job_id, attempt_number, memory_conversation_id, source_thread_id, persona_id,
         task_id, source_run_id, source_start_message_id, source_end_message_id,
         source_snapshot_sha256, source_at, episode_id, deterministic_fact_ids_json,
         provider_fact_ids_json, invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
         agent_run_memory_fact_ids_json, active_focus_updated, open_threads_updated,
         persisted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.jobId,
      receipt.attemptNumber,
      receipt.source.memoryConversationId,
      receipt.source.sourceThreadId,
      receipt.source.personaId,
      receipt.source.taskId,
      receipt.source.sourceRunId,
      receipt.source.sourceStartMessageId,
      receipt.source.sourceEndMessageId,
      receipt.source.sourceSnapshotSha256,
      receipt.source.sourceAt,
      receipt.episodeId,
      JSON.stringify(receipt.deterministicFactIds),
      '[]',
      JSON.stringify(receipt.invalidatedFactIds),
      JSON.stringify(receipt.bridgedEvidenceFactIds),
      JSON.stringify(receipt.agentRunMemoryFactIds),
      receipt.activeFocusUpdated ? 1 : 0,
      receipt.openThreadsUpdated ? 1 : 0,
      receipt.persistedAt,
    );
    let committedReceipt = receipt;
    if ((inserted.changes ?? 0) === 0) {
      const existing = getIngestionStructuralCheckpointReceipt(
        receipt.jobId,
        receipt.attemptNumber,
      );
      if (!existing || !receiptReplayMatches(existing, receipt)) {
        throw new IngestionStructuralReceiptCommitError('identity_conflict');
      }
      committedReceipt = existing;
    }
    if (!markIngestionJobStructuralComplete(receipt.jobId, persistedAt, claimToken)) {
      throw new IngestionStructuralReceiptCommitError('transition_rejected');
    }
    return committedReceipt;
  });
}

export function getIngestionStructuralCheckpointReceipt(
  jobId: string,
  attemptNumber: number,
): IngestionStructuralCheckpointReceipt | null {
  ensureFactSchema();
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error('attemptNumber must be a positive safe integer.');
  }
  const row = getMemoryDb().getFirstSync<StructuralReceiptRow>(
    `SELECT job_id, attempt_number, memory_conversation_id,
            source_thread_id AS thread_id, persona_id, task_id, source_run_id,
            source_start_message_id, source_end_message_id, source_snapshot_sha256,
            source_at, episode_id, deterministic_fact_ids_json,
            provider_fact_ids_json, invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
            agent_run_memory_fact_ids_json, active_focus_updated,
            open_threads_updated, persisted_at
       FROM memory_ingestion_structural_receipts
      WHERE job_id = ? AND attempt_number = ?
      LIMIT 1`,
    requireScopeIdentity(jobId, 'jobId'),
    attemptNumber,
  );
  return row ? rowToReceipt(row) : null;
}

export function listIngestionStructuralCheckpointReceipts(
  jobId: string,
): IngestionStructuralCheckpointReceipt[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<StructuralReceiptRow>(
    `SELECT job_id, attempt_number, memory_conversation_id,
            source_thread_id AS thread_id, persona_id, task_id, source_run_id,
            source_start_message_id, source_end_message_id, source_snapshot_sha256,
            source_at, episode_id, deterministic_fact_ids_json,
            provider_fact_ids_json, invalidated_fact_ids_json, bridged_evidence_fact_ids_json,
            agent_run_memory_fact_ids_json, active_focus_updated,
            open_threads_updated, persisted_at
       FROM memory_ingestion_structural_receipts
      WHERE job_id = ?
      ORDER BY attempt_number ASC`,
    requireScopeIdentity(jobId, 'jobId'),
  );
  return rows.map(rowToReceipt);
}

export function listIngestionDurabilityReceipts(jobId: string): IngestionDurabilityReceipt[] {
  const structural = listIngestionStructuralCheckpointReceipts(jobId);
  const providerFinal = listIngestionPersistenceReceipts(jobId).map(
    (receipt): IngestionProviderFinalReceipt => ({ ...receipt, phase: 'provider_final' }),
  );
  return [...structural, ...providerFinal].sort(
    (left, right) =>
      left.attemptNumber - right.attemptNumber || (left.phase === 'structural_checkpoint' ? -1 : 1),
  );
}
