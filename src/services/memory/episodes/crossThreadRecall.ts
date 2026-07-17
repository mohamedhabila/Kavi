import type { MemoryDatabase } from '../access/schemaGuard';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
} from '../memoryScopeIdentity';
import { decideCrossThreadEpisodeAccess } from './accessPolicy';
import { ensureEpisodeAccessPolicySchema } from './accessPolicySchema';
import { getLocalMemoryVaultOwnerId } from '../memoryVaultIdentity';
import {
  CROSS_THREAD_EPISODE_ACCESS_REASONS,
  type AuthorizedCrossThreadEpisodeSelection,
  type AuthorizedCurrentThreadEpisodeSelection,
  type CrossThreadEpisodeAccessReason,
  type CrossThreadEpisodeRecallDiagnostics,
  type EpisodeAccessPolicyRow,
  type EpisodeRecallSelection,
} from './accessPolicyTypes';
import { episodePromptLineCost } from './promptRendering';
import {
  episodeQueryUnits,
  scoreEpisodesForQuery,
  selectSemanticAndRecentEpisodes,
  sortScoredEpisodes,
} from './queryScoring';
import { rowToEpisode, type EpisodeRow } from './types';

export const CROSS_THREAD_EPISODE_INDEXED_CANDIDATE_LIMIT = 80;
export const CROSS_THREAD_EPISODE_CANDIDATE_LIMIT = 12;
export const CROSS_THREAD_EPISODE_THREAD_FANOUT = 3;
export const CROSS_THREAD_EPISODE_PER_THREAD_LIMIT = 4;
export const CROSS_THREAD_EPISODE_SELECTION_LIMIT = 3;
export const CROSS_THREAD_EPISODE_PROMPT_BUDGET_CHARS = 840;

interface CrossThreadEpisodeCandidateRow extends EpisodeRow {
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

export interface CrossThreadEpisodeCandidateResult {
  candidates: AuthorizedCrossThreadEpisodeSelection[];
  diagnostics: CrossThreadEpisodeRecallDiagnostics;
}

export interface MergedEpisodeRecallResult {
  selections: EpisodeRecallSelection[];
  crossThreadDiagnostics: CrossThreadEpisodeRecallDiagnostics;
}

function policyRow(row: CrossThreadEpisodeCandidateRow): EpisodeAccessPolicyRow {
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

function emptyReasonCounts(): Map<CrossThreadEpisodeAccessReason, number> {
  return new Map(CROSS_THREAD_EPISODE_ACCESS_REASONS.map((reason) => [reason, 0]));
}

function diagnostics(
  counts: ReadonlyMap<CrossThreadEpisodeAccessReason, number>,
  values: Omit<CrossThreadEpisodeRecallDiagnostics, 'reasonCounts'>,
): CrossThreadEpisodeRecallDiagnostics {
  return {
    ...values,
    reasonCounts: CROSS_THREAD_EPISODE_ACCESS_REASONS.flatMap((reason) => {
      const count = counts.get(reason) ?? 0;
      return count > 0 ? [{ reason, count }] : [];
    }),
  };
}

function fetchCandidateRows(
  db: MemoryDatabase,
  scope: ReturnType<typeof requireMemoryAccessScopeIdentity>,
  now: number,
  queryUnits: ReadonlySet<string>,
): CrossThreadEpisodeCandidateRow[] {
  const units = Array.from(queryUnits);
  if (units.length === 0) return [];
  return db.getAllSync<CrossThreadEpisodeCandidateRow>(
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
              SELECT 1 FROM memory_retired_sources AS withdrawn
               WHERE withdrawn.memory_owner_id = policy.memory_owner_id
                 AND withdrawn.memory_conversation_id = episode.conversation_id
                 AND withdrawn.source_thread_id = episode.thread_id
                 AND withdrawn.task_id = COALESCE(episode.task_id, '')
                AND (
                  (withdrawn.source_kind = 'message'
                    AND EXISTS (
                      SELECT 1
                        FROM (
                          SELECT source.value, source.type
                            FROM json_each(
                              CASE
                                WHEN json_valid(episode.message_ids_json)
                                  THEN episode.message_ids_json
                                ELSE '[]'
                              END
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
       FROM (
         SELECT episode_id, COUNT(*) AS lexical_hits
           FROM memory_episode_terms
          WHERE unit IN (${units.map(() => '?').join(', ')})
          GROUP BY episode_id
       ) AS matched
       JOIN memory_episode_access_policies AS policy ON policy.episode_id = matched.episode_id
       JOIN memory_episodes AS episode ON episode.id = policy.episode_id
      WHERE policy.memory_owner_id = ?
        AND policy.memory_conversation_id = ?
        AND policy.persona_id = ?
        AND policy.source_thread_id != ?
        AND policy.shareability = 'session_threads'
        AND policy.sensitivity = 'normal'
        AND episode.sensitivity = 'normal'
        AND policy.task_id IS NULL
        AND policy.bound_at <= ?
        AND (policy.expires_at IS NULL OR policy.expires_at > ?)
        AND episode.task_id IS NULL
        AND episode.deleted_at IS NULL
        AND episode.ended_at <= ?
        AND episode.created_at <= ?
        AND episode.source_start_message_id IS NOT NULL
        AND episode.source_end_message_id IS NOT NULL
      ORDER BY matched.lexical_hits DESC,
               episode.importance DESC,
               episode.ended_at DESC,
               episode.id ASC
      LIMIT ${CROSS_THREAD_EPISODE_INDEXED_CANDIDATE_LIMIT}`,
    ...units,
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.personaId,
    scope.sourceThreadId,
    now,
    now,
    now,
    now,
  );
}

function emptyDiagnostics(input: {
  queryUnitCount: number;
  emptyQuerySuppressed?: boolean;
  reasonCounts?: ReadonlyMap<CrossThreadEpisodeAccessReason, number>;
  fetchMs?: number;
  totalMs?: number;
}): CrossThreadEpisodeRecallDiagnostics {
  return diagnostics(input.reasonCounts ?? emptyReasonCounts(), {
    queryUnitCount: input.queryUnitCount,
    emptyQuerySuppressed: input.emptyQuerySuppressed ?? false,
    scannedCount: 0,
    eligibleCount: 0,
    relevanceRejectedCount: 0,
    selectedCount: 0,
    threadFanoutDroppedCount: 0,
    selectionLimitDroppedCount: 0,
    promptBudgetDroppedCount: 0,
    fetchMs: input.fetchMs ?? 0,
    policyMs: 0,
    scoreMs: 0,
    sortMs: 0,
    selectionMs: 0,
    totalMs: input.totalMs ?? 0,
  });
}

export function loadAuthorizedCrossThreadEpisodeCandidates(input: {
  db: MemoryDatabase;
  currentScope: MemoryAccessScopeIdentity;
  now: number;
  query: string;
}): CrossThreadEpisodeCandidateResult {
  const totalStarted = Date.now();
  const scope = requireMemoryAccessScopeIdentity(input.currentScope);
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new Error('cross_thread_episode_timestamp_invalid');
  }
  const queryUnits = episodeQueryUnits(input.query);
  if (queryUnits.size === 0) {
    return {
      candidates: [],
      diagnostics: emptyDiagnostics({
        queryUnitCount: 0,
        emptyQuerySuppressed: true,
        totalMs: Date.now() - totalStarted,
      }),
    };
  }
  const fetchStarted = Date.now();
  ensureEpisodeAccessPolicySchema(input.db, input.now);
  const reasonCounts = emptyReasonCounts();
  if (scope.memoryOwnerId !== getLocalMemoryVaultOwnerId(input.db)) {
    const fetchMs = Date.now() - fetchStarted;
    reasonCounts.set('owner_mismatch', 1);
    return {
      candidates: [],
      diagnostics: emptyDiagnostics({
        queryUnitCount: queryUnits.size,
        reasonCounts,
        fetchMs,
        totalMs: Date.now() - totalStarted,
      }),
    };
  }

  const rows = fetchCandidateRows(input.db, scope, input.now, queryUnits);
  const fetchMs = Date.now() - fetchStarted;
  const authorized: AuthorizedCrossThreadEpisodeSelection[] = [];
  let eligibleCount = 0;
  const policyStarted = Date.now();
  for (const row of rows) {
    const decision = decideCrossThreadEpisodeAccess({
      episode: row,
      policyRow: policyRow(row),
      currentScope: scope,
      now: input.now,
      withdrawn: row.withdrawn !== 0,
    });
    reasonCounts.set(decision.reason, (reasonCounts.get(decision.reason) ?? 0) + 1);
    if (!decision.authorized) continue;
    eligibleCount += 1;
    const sourceThreadId = decision.policy.scope.sourceThreadId;
    authorized.push({
      episode: rowToEpisode(row),
      lane: 'cross_thread',
      authorizedOrigin: {
        memoryOwnerId: decision.policy.scope.memoryOwnerId,
        memoryConversationId: decision.policy.scope.memoryConversationId,
        sourceThreadId,
        personaId: decision.policy.scope.personaId,
        taskId: null,
        policyVersion: 1,
      },
      policyExpiresAt: decision.policy.expiresAt,
      accessDecision: { authorized: true, reason: 'eligible' },
      relevanceScore: 0,
    });
  }
  const policyMs = Date.now() - policyStarted;

  const byId = new Map(authorized.map((candidate) => [candidate.episode.id, candidate]));
  const scoreStarted = Date.now();
  const scored = scoreEpisodesForQuery(
    authorized.map((candidate) => candidate.episode),
    queryUnits,
  );
  const scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  const ranked = selectSemanticAndRecentEpisodes(
    sortScoredEpisodes(scored),
    CROSS_THREAD_EPISODE_INDEXED_CANDIDATE_LIMIT,
  );
  const sortMs = Date.now() - sortStarted;
  const selectionStarted = Date.now();
  const candidates: AuthorizedCrossThreadEpisodeSelection[] = [];
  const acceptedThreads = new Set<string>();
  const perThread = new Map<string, number>();
  let threadFanoutDroppedCount = 0;
  let selectionLimitDroppedCount = 0;
  for (const scored of ranked) {
    const candidate = byId.get(scored.episode.id)!;
    const sourceThreadId = candidate.authorizedOrigin.sourceThreadId;
    if (
      !acceptedThreads.has(sourceThreadId) &&
      acceptedThreads.size >= CROSS_THREAD_EPISODE_THREAD_FANOUT
    ) {
      threadFanoutDroppedCount += 1;
      continue;
    }
    if ((perThread.get(sourceThreadId) ?? 0) >= CROSS_THREAD_EPISODE_PER_THREAD_LIMIT) {
      selectionLimitDroppedCount += 1;
      continue;
    }
    if (candidates.length >= CROSS_THREAD_EPISODE_CANDIDATE_LIMIT) {
      selectionLimitDroppedCount += 1;
      continue;
    }
    acceptedThreads.add(sourceThreadId);
    perThread.set(sourceThreadId, (perThread.get(sourceThreadId) ?? 0) + 1);
    candidates.push({ ...candidate, relevanceScore: scored.score });
  }
  const selectionMs = Date.now() - selectionStarted;
  return {
    candidates,
    diagnostics: diagnostics(reasonCounts, {
      queryUnitCount: queryUnits.size,
      emptyQuerySuppressed: false,
      scannedCount: rows.length,
      eligibleCount,
      relevanceRejectedCount: authorized.length - ranked.length,
      selectedCount: candidates.length,
      threadFanoutDroppedCount,
      selectionLimitDroppedCount,
      promptBudgetDroppedCount: 0,
      fetchMs,
      policyMs,
      scoreMs,
      sortMs,
      selectionMs,
      totalMs: Date.now() - totalStarted,
    }),
  };
}

function boundedLimit(value: number, maximum: number, code: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return Math.min(Math.floor(value), maximum);
}

export function selectBoundedCrossThreadEpisodes(
  result: CrossThreadEpisodeCandidateResult,
  requestedLimit = CROSS_THREAD_EPISODE_SELECTION_LIMIT,
): CrossThreadEpisodeCandidateResult {
  const limit = boundedLimit(
    requestedLimit,
    CROSS_THREAD_EPISODE_SELECTION_LIMIT,
    'cross_thread_episode_selection_limit_invalid',
  );
  const selected: AuthorizedCrossThreadEpisodeSelection[] = [];
  let promptChars = 0;
  let selectionLimitDroppedCount = result.diagnostics.selectionLimitDroppedCount;
  let promptBudgetDroppedCount = result.diagnostics.promptBudgetDroppedCount;
  for (const candidate of result.candidates) {
    if (selected.length >= limit) {
      selectionLimitDroppedCount += 1;
      continue;
    }
    const cost = episodePromptLineCost(candidate);
    if (promptChars + cost > CROSS_THREAD_EPISODE_PROMPT_BUDGET_CHARS) {
      promptBudgetDroppedCount += 1;
      continue;
    }
    selected.push(candidate);
    promptChars += cost;
  }
  return {
    candidates: selected,
    diagnostics: {
      ...result.diagnostics,
      selectedCount: selected.length,
      selectionLimitDroppedCount,
      promptBudgetDroppedCount,
    },
  };
}

export function mergeCurrentAndCrossThreadEpisodes(
  currentThreadEpisodes: ReadonlyArray<AuthorizedCurrentThreadEpisodeSelection>,
  crossThread: CrossThreadEpisodeCandidateResult,
  resultLimit: number,
): MergedEpisodeRecallResult {
  const limit = boundedLimit(resultLimit, 20, 'episode_recall_result_limit_invalid');
  const seen = new Set<string>();
  const selections: EpisodeRecallSelection[] = [];
  for (const selection of currentThreadEpisodes) {
    if (selections.length >= limit || seen.has(selection.episode.id)) continue;
    seen.add(selection.episode.id);
    selections.push(selection);
  }
  const remaining = Math.max(0, limit - selections.length);
  const uniqueCrossCandidates = crossThread.candidates.filter(
    (candidate) => !seen.has(candidate.episode.id),
  );
  const duplicateDrops = crossThread.candidates.length - uniqueCrossCandidates.length;
  const boundedCross = selectBoundedCrossThreadEpisodes(
    {
      candidates: uniqueCrossCandidates,
      diagnostics: {
        ...crossThread.diagnostics,
        selectionLimitDroppedCount:
          crossThread.diagnostics.selectionLimitDroppedCount + duplicateDrops,
      },
    },
    remaining,
  );
  selections.push(...boundedCross.candidates);
  return { selections, crossThreadDiagnostics: boundedCross.diagnostics };
}
