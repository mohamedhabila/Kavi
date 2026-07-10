import type { MemoryDatabase } from '../access/schemaGuard';
import {
  isExactMemoryScopeId,
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import {
  decideCrossThreadEpisodeAccess,
  hasCompleteEpisodeSource,
  episodeAccessPolicyFromRow,
} from './accessPolicy';
import { ensureEpisodeAccessPolicySchema } from './accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  EPISODE_SENSITIVITY,
  EPISODE_SHAREABILITY,
  type AuthorizedEpisodeOrigin,
  type EpisodeAccessPolicy,
  type EpisodeAccessPolicyInput,
  type EpisodeAccessPolicyRow,
} from './accessPolicyTypes';
import type { EpisodeRow } from './types';

interface WithdrawalPresenceRow {
  withdrawn: number;
}

function safeTimestamp(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function normalizePolicyInput(input: EpisodeAccessPolicyInput, now: number): EpisodeAccessPolicy {
  if (!isExactMemoryScopeId(input.episodeId)) {
    throw new Error('episode_access_episode_id_invalid');
  }
  if (!EPISODE_SHAREABILITY.includes(input.shareability)) {
    throw new Error('episode_access_shareability_invalid');
  }
  if (!EPISODE_SENSITIVITY.includes(input.sensitivity)) {
    throw new Error('episode_access_sensitivity_invalid');
  }
  const boundAt = safeTimestamp(input.boundAt ?? now, 'episode_access_bound_at_invalid');
  if (boundAt > now) throw new Error('episode_access_bound_at_future');
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null) {
    safeTimestamp(expiresAt, 'episode_access_expires_at_invalid');
    if (expiresAt <= boundAt) throw new Error('episode_access_expiry_not_future');
  }
  return {
    episodeId: input.episodeId,
    scope: requireMemoryAccessScopeIdentity(input),
    shareability: input.shareability,
    sensitivity: input.sensitivity,
    expiresAt,
    policyVersion: 1,
    boundAt,
  };
}

function policyMatches(left: EpisodeAccessPolicy, right: EpisodeAccessPolicy): boolean {
  // The first persisted boundAt remains authoritative across exact source replays.
  return (
    left.episodeId === right.episodeId &&
    left.scope.memoryOwnerId === right.scope.memoryOwnerId &&
    left.scope.memoryConversationId === right.scope.memoryConversationId &&
    left.scope.sourceThreadId === right.scope.sourceThreadId &&
    left.scope.personaId === right.scope.personaId &&
    left.scope.taskId === right.scope.taskId &&
    left.shareability === right.shareability &&
    left.sensitivity === right.sensitivity &&
    left.expiresAt === right.expiresAt &&
    left.policyVersion === right.policyVersion
  );
}

export function getEpisodeAccessPolicy(
  db: MemoryDatabase,
  episodeId: string,
): EpisodeAccessPolicy | null {
  const row = db.getFirstSync<EpisodeAccessPolicyRow>(
    'SELECT * FROM memory_episode_access_policies WHERE episode_id = ? LIMIT 1',
    episodeId,
  );
  return row ? episodeAccessPolicyFromRow(row) : null;
}

export function bindEpisodeAccessPolicy(
  db: MemoryDatabase,
  input: EpisodeAccessPolicyInput,
  now = Date.now(),
): EpisodeAccessPolicy {
  const observedAt = safeTimestamp(now, 'episode_access_observed_at_invalid');
  const policy = normalizePolicyInput(input, observedAt);
  ensureEpisodeAccessPolicySchema(db, observedAt);
  if (policy.scope.memoryOwnerId !== getLocalMemoryVaultOwnerId(db)) {
    throw new Error('episode_access_owner_mismatch');
  }
  if (policy.shareability === 'session_threads' && policy.scope.taskId !== null) {
    throw new Error('episode_access_task_shareability_invalid');
  }
  const episode = db.getFirstSync<EpisodeRow>(
    'SELECT * FROM memory_episodes WHERE id = ? LIMIT 1',
    policy.episodeId,
  );
  if (!episode) throw new Error('episode_access_episode_not_found');
  if (
    episode.conversation_id !== policy.scope.memoryConversationId ||
    episode.thread_id !== policy.scope.sourceThreadId ||
    (episode.task_id ?? null) !== policy.scope.taskId
  ) {
    throw new Error('episode_access_origin_mismatch');
  }
  if (policy.shareability === 'session_threads' && !hasCompleteEpisodeSource(episode)) {
    throw new Error('episode_access_source_incomplete');
  }
  if (policy.boundAt < Math.max(episode.created_at, episode.ended_at)) {
    throw new Error('episode_access_bound_before_completion');
  }

  const existingRow = db.getFirstSync<EpisodeAccessPolicyRow>(
    'SELECT * FROM memory_episode_access_policies WHERE episode_id = ? LIMIT 1',
    policy.episodeId,
  );
  if (existingRow) {
    const existing = episodeAccessPolicyFromRow(existingRow);
    if (!existing) throw new Error('episode_access_policy_corrupt');
    if (!policyMatches(existing, policy)) throw new Error('episode_access_identity_conflict');
    return existing;
  }
  db.runSync(
    `INSERT INTO memory_episode_access_policies(
       episode_id, memory_owner_id, memory_conversation_id, source_thread_id,
       persona_id, task_id, shareability, sensitivity, expires_at,
       policy_version, bound_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    policy.episodeId,
    policy.scope.memoryOwnerId,
    policy.scope.memoryConversationId,
    policy.scope.sourceThreadId,
    policy.scope.personaId,
    policy.scope.taskId,
    policy.shareability,
    policy.sensitivity,
    policy.expiresAt,
    policy.boundAt,
  );
  return policy;
}

export function revalidateAuthorizedCrossThreadEpisodeOrigin(input: {
  db: MemoryDatabase;
  currentScope: MemoryAccessScopeIdentity;
  episodeId: string;
  authorizedOrigin: AuthorizedEpisodeOrigin;
  asOf: number;
}): AuthorizedEpisodeOrigin | null {
  if (
    !isExactMemoryScopeId(input.episodeId) ||
    !Number.isSafeInteger(input.asOf) ||
    input.asOf < 0
  ) {
    return null;
  }
  let currentScope;
  let selectedOrigin;
  try {
    currentScope = requireMemoryAccessScopeIdentity(input.currentScope);
    selectedOrigin = requireMemoryAccessScopeIdentity(input.authorizedOrigin);
  } catch {
    return null;
  }
  if (selectedOrigin.taskId !== null || input.authorizedOrigin.policyVersion !== 1) {
    return null;
  }

  ensureEpisodeAccessPolicySchema(input.db, input.asOf);
  if (currentScope.memoryOwnerId !== getLocalMemoryVaultOwnerId(input.db)) {
    return null;
  }
  const episode = input.db.getFirstSync<EpisodeRow>(
    'SELECT * FROM memory_episodes WHERE id = ? LIMIT 1',
    input.episodeId,
  );
  const policyRow = input.db.getFirstSync<EpisodeAccessPolicyRow>(
    'SELECT * FROM memory_episode_access_policies WHERE episode_id = ? LIMIT 1',
    input.episodeId,
  );
  if (!episode || !policyRow) return null;
  const withdrawal = input.db.getFirstSync<WithdrawalPresenceRow>(
    `SELECT CASE WHEN EXISTS (
       SELECT 1 FROM memory_withdrawal_sources AS withdrawn
        WHERE withdrawn.memory_conversation_id = ?
          AND withdrawn.source_thread_id = ?
          AND withdrawn.task_id = COALESCE(?, '')
          AND (
            (withdrawn.source_kind = 'message' AND EXISTS (
              SELECT 1
                FROM (
                  SELECT source.value, source.type
                    FROM json_each(
                      CASE WHEN json_valid(?) THEN ? ELSE '[]' END
                    ) AS source
                   LIMIT 128
                ) AS episode_source
               WHERE episode_source.type = 'text'
                 AND episode_source.value = withdrawn.source_id
            ))
            OR (withdrawn.source_kind = 'turn' AND withdrawn.source_id = ?)
          )
     ) THEN 1 ELSE 0 END AS withdrawn`,
    episode.conversation_id,
    episode.thread_id,
    episode.task_id,
    episode.message_ids_json,
    episode.message_ids_json,
    episode.source_end_message_id,
  );
  const decision = decideCrossThreadEpisodeAccess({
    episode,
    policyRow,
    currentScope,
    now: input.asOf,
    withdrawn: withdrawal?.withdrawn !== 0,
  });
  if (!decision.authorized) return null;
  const persistedOrigin: AuthorizedEpisodeOrigin = {
    memoryOwnerId: decision.policy.scope.memoryOwnerId,
    memoryConversationId: decision.policy.scope.memoryConversationId,
    sourceThreadId: decision.policy.scope.sourceThreadId,
    personaId: decision.policy.scope.personaId,
    taskId: null,
    policyVersion: decision.policy.policyVersion,
  };
  return persistedOrigin.memoryOwnerId === selectedOrigin.memoryOwnerId &&
    persistedOrigin.memoryConversationId === selectedOrigin.memoryConversationId &&
    persistedOrigin.sourceThreadId === selectedOrigin.sourceThreadId &&
    persistedOrigin.personaId === selectedOrigin.personaId
    ? persistedOrigin
    : null;
}
