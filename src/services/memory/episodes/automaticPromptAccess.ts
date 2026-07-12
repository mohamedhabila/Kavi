import type { MemoryDatabase } from '../access/schemaGuard';
import { getMemoryDb } from '../database';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
  type RequiredMemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import { decideAutomaticPromptEpisodeAccess } from './accessPolicy';
import { ensureEpisodeAccessPolicySchema } from './accessPolicySchema';
import type {
  AuthorizedCurrentThreadEpisodeSelection,
  AuthorizedEpisodeOrigin,
  EpisodeAccessPolicyRow,
  EpisodeRecallSelection,
} from './accessPolicyTypes';
import { episodeQueryUnits, scoreEpisodesForQuery, sortScoredEpisodes } from './queryScoring';
import { rowToEpisode, type EpisodeRow } from './types';

export const AUTOMATIC_CURRENT_EPISODE_CANDIDATE_LIMIT = 80;

interface CurrentPromptCandidateRow extends EpisodeRow {
  policy_episode_id: string;
  policy_memory_owner_id: string;
  policy_memory_conversation_id: string;
  policy_source_thread_id: string;
  policy_persona_id: string;
  policy_task_id: string | null;
  policy_shareability: string;
  policy_sensitivity: string;
  policy_expires_at: number | null;
  policy_version: number;
  policy_bound_at: number;
  withdrawn: number;
}

interface WithdrawalPresenceRow {
  withdrawn: number;
}

export interface AutomaticCurrentEpisodeRecallTiming {
  queryUnitCount: number;
  candidateLimit: number;
  candidateCount: number;
  resultLimit: number;
  resultCount: number;
  fetchMs: number;
  policyMs: number;
  scoreMs: number;
  sortMs: number;
  totalMs: number;
}

function policyRow(row: CurrentPromptCandidateRow): EpisodeAccessPolicyRow {
  return {
    episode_id: row.policy_episode_id,
    memory_owner_id: row.policy_memory_owner_id,
    memory_conversation_id: row.policy_memory_conversation_id,
    source_thread_id: row.policy_source_thread_id,
    persona_id: row.policy_persona_id,
    task_id: row.policy_task_id,
    shareability: row.policy_shareability,
    sensitivity: row.policy_sensitivity,
    expires_at: row.policy_expires_at,
    policy_version: row.policy_version,
    bound_at: row.policy_bound_at,
  };
}

function authorizedOrigin(
  scope: RequiredMemoryAccessScopeIdentity,
): AuthorizedEpisodeOrigin {
  return { ...scope, policyVersion: 1 };
}

function sameOrigin(
  left: AuthorizedEpisodeOrigin,
  right: AuthorizedEpisodeOrigin,
): boolean {
  return (
    left.memoryOwnerId === right.memoryOwnerId &&
    left.memoryConversationId === right.memoryConversationId &&
    left.sourceThreadId === right.sourceThreadId &&
    left.personaId === right.personaId &&
    left.taskId === right.taskId &&
    left.policyVersion === right.policyVersion
  );
}

function selectedCurrentEpisode(
  row: CurrentPromptCandidateRow,
  origin: AuthorizedEpisodeOrigin,
  relevanceScore: number,
): AuthorizedCurrentThreadEpisodeSelection {
  return {
    episode: rowToEpisode(row),
    lane: 'current_thread',
    authorizedOrigin: origin,
    accessDecision: { authorized: true, reason: 'eligible' },
    relevanceScore,
  };
}

function taskClauses(scope: RequiredMemoryAccessScopeIdentity): {
  clauses: string[];
  params: string[];
} {
  return scope.taskId === null
    ? { clauses: ['episode.task_id IS NULL', 'policy.task_id IS NULL'], params: [] }
    : {
        clauses: ['episode.task_id = ?', 'policy.task_id = ?'],
        params: [scope.taskId, scope.taskId],
      };
}

function fetchCurrentPromptCandidates(input: {
  db: MemoryDatabase;
  scope: RequiredMemoryAccessScopeIdentity;
  now: number;
  queryUnits: ReadonlySet<string>;
  maxAgeMs?: number;
}): CurrentPromptCandidateRow[] {
  const units = Array.from(input.queryUnits);
  const task = taskClauses(input.scope);
  const timeClauses = ['episode.ended_at <= ?', 'episode.created_at <= ?'];
  const timeParams: number[] = [input.now, input.now];
  if (typeof input.maxAgeMs === 'number' && input.maxAgeMs > 0) {
    timeClauses.push('episode.ended_at > ?');
    timeParams.push(input.now - input.maxAgeMs);
  }
  const matchedSource =
    units.length > 0
      ? `(
         SELECT episode_id, COUNT(*) AS lexical_hits
           FROM memory_episode_terms
          WHERE unit IN (${units.map(() => '?').join(', ')})
          GROUP BY episode_id
       ) AS matched
       JOIN memory_episodes AS episode ON episode.id = matched.episode_id`
      : `(
         SELECT id AS episode_id, 0 AS lexical_hits
           FROM memory_episodes
       ) AS matched
       JOIN memory_episodes AS episode ON episode.id = matched.episode_id`;

  return input.db.getAllSync<CurrentPromptCandidateRow>(
    `SELECT episode.*,
            policy.episode_id AS policy_episode_id,
            policy.memory_owner_id AS policy_memory_owner_id,
            policy.memory_conversation_id AS policy_memory_conversation_id,
            policy.source_thread_id AS policy_source_thread_id,
            policy.persona_id AS policy_persona_id,
            policy.task_id AS policy_task_id,
            policy.shareability AS policy_shareability,
            policy.sensitivity AS policy_sensitivity,
            policy.expires_at AS policy_expires_at,
            policy.policy_version AS policy_version,
            policy.bound_at AS policy_bound_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM memory_withdrawal_sources AS withdrawn
               WHERE withdrawn.memory_conversation_id = episode.conversation_id
                 AND withdrawn.source_thread_id = episode.thread_id
                 AND withdrawn.task_id = COALESCE(episode.task_id, '')
                 AND (
                   (withdrawn.source_kind = 'message' AND EXISTS (
                     SELECT 1
                       FROM (
                         SELECT source.value, source.type
                           FROM json_each(
                             CASE WHEN json_valid(episode.message_ids_json)
                               THEN episode.message_ids_json ELSE '[]' END
                           ) AS source
                          LIMIT 128
                       ) AS episode_source
                      WHERE episode_source.type = 'text'
                        AND episode_source.value = withdrawn.source_id
                   ))
                   OR (withdrawn.source_kind = 'turn'
                     AND withdrawn.source_id = episode.source_end_message_id)
                 )
            ) THEN 1 ELSE 0 END AS withdrawn
       FROM ${matchedSource}
       JOIN memory_episode_access_policies AS policy ON policy.episode_id = episode.id
      WHERE episode.conversation_id = ?
        AND episode.thread_id = ?
        AND policy.memory_owner_id = ?
        AND policy.memory_conversation_id = episode.conversation_id
        AND policy.source_thread_id = episode.thread_id
        AND policy.persona_id = ?
        AND ${task.clauses.join(' AND ')}
        AND episode.sensitivity = 'normal'
        AND policy.sensitivity = 'normal'
        AND policy.policy_version = 1
        AND policy.bound_at <= ?
        AND (policy.expires_at IS NULL OR policy.expires_at > ?)
        AND episode.deleted_at IS NULL
        AND ${timeClauses.join(' AND ')}
        AND episode.source_start_message_id IS NOT NULL
        AND episode.source_end_message_id IS NOT NULL
      ORDER BY matched.lexical_hits DESC,
               episode.importance DESC,
               episode.ended_at DESC,
               episode.id ASC
      LIMIT ${AUTOMATIC_CURRENT_EPISODE_CANDIDATE_LIMIT}`,
    ...units,
    input.scope.memoryConversationId,
    input.scope.sourceThreadId,
    input.scope.memoryOwnerId,
    input.scope.personaId,
    ...task.params,
    input.now,
    input.now,
    ...timeParams,
  );
}

export function loadAuthorizedCurrentThreadEpisodes(input: {
  db?: MemoryDatabase;
  currentScope: MemoryAccessScopeIdentity;
  now: number;
  query: string;
  resultLimit: number;
  maxAgeMs?: number;
}): {
  selections: AuthorizedCurrentThreadEpisodeSelection[];
  timing: AutomaticCurrentEpisodeRecallTiming;
} {
  const totalStarted = Date.now();
  const db = input.db ?? getMemoryDb();
  const scope = requireMemoryAccessScopeIdentity(input.currentScope);
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new Error('automatic_episode_recall_timestamp_invalid');
  }
  if (!Number.isSafeInteger(input.resultLimit) || input.resultLimit < 0) {
    throw new Error('automatic_episode_recall_limit_invalid');
  }
  const queryUnits = episodeQueryUnits(input.query);
  const fetchStarted = Date.now();
  ensureEpisodeAccessPolicySchema(db, input.now);
  const rows =
    scope.memoryOwnerId === getLocalMemoryVaultOwnerId(db)
      ? fetchCurrentPromptCandidates({
          db,
          scope,
          now: input.now,
          queryUnits,
          ...(input.maxAgeMs === undefined ? {} : { maxAgeMs: input.maxAgeMs }),
        })
      : [];
  const fetchMs = Date.now() - fetchStarted;
  const policyStarted = Date.now();
  const authorized: AuthorizedCurrentThreadEpisodeSelection[] = [];
  for (const row of rows) {
    const decision = decideAutomaticPromptEpisodeAccess({
      episode: row,
      policyRow: policyRow(row),
      currentScope: scope,
      now: input.now,
      withdrawn: row.withdrawn !== 0,
    });
    if (!decision.authorized || decision.lane !== 'current_thread') continue;
    authorized.push(selectedCurrentEpisode(row, authorizedOrigin(decision.policy.scope), 0));
  }
  const policyMs = Date.now() - policyStarted;
  const scoreStarted = Date.now();
  const scored =
    queryUnits.size > 0
      ? scoreEpisodesForQuery(
          authorized.map((selection) => selection.episode),
          queryUnits,
        )
      : authorized.map((selection) => ({ episode: selection.episode, score: 0 }));
  const scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  const ranked = queryUnits.size > 0 ? sortScoredEpisodes(scored) : scored;
  const sortMs = Date.now() - sortStarted;
  const byId = new Map(authorized.map((selection) => [selection.episode.id, selection]));
  const selections = ranked.slice(0, input.resultLimit).map((entry) => ({
    ...byId.get(entry.episode.id)!,
    relevanceScore: entry.score,
  }));
  return {
    selections,
    timing: {
      queryUnitCount: queryUnits.size,
      candidateLimit: AUTOMATIC_CURRENT_EPISODE_CANDIDATE_LIMIT,
      candidateCount: rows.length,
      resultLimit: input.resultLimit,
      resultCount: selections.length,
      fetchMs,
      policyMs,
      scoreMs,
      sortMs,
      totalMs: Date.now() - totalStarted,
    },
  };
}

function withdrawalPresence(db: MemoryDatabase, episode: EpisodeRow): boolean {
  const row = db.getFirstSync<WithdrawalPresenceRow>(
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
                    FROM json_each(CASE WHEN json_valid(?) THEN ? ELSE '[]' END) AS source
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
  return row?.withdrawn === 1;
}

/** Re-reads policy, sensitivity, provenance, and withdrawal state before reuse. */
export function revalidateAutomaticPromptEpisodeOrigin(input: {
  db?: MemoryDatabase;
  currentScope: MemoryAccessScopeIdentity;
  episodeId: string;
  lane: EpisodeRecallSelection['lane'];
  authorizedOrigin: AuthorizedEpisodeOrigin;
  relevanceScore: number;
  asOf: number;
}): EpisodeRecallSelection | null {
  if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) return null;
  let scope: RequiredMemoryAccessScopeIdentity;
  try {
    scope = requireMemoryAccessScopeIdentity(input.currentScope);
  } catch {
    return null;
  }
  const db = input.db ?? getMemoryDb();
  ensureEpisodeAccessPolicySchema(db, input.asOf);
  if (scope.memoryOwnerId !== getLocalMemoryVaultOwnerId(db)) return null;
  const episode = db.getFirstSync<EpisodeRow>(
    'SELECT * FROM memory_episodes WHERE id = ? LIMIT 1',
    input.episodeId,
  );
  const persistedPolicy = db.getFirstSync<EpisodeAccessPolicyRow>(
    'SELECT * FROM memory_episode_access_policies WHERE episode_id = ? LIMIT 1',
    input.episodeId,
  );
  if (!episode || !persistedPolicy) return null;
  const decision = decideAutomaticPromptEpisodeAccess({
    episode,
    policyRow: persistedPolicy,
    currentScope: scope,
    now: input.asOf,
    withdrawn: withdrawalPresence(db, episode),
  });
  if (!decision.authorized || decision.lane !== input.lane) return null;
  const origin = authorizedOrigin(decision.policy.scope);
  if (!sameOrigin(origin, input.authorizedOrigin) || !Number.isFinite(input.relevanceScore)) {
    return null;
  }
  return {
    episode: rowToEpisode(episode),
    lane: decision.lane,
    authorizedOrigin: origin,
    accessDecision: { authorized: true, reason: 'eligible' },
    relevanceScore: input.relevanceScore,
  } as EpisodeRecallSelection;
}

export function revalidateAutomaticPromptEpisodeSelection(input: {
  db?: MemoryDatabase;
  currentScope: MemoryAccessScopeIdentity;
  selection: EpisodeRecallSelection;
  asOf: number;
}): EpisodeRecallSelection | null {
  if (
    !input.selection.accessDecision.authorized ||
    input.selection.accessDecision.reason !== 'eligible'
  ) {
    return null;
  }
  return revalidateAutomaticPromptEpisodeOrigin({
    ...(input.db ? { db: input.db } : {}),
    currentScope: input.currentScope,
    episodeId: input.selection.episode.id,
    lane: input.selection.lane,
    authorizedOrigin: input.selection.authorizedOrigin,
    relevanceScore: input.selection.relevanceScore,
    asOf: input.asOf,
  });
}
