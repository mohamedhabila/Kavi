// ---------------------------------------------------------------------------
// Kavi — Episode Recall
// ---------------------------------------------------------------------------
// Language-agnostic retrieval of episodes for prompt assembly.
// Relevance is primary when a query is supplied; recency remains a tie-breaker
// and the fallback for empty queries.
// ---------------------------------------------------------------------------

import { ensureFactSchema } from './schema';
import { getMemoryDb } from './sqlite-store';
import { rowToEpisode, type EpisodeRow, type MemoryEpisode } from './episodes/types';

export interface RecallEpisodesOptions {
  threadId?: string;
  conversationId?: string;
  taskId?: string;
  limit?: number;
  maxAgeMs?: number;
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

export const EPISODE_PRESENTATION_MAX = 20;
export const EPISODE_QUERY_CANDIDATE_MIN = 64;
export const EPISODE_QUERY_CANDIDATE_MAX = 80;
export const EPISODE_RECALL_LOCAL_P95_BUDGET_MS = 100;

const EPISODE_PRESENTATION_DEFAULT = 6;
const EPISODE_QUERY_CANDIDATE_MULTIPLIER = 8;

const WORD_LIKE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;

function lexicalUnits(value: string): Set<string> {
  const out = new Set<string>();
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of normalized.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    const unit = match[0].trim();
    if (unit) out.add(unit);
  }
  return out;
}

function lexicalOverlap(query: Set<string>, haystack: string): number {
  if (query.size === 0) return 0;
  const units = lexicalUnits(haystack);
  if (units.size === 0) return 0;
  let hits = 0;
  for (const unit of query) {
    if (units.has(unit)) hits += 1;
  }
  return hits / query.size;
}

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
  } else if (options.conversationId) {
    clauses.push('conversation_id = ?');
    params.push(options.conversationId);
  }

  if (options.taskId) {
    clauses.push('task_id = ?');
    params.push(options.taskId);
  }

  if (typeof options.maxAgeMs === 'number' && options.maxAgeMs > 0) {
    clauses.push('ended_at > ?');
    params.push(Date.now() - options.maxAgeMs);
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
  const fetchStarted = Date.now();
  const candidates = fetchRecentEpisodeCandidates(options, candidateLimit);
  const fetchMs = Date.now() - fetchStarted;
  const queryUnits = lexicalUnits(trimmed);
  const scoreStarted = Date.now();
  const scored = candidates
    .map((episode) => ({
      episode,
      score: lexicalOverlap(
        queryUnits,
        `${episode.summary} ${episode.entities.join(' ')} ${episode.toolNames.join(' ')}`,
      ),
    }))
    .filter((entry) => entry.score > 0);
  const scoreMs = Date.now() - scoreStarted;
  const sortStarted = Date.now();
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.episode.importance !== a.episode.importance) {
      return b.episode.importance - a.episode.importance;
    }
    if (b.episode.endedAt !== a.episode.endedAt) {
      return b.episode.endedAt - a.episode.endedAt;
    }
    return a.episode.id.localeCompare(b.episode.id);
  });
  const sortMs = Date.now() - sortStarted;
  const episodes = scored.slice(0, resultLimit).map((entry) => entry.episode);
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
