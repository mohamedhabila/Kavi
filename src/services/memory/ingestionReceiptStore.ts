import { runMemoryTransaction } from './access/transaction';
import {
  completeIngestionJob,
  markIngestionJobStructuralComplete,
  type IngestionProviderOutcome,
} from './ingestionQueueStore';
import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';

export type IngestionReceiptProviderOutcomeCode =
  | 'empty_response'
  | 'invalid_json'
  | 'non_object'
  | 'missing_required_field'
  | 'unexpected_field'
  | 'invalid_field_type'
  | 'invalid_field_value'
  | 'limit_exceeded'
  | 'provider_request_failed'
  | 'unsupported_response_shape';

export interface IngestionPersistenceReceipt {
  jobId: string;
  attemptNumber: number;
  episodeId: string | null;
  deterministicFactIds: string[];
  providerFactIds: string[];
  invalidatedFactIds: string[];
  bridgedEvidenceFactIds: string[];
  agentRunMemoryFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  providerOutcome: IngestionProviderOutcome;
  providerOutcomeCode: IngestionReceiptProviderOutcomeCode | null;
  persistedAt: number;
}

export interface CommitIngestionPersistenceReceiptInput
  extends Omit<IngestionPersistenceReceipt, 'attemptNumber'> {
  claimToken: string;
}

export type IngestionReceiptCommitErrorCode =
  | 'claim_lost'
  | 'identity_conflict'
  | 'transition_rejected';

export class IngestionReceiptCommitError extends Error {
  constructor(readonly code: IngestionReceiptCommitErrorCode) {
    super(`Memory ingestion receipt commit failed: ${code}`);
    this.name = 'IngestionReceiptCommitError';
  }
}

interface IngestionReceiptRow {
  job_id: string;
  attempt_number: number;
  episode_id: string | null;
  deterministic_fact_ids_json: string;
  provider_fact_ids_json: string;
  invalidated_fact_ids_json: string;
  bridged_evidence_fact_ids_json: string;
  agent_run_memory_fact_ids_json: string;
  active_focus_updated: number;
  open_threads_updated: number;
  provider_outcome: IngestionProviderOutcome;
  provider_outcome_code: IngestionReceiptProviderOutcomeCode | null;
  persisted_at: number;
}

function requireIdentity(value: string, label: string): string {
  if (!value || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty normalized identifier.`);
  }
  return value;
}

function requirePersistedAt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('persistedAt must be a non-negative safe integer.');
  }
  return value;
}

function normalizeFactIds(values: ReadonlyArray<string>, label: string): string[] {
  const normalized = values.map((value) => requireIdentity(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicate identifiers.`);
  }
  return normalized;
}

function requireProviderOutcomeCode(
  outcome: IngestionProviderOutcome,
  code: IngestionReceiptProviderOutcomeCode | null,
): IngestionReceiptProviderOutcomeCode | null {
  const expectedCodes: Partial<
    Record<IngestionProviderOutcome, ReadonlySet<IngestionReceiptProviderOutcomeCode>>
  > = {
    malformed: new Set(['empty_response', 'invalid_json', 'non_object']),
    schema_invalid: new Set([
      'missing_required_field',
      'unexpected_field',
      'invalid_field_type',
      'invalid_field_value',
      'limit_exceeded',
    ]),
    provider_error: new Set(['provider_request_failed', 'unsupported_response_shape']),
  };
  const allowed = expectedCodes[outcome];
  if (allowed ? code === null || !allowed.has(code) : code !== null) {
    throw new Error('Provider outcome and outcome code do not match.');
  }
  return code;
}

function normalizeReceipt(
  input: CommitIngestionPersistenceReceiptInput,
  attemptNumber: number,
): IngestionPersistenceReceipt {
  return {
    jobId: requireIdentity(input.jobId, 'jobId'),
    attemptNumber,
    episodeId: input.episodeId === null ? null : requireIdentity(input.episodeId, 'episodeId'),
    deterministicFactIds: normalizeFactIds(input.deterministicFactIds, 'deterministicFactIds'),
    providerFactIds: normalizeFactIds(input.providerFactIds, 'providerFactIds'),
    invalidatedFactIds: normalizeFactIds(input.invalidatedFactIds, 'invalidatedFactIds'),
    bridgedEvidenceFactIds: normalizeFactIds(
      input.bridgedEvidenceFactIds,
      'bridgedEvidenceFactIds',
    ),
    agentRunMemoryFactIds: normalizeFactIds(
      input.agentRunMemoryFactIds,
      'agentRunMemoryFactIds',
    ),
    activeFocusUpdated: input.activeFocusUpdated,
    openThreadsUpdated: input.openThreadsUpdated,
    providerOutcome: input.providerOutcome,
    providerOutcomeCode: requireProviderOutcomeCode(
      input.providerOutcome,
      input.providerOutcomeCode,
    ),
    persistedAt: requirePersistedAt(input.persistedAt),
  };
}

function parseFactIds(raw: string, label: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new Error(`Invalid ${label} in memory ingestion receipt.`);
  }
  return normalizeFactIds(parsed, label);
}

function rowToReceipt(row: IngestionReceiptRow): IngestionPersistenceReceipt {
  return {
    jobId: row.job_id,
    attemptNumber: row.attempt_number,
    episodeId: row.episode_id,
    deterministicFactIds: parseFactIds(
      row.deterministic_fact_ids_json,
      'deterministicFactIds',
    ),
    providerFactIds: parseFactIds(row.provider_fact_ids_json, 'providerFactIds'),
    invalidatedFactIds: parseFactIds(row.invalidated_fact_ids_json, 'invalidatedFactIds'),
    bridgedEvidenceFactIds: parseFactIds(
      row.bridged_evidence_fact_ids_json,
      'bridgedEvidenceFactIds',
    ),
    agentRunMemoryFactIds: parseFactIds(
      row.agent_run_memory_fact_ids_json,
      'agentRunMemoryFactIds',
    ),
    activeFocusUpdated: row.active_focus_updated !== 0,
    openThreadsUpdated: row.open_threads_updated !== 0,
    providerOutcome: row.provider_outcome,
    providerOutcomeCode: row.provider_outcome_code,
    persistedAt: row.persisted_at,
  };
}

function receiptsEqual(
  left: IngestionPersistenceReceipt,
  right: IngestionPersistenceReceipt,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function transitionClaimedJob(receipt: IngestionPersistenceReceipt, claimToken: string): boolean {
  if (receipt.providerOutcome === 'structural_only') {
    return completeIngestionJob(
      receipt.jobId,
      'completed_structural',
      receipt.providerOutcome,
      receipt.persistedAt,
      claimToken,
    );
  }
  if (receipt.providerOutcome === 'valid' || receipt.providerOutcome === 'empty_valid') {
    return completeIngestionJob(
      receipt.jobId,
      'completed_enriched',
      receipt.providerOutcome,
      receipt.persistedAt,
      claimToken,
    );
  }
  return markIngestionJobStructuralComplete(receipt.jobId, receipt.persistedAt, claimToken);
}

export function commitIngestionPersistenceReceipt(
  input: CommitIngestionPersistenceReceiptInput,
): IngestionPersistenceReceipt {
  return runMemoryTransaction(() => {
    const db = getMemoryDb();
    const jobId = requireIdentity(input.jobId, 'jobId');
    const claimToken = requireIdentity(input.claimToken, 'claimToken');
    const persistedAt = requirePersistedAt(input.persistedAt);
    const claim = db.getFirstSync<{ attempt_number: number }>(
      `SELECT attempt_count AS attempt_number
         FROM memory_ingestion_jobs
        WHERE id = ?
          AND status = 'processing'
          AND claim_token = ?
          AND lease_expires_at > ?
        LIMIT 1`,
      jobId,
      claimToken,
      persistedAt,
    );
    if (!claim) throw new IngestionReceiptCommitError('claim_lost');

    const receipt = normalizeReceipt(input, claim.attempt_number);
    const inserted = db.runSync(
      `INSERT OR IGNORE INTO memory_ingestion_receipts (
         job_id, attempt_number, episode_id, deterministic_fact_ids_json,
         provider_fact_ids_json, invalidated_fact_ids_json,
         bridged_evidence_fact_ids_json, agent_run_memory_fact_ids_json,
         active_focus_updated, open_threads_updated, provider_outcome,
         provider_outcome_code, persisted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.jobId,
      receipt.attemptNumber,
      receipt.episodeId,
      JSON.stringify(receipt.deterministicFactIds),
      JSON.stringify(receipt.providerFactIds),
      JSON.stringify(receipt.invalidatedFactIds),
      JSON.stringify(receipt.bridgedEvidenceFactIds),
      JSON.stringify(receipt.agentRunMemoryFactIds),
      receipt.activeFocusUpdated ? 1 : 0,
      receipt.openThreadsUpdated ? 1 : 0,
      receipt.providerOutcome,
      receipt.providerOutcomeCode,
      receipt.persistedAt,
    );
    if ((inserted.changes ?? 0) === 0) {
      const existing = getIngestionPersistenceReceipt(receipt.jobId, receipt.attemptNumber);
      if (!existing || !receiptsEqual(existing, receipt)) {
        throw new IngestionReceiptCommitError('identity_conflict');
      }
    }
    if (!transitionClaimedJob(receipt, claimToken)) {
      throw new IngestionReceiptCommitError('transition_rejected');
    }
    return receipt;
  });
}

export function getIngestionPersistenceReceipt(
  jobId: string,
  attemptNumber: number,
): IngestionPersistenceReceipt | null {
  ensureFactSchema();
  const normalizedJobId = requireIdentity(jobId, 'jobId');
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error('attemptNumber must be a positive safe integer.');
  }
  const row = getMemoryDb().getFirstSync<IngestionReceiptRow>(
    `SELECT * FROM memory_ingestion_receipts
      WHERE job_id = ? AND attempt_number = ?
      LIMIT 1`,
    normalizedJobId,
    attemptNumber,
  );
  return row ? rowToReceipt(row) : null;
}

export function listIngestionPersistenceReceipts(
  jobId: string,
): IngestionPersistenceReceipt[] {
  ensureFactSchema();
  const rows = getMemoryDb().getAllSync<IngestionReceiptRow>(
    `SELECT * FROM memory_ingestion_receipts
      WHERE job_id = ?
      ORDER BY attempt_number ASC`,
    requireIdentity(jobId, 'jobId'),
  );
  return rows.map(rowToReceipt);
}
