// ---------------------------------------------------------------------------
// Kavi — Episode Recall
// ---------------------------------------------------------------------------
// Language-agnostic retrieval of episodes for prompt assembly.
// Relevance is primary when a query is supplied; recency remains a tie-breaker
// and the fallback for empty queries.
// ---------------------------------------------------------------------------

import { ensureFactSchema } from './schema';
import { getMemoryDb } from './database';
import {
  CROSS_THREAD_EPISODE_INDEXED_CANDIDATE_LIMIT,
  loadAuthorizedCrossThreadEpisodeCandidates,
  mergeCurrentAndCrossThreadEpisodes,
} from './episodes/crossThreadRecall';
import type {
  CrossThreadEpisodeRecallDiagnostics,
  EpisodeRecallSelection,
} from './episodes/accessPolicyTypes';
import {
  requireMemoryAccessScopeIdentity,
  type MemoryAccessScopeIdentity,
} from './memoryScopeIdentity';
import {
  episodeQueryUnits,
  scoreEpisodesForQuery,
  sortScoredEpisodes,
} from './episodes/queryScoring';
import { rowToEpisode, type EpisodeRow, type MemoryEpisode } from './episodes/types';

export interface RecallEpisodesOptions {
  threadId?: string;
  conversationId?: string;
  taskId?: string | null;
  limit?: number;
  maxAgeMs?: number;
  asOf?: number;
  onTiming?: (timing: RecallEpisodesTiming) => void;
}

export interface RecallEpisodesTiming {
  queryUnitCount: number;
  candidateLimit: number;
  candidateCount: number;
  resultLimit: number;
  resultCount: number;
  fetchMs: number;
  scoreMs: number;
  sortMs: number;
  totalMs: number;
}

export interface RecallScopedEpisodesResult {
  selections: EpisodeRecallSelection[];
  diagnostics: CrossThreadEpisodeRecallDiagnostics;
}

export const EPISODE_PRESENTATION_MAX = 20;
export const EPISODE_QUERY_CANDIDATE_MIN = 64;
export const EPISODE_QUERY_CANDIDATE_MAX = 80;
export const EPISODE_RECALL_LOCAL_P95_BUDGET_MS = 100;

const EPISODE_PRESENTATION_DEFAULT = 6;
const EPISODE_QUERY_CANDIDATE_MULTIPLIER = 8;

function presentationLimit(requestedLimit: number | undefined): number {
  return Math.max(
    1,
    Math.min(requestedLimit ?? EPISODE_PRESENTATION_DEFAULT, EPISODE_PRESENTATION_MAX),
  );
}

function queryCandidateLimit(resultLimit: number): number {
  return Math.max(
    EPISODE_QUERY_CANDIDATE_MIN,
    Math.min(resultLimit * EPISODE_QUERY_CANDIDATE_MULTIPLIER, EPISODE_QUERY_CANDIDATE_MAX),
  );
}

function fetchRecentEpisodeCandidates(
  options: RecallEpisodesOptions,
  limit: number,
): MemoryEpisode[] {
  ensureFactSchema();
  const clauses: string[] = ['deleted_at IS NULL'];
  const params: Array<string | number> = [];

  if (options.threadId) {
    clauses.push('thread_id = ?');
    params.push(options.threadId);
  }
  if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }

  if (options.taskId === null) {
    clauses.push('task_id IS NULL');
  } else if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }

  if (typeof options.maxAgeMs === 'number' && options.maxAgeMs > 0) {
    clauses.push('ended_at > ?');
    params.push((options.asOf ?? Date.now()) - options.maxAgeMs);
  }
  if (typeof options.asOf === 'number') {
    clauses.push('ended_at <= ?');
    params.push(options.asOf);
    clauses.push('created_at <= ?');
    params.push(options.asOf);
  }

  const where = clauses.join(' AND ');

  const rows = getMemoryDb().getAllSync<EpisodeRow>(
    `SELECT * FROM memory_episodes
       WHERE ${where}
       ORDER BY ended_at DESC, id ASC
       LIMIT ${limit}`,
    ...params,
  );

  return rows.map(rowToEpisode);
}

function fetchIndexedEpisodeCandidates(
  options: RecallEpisodesOptions,
  queryUnits: ReadonlySet<string>,
  limit: number,
): MemoryEpisode[] {
  ensureFactSchema();
  const units = Array.from(queryUnits);
  if (units.length === 0) return [];
  const clauses: string[] = ['episode.deleted_at IS NULL'];
  const params: Array<string | number> = [...units];

  if (options.threadId) {
    clauses.push('episode.thread_id = ?');
    params.push(options.threadId);
  }
  if (options.conversationId) {
    clauses.push('episode.conversation_id = ?');
    params.push(options.conversationId);
  }
  if (options.taskId === null) {
    clauses.push('episode.task_id IS NULL');
  } else if (options.taskId) {
    clauses.push('episode.task_id = ?');
    params.push(options.taskId);
  }
  if (typeof options.maxAgeMs === 'number' && options.maxAgeMs > 0) {
    clauses.push('episode.ended_at > ?');
    params.push((options.asOf ?? Date.now()) - options.maxAgeMs);
  }
  if (typeof options.asOf === 'number') {
    clauses.push('episode.ended_at <= ?');
    params.push(options.asOf);
    clauses.push('episode.created_at <= ?');
    params.push(options.asOf);
  }

  const rows = getMemoryDb().getAllSync<EpisodeRow>(
    `SELECT episode.*
       FROM memory_episode_terms AS term
       JOIN memory_episodes AS episode ON episode.id = term.episode_id
      WHERE term.unit IN (${units.map(() => '?').join(', ')})
        AND ${clauses.join(' AND ')}
      GROUP BY episode.id
      ORDER BY COUNT(DISTINCT term.unit) DESC,
               episode.importance DESC,
               episode.ended_at DESC,
               episode.id ASC
      LIMIT ${limit}`,
    ...params,
  );
  return rows.map(rowToEpisode);
}

export function recallRecentEpisodes(options: RecallEpisodesOptions = {}): MemoryEpisode[] {
  const totalStarted = Date.now();
  const limit = presentationLimit(options.limit);
  const fetchStarted = Date.now();
  const episodes = fetchRecentEpisodeCandidates(options, limit);
  const fetchMs = Date.now() - fetchStarted;
  options.onTiming?.({
    queryUnitCount: 0,
    candidateLimit: limit,
    candidateCount: episodes.length,
    resultLimit: limit,
    resultCount: episodes.length,
    fetchMs,
    scoreMs: 0,
    sortMs: 0,
    totalMs: Date.now() - totalStarted,
  });
  return episodes;
}

export function recallEpisodesForQuery(
  query: string,
  options: RecallEpisodesOptions = {},
): MemoryEpisode[] {
  const totalStarted = Date.now();
  const trimmed = query.trim();
  if (!trimmed) return recallRecentEpisodes(options);
  const resultLimit = presentationLimit(options.limit);
  const candidateLimit = queryCandidateLimit(resultLimit);
  const queryUnits = episodeQueryUnits(trimmed);
  const fetchStarted = Date.now();
  const candidates = fetchIndexedEpisodeCandidates(options, queryUnits, candidateLimit);
  const fetchMs = Date.now() - fetchStarted;
  const scoreStarted = Date.now();
  const scored = scoreEpisodesForQuery(candidates, queryUnits);
  const scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  const ranked = sortScoredEpisodes(scored);
  const sortMs = Date.now() - sortStarted;
  const episodes = ranked.slice(0, resultLimit).map((entry) => entry.episode);
  options.onTiming?.({
    queryUnitCount: queryUnits.size,
    candidateLimit,
    candidateCount: candidates.length,
    resultLimit,
    resultCount: episodes.length,
    fetchMs,
    scoreMs,
    sortMs,
    totalMs: Date.now() - totalStarted,
  });
  return episodes;
}

export function recallScopedEpisodesForQuery(
  query: string,
  options: {
    currentScope: MemoryAccessScopeIdentity;
    limit?: number;
    maxAgeMs?: number;
    now: number;
    onTiming?: (timing: RecallEpisodesTiming) => void;
  },
): RecallScopedEpisodesResult {
  const totalStarted = Date.now();
  const scope = requireMemoryAccessScopeIdentity(options.currentScope);
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new Error('scoped_episode_recall_timestamp_invalid');
  }
  const resultLimit = presentationLimit(options.limit);
  let currentTiming: RecallEpisodesTiming | undefined;
  const current = recallEpisodesForQuery(query, {
    conversationId: scope.memoryConversationId,
    threadId: scope.sourceThreadId,
    taskId: scope.taskId,
    limit: resultLimit,
    maxAgeMs: options.maxAgeMs,
    asOf: options.now,
    onTiming: (timing) => {
      currentTiming = timing;
    },
  });
  const crossThread = loadAuthorizedCrossThreadEpisodeCandidates({
    db: getMemoryDb(),
    currentScope: scope,
    now: options.now,
    query,
  });
  const merged = mergeCurrentAndCrossThreadEpisodes(current, crossThread, resultLimit);
  if (currentTiming) {
    options.onTiming?.({
      queryUnitCount: currentTiming.queryUnitCount,
      candidateLimit:
        currentTiming.candidateLimit +
        (crossThread.diagnostics.emptyQuerySuppressed
          ? 0
          : CROSS_THREAD_EPISODE_INDEXED_CANDIDATE_LIMIT),
      candidateCount: currentTiming.candidateCount + crossThread.diagnostics.scannedCount,
      resultLimit,
      resultCount: merged.selections.length,
      fetchMs: currentTiming.fetchMs + crossThread.diagnostics.fetchMs,
      scoreMs:
        currentTiming.scoreMs +
        crossThread.diagnostics.policyMs +
        crossThread.diagnostics.scoreMs +
        crossThread.diagnostics.selectionMs,
      sortMs: currentTiming.sortMs + crossThread.diagnostics.sortMs,
      totalMs: Date.now() - totalStarted,
    });
  }
  return {
    selections: merged.selections,
    diagnostics: merged.crossThreadDiagnostics,
  };
}
