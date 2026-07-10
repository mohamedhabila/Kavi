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
}

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

export function recallRecentEpisodes(options: RecallEpisodesOptions = {}): MemoryEpisode[] {
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

  const limit = Math.max(1, Math.min(options.limit ?? 6, 20));
  const where = clauses.join(' AND ');

  const rows = getMemoryDb().getAllSync<EpisodeRow>(
    `SELECT * FROM memory_episodes
       WHERE ${where}
       ORDER BY ended_at DESC
       LIMIT ${limit}`,
    ...params,
  );

  return rows.map(rowToEpisode);
}

export function recallEpisodesForQuery(
  query: string,
  options: RecallEpisodesOptions = {},
): MemoryEpisode[] {
  const trimmed = query.trim();
  if (!trimmed) return recallRecentEpisodes(options);
  const candidateLimit = Math.max(20, Math.min((options.limit ?? 6) * 8, 80));
  const candidates = recallRecentEpisodes({ ...options, limit: candidateLimit });
  const queryUnits = lexicalUnits(trimmed);
  return candidates
    .map((episode) => ({
      episode,
      score: lexicalOverlap(
        queryUnits,
        `${episode.summary} ${episode.entities.join(' ')} ${episode.toolNames.join(' ')}`,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.episode.importance !== a.episode.importance) {
        return b.episode.importance - a.episode.importance;
      }
      return b.episode.endedAt - a.episode.endedAt;
    })
    .slice(0, Math.max(1, Math.min(options.limit ?? 6, 20)))
    .map((entry) => entry.episode);
}
