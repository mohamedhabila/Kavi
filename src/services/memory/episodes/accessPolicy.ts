import {
  isExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import { isExactMemoryProvenanceId } from '../memoryProvenanceIdentity';
import type { EpisodeRow } from './types';
import {
  EPISODE_SENSITIVITY,
  EPISODE_SHAREABILITY,
  type CrossThreadEpisodeAccessDecision,
  type EpisodeAccessPolicy,
  type EpisodeAccessPolicyRow,
  type EpisodeSensitivity,
  type EpisodeShareability,
} from './accessPolicyTypes';

const SOURCE_MESSAGE_LIMIT = 128;
const TOOL_NAME_LIMIT = 64;
const TOOL_NAME_CHAR_LIMIT = 96;
const TEXT_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function closedValue<T extends string>(value: unknown, values: ReadonlyArray<T>): T | null {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : null;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function policyTaskId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isExactMemoryScopeId(value) ? value : undefined;
}

export function episodeAccessPolicyFromRow(
  row: EpisodeAccessPolicyRow,
): EpisodeAccessPolicy | null {
  const shareability = closedValue<EpisodeShareability>(row.shareability, EPISODE_SHAREABILITY);
  const sensitivity = closedValue<EpisodeSensitivity>(row.sensitivity, EPISODE_SENSITIVITY);
  const taskId = policyTaskId(row.task_id);
  if (
    !isExactMemoryScopeId(row.episode_id) ||
    !isExactMemoryScopeId(row.memory_owner_id) ||
    !isExactMemoryScopeId(row.memory_conversation_id) ||
    !isExactMemoryScopeId(row.source_thread_id) ||
    !isExactMemoryScopeId(row.persona_id) ||
    taskId === undefined ||
    !shareability ||
    !sensitivity ||
    (row.expires_at !== null && !validTimestamp(row.expires_at)) ||
    (row.expires_at !== null && row.expires_at <= row.bound_at) ||
    row.policy_version !== 1 ||
    !validTimestamp(row.bound_at)
  ) {
    return null;
  }
  return {
    episodeId: row.episode_id,
    scope: {
      memoryOwnerId: row.memory_owner_id,
      memoryConversationId: row.memory_conversation_id,
      sourceThreadId: row.source_thread_id,
      personaId: row.persona_id,
      taskId,
    },
    shareability,
    sensitivity,
    expiresAt: row.expires_at,
    policyVersion: 1,
    boundAt: row.bound_at,
  };
}

function strictMessageIds(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > SOURCE_MESSAGE_LIMIT ||
    !parsed.every(isExactMemoryProvenanceId)
  ) {
    return null;
  }
  const unique = new Set(parsed);
  return unique.size === parsed.length ? parsed : null;
}

function hasStrictToolNames(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) &&
    parsed.length <= TOOL_NAME_LIMIT &&
    parsed.every(
      (value) =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= TOOL_NAME_CHAR_LIMIT &&
        value === value.trim() &&
        !TEXT_CONTROL_CHARACTERS.test(value),
    )
  );
}

export function hasCompleteEpisodeSource(row: EpisodeRow): boolean {
  if (
    !isExactMemoryScopeId(row.id) ||
    !isExactMemoryScopeId(row.conversation_id) ||
    !isExactMemoryScopeId(row.thread_id) ||
    !isExactMemoryProvenanceId(row.source_start_message_id) ||
    !isExactMemoryProvenanceId(row.source_end_message_id) ||
    typeof row.summary !== 'string' ||
    !row.summary.trim() ||
    row.summary.length > 1_200 ||
    !hasStrictToolNames(row.tool_names_json)
  ) {
    return false;
  }
  const messageIds = strictMessageIds(row.message_ids_json);
  return Boolean(
    messageIds?.includes(row.source_start_message_id) &&
    messageIds.includes(row.source_end_message_id),
  );
}

function episodeTaskId(value: string | null): string | null | undefined {
  if (value === null) return null;
  return isExactMemoryScopeId(value) ? value : undefined;
}

function timeIsComplete(row: EpisodeRow, now: number): boolean {
  return (
    validTimestamp(row.started_at) &&
    validTimestamp(row.ended_at) &&
    validTimestamp(row.created_at) &&
    row.started_at <= row.ended_at &&
    row.ended_at <= now &&
    row.created_at <= now
  );
}

export function decideCrossThreadEpisodeAccess(input: {
  episode: EpisodeRow;
  policyRow: EpisodeAccessPolicyRow;
  currentScope: MemoryAccessScopeIdentity;
  now: number;
  withdrawn?: boolean;
}): CrossThreadEpisodeAccessDecision {
  let currentScope;
  try {
    currentScope = requireMemoryAccessScopeIdentity(input.currentScope);
  } catch {
    return { authorized: false, reason: 'invalid_context' };
  }
  if (!validTimestamp(input.now)) return { authorized: false, reason: 'invalid_context' };
  const policy = episodeAccessPolicyFromRow(input.policyRow);
  if (!policy) return { authorized: false, reason: 'invalid_policy' };
  if (input.withdrawn) return { authorized: false, reason: 'withdrawn' };
  if (input.episode.deleted_at !== null) return { authorized: false, reason: 'deleted' };

  const taskId = episodeTaskId(input.episode.task_id);
  if (
    taskId === undefined ||
    input.episode.id !== policy.episodeId ||
    input.episode.conversation_id !== policy.scope.memoryConversationId ||
    input.episode.thread_id !== policy.scope.sourceThreadId ||
    taskId !== policy.scope.taskId
  ) {
    return { authorized: false, reason: 'origin_mismatch' };
  }
  if (input.episode.thread_id === currentScope.sourceThreadId) {
    return { authorized: false, reason: 'current_thread' };
  }
  if (policy.scope.memoryOwnerId !== currentScope.memoryOwnerId) {
    return { authorized: false, reason: 'owner_mismatch' };
  }
  if (policy.scope.memoryConversationId !== currentScope.memoryConversationId) {
    return { authorized: false, reason: 'session_mismatch' };
  }
  if (policy.scope.personaId !== currentScope.personaId) {
    return { authorized: false, reason: 'persona_mismatch' };
  }
  if (policy.shareability !== 'session_threads') {
    return { authorized: false, reason: 'thread_only' };
  }
  if (taskId !== null) return { authorized: false, reason: 'task_local' };
  if (policy.sensitivity !== 'normal') {
    return { authorized: false, reason: 'private_or_sensitive' };
  }
  if (policy.expiresAt !== null && policy.expiresAt <= input.now) {
    return { authorized: false, reason: 'expired' };
  }
  if (policy.boundAt > input.now) {
    return { authorized: false, reason: 'policy_not_yet_bound' };
  }
  if (!timeIsComplete(input.episode, input.now)) {
    return { authorized: false, reason: 'not_yet_complete' };
  }
  if (!hasCompleteEpisodeSource(input.episode)) {
    return { authorized: false, reason: 'malformed_source' };
  }
  return { authorized: true, reason: 'eligible', policy };
}
