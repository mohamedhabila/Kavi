import type { IngestionJob, IngestionJobReason } from './ingestionQueueStore';
import { isExactMemoryScopeId } from './memoryScopeIdentity';
import {
  isExactMemoryProvenanceId,
  requireExactMemoryProvenanceId,
} from './memoryProvenanceIdentity';

export interface IngestionJobRow {
  id: string;
  thread_id: string;
  thread_title: string | null;
  memory_conversation_id: string;
  persona_id: string | null;
  task_id: string | null;
  source_run_id: string | null;
  chat_provider_id: string | null;
  chat_model: string | null;
  prior_user_message_id: string | null;
  source_start_message_id: string | null;
  source_end_message_id: string;
  source_at: number;
  reason: string;
  status: string;
  attempt_count: number;
  provider_enrichment: number;
  provider_outcome: string | null;
  outcome_code: string | null;
  next_attempt_at: number | null;
  lease_expires_at: number | null;
  claim_token: string | null;
  claim_process_epoch: string | null;
  structural_completed_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface IngestionSourceIdentity {
  threadId: string;
  threadTitle: string | null;
  memoryConversationId: string;
  personaId: string;
  taskId: string | null;
  priorUserMessageId: string | null;
  sourceStartMessageId: string | null;
  sourceEndMessageId: string;
  sourceRunId: string | null;
  sourceAt: number;
  chatProviderId: string | null;
  chatModel: string | null;
  reason: IngestionJobReason;
  providerEnrichment: boolean;
}

export function requireIngestionScopeIdentity(value: unknown, code: string): string {
  if (!isExactMemoryScopeId(value)) throw new Error(code);
  return value;
}

export function requireIngestionProvenanceIdentity(value: unknown, code: string): string {
  return requireExactMemoryProvenanceId(value, code);
}

export function optionalIngestionScopeIdentity(
  value: string | null | undefined,
  code: string,
): string | null {
  if (value === null || value === undefined) return null;
  return requireIngestionScopeIdentity(value, code);
}

export function optionalIngestionProvenanceIdentity(
  value: string | null | undefined,
  code: string,
): string | null {
  if (value === null || value === undefined) return null;
  return requireIngestionProvenanceIdentity(value, code);
}

export function requireIngestionTimestamp(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

export function isValidIngestionThreadTitle(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 500 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/u.test(value))
  );
}

function isOptionalIngestionScopeIdentity(value: unknown): value is string | null {
  return value === null || isExactMemoryScopeId(value);
}

function isOptionalIngestionProvenanceIdentity(value: unknown): value is string | null {
  return value === null || isExactMemoryProvenanceId(value);
}

export function rowToIngestionJob(row: IngestionJobRow): IngestionJob {
  return {
    id: row.id,
    threadId: row.thread_id,
    threadTitle: row.thread_title,
    memoryConversationId: row.memory_conversation_id,
    personaId: isExactMemoryScopeId(row.persona_id) ? row.persona_id : null,
    taskId: row.task_id,
    sourceRunId: row.source_run_id,
    chatProviderId: row.chat_provider_id,
    chatModel: row.chat_model,
    priorUserMessageId: row.prior_user_message_id,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    sourceAt: row.source_at,
    reason: row.reason as IngestionJobReason,
    status: row.status as IngestionJob['status'],
    attemptCount: row.attempt_count,
    providerEnrichment: row.provider_enrichment !== 0,
    providerOutcome: row.provider_outcome as IngestionJob['providerOutcome'],
    outcomeCode: row.outcome_code as IngestionJob['outcomeCode'],
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    claimToken: row.claim_token,
    claimProcessEpoch: row.claim_process_epoch,
    structuralCompletedAt: row.structural_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function requireMatchingIngestionSourceIdentity(
  row: IngestionJobRow,
  identity: IngestionSourceIdentity,
): IngestionJob {
  if (
    row.thread_id !== identity.threadId ||
    row.thread_title !== identity.threadTitle ||
    row.memory_conversation_id !== identity.memoryConversationId ||
    row.persona_id !== identity.personaId ||
    row.task_id !== identity.taskId ||
    row.prior_user_message_id !== identity.priorUserMessageId ||
    row.source_start_message_id !== identity.sourceStartMessageId ||
    row.source_end_message_id !== identity.sourceEndMessageId ||
    row.source_run_id !== identity.sourceRunId ||
    row.source_at !== identity.sourceAt ||
    row.chat_provider_id !== identity.chatProviderId ||
    row.chat_model !== identity.chatModel ||
    row.reason !== identity.reason ||
    (row.provider_enrichment !== 0) !== identity.providerEnrichment
  ) {
    throw new Error('memory_ingestion_source_identity_conflict');
  }
  return rowToIngestionJob(row);
}

export function hasSealedIngestionJobIdentity(
  job: IngestionJob,
): job is IngestionJob & { personaId: string } {
  return (
    isExactMemoryScopeId(job.id) &&
    isExactMemoryScopeId(job.threadId) &&
    isValidIngestionThreadTitle(job.threadTitle) &&
    isExactMemoryScopeId(job.memoryConversationId) &&
    isExactMemoryScopeId(job.personaId) &&
    isOptionalIngestionScopeIdentity(job.taskId) &&
    isOptionalIngestionProvenanceIdentity(job.sourceRunId) &&
    isOptionalIngestionScopeIdentity(job.chatProviderId) &&
    isOptionalIngestionProvenanceIdentity(job.chatModel) &&
    isOptionalIngestionProvenanceIdentity(job.priorUserMessageId) &&
    isOptionalIngestionProvenanceIdentity(job.sourceStartMessageId) &&
    isExactMemoryProvenanceId(job.sourceEndMessageId) &&
    Number.isSafeInteger(job.sourceAt) &&
    job.sourceAt >= 0 &&
    (job.reason === 'turn_completed' || job.reason === 'migration' || job.reason === 'manual') &&
    (job.chatProviderId === null) === (job.chatModel === null)
  );
}

export function ingestionIdentityFailureCode(
  job: IngestionJob,
): 'persona_scope_missing' | 'source_identity_invalid' {
  return job.personaId === null ? 'persona_scope_missing' : 'source_identity_invalid';
}
