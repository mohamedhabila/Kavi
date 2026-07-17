import type { MemoryEpisode } from './types';

const WORD_LIKE_SEQUENCE_PATTERN = /[\p{L}\p{M}\p{N}]+/gu;
export const EPISODE_QUERY_UNIT_LIMIT = 32;
export const EPISODE_INDEX_UNIT_LIMIT = 256;
export const EPISODE_UNIT_CHAR_LIMIT = 128;

export interface ScoredMemoryEpisode {
  episode: MemoryEpisode;
  score: number;
}

function episodeTextUnits(value: string, limit: number): Set<string> {
  const out = new Set<string>();
  const normalized = value.normalize('NFKC').toLowerCase();
  WORD_LIKE_SEQUENCE_PATTERN.lastIndex = 0;
  for (const match of normalized.matchAll(WORD_LIKE_SEQUENCE_PATTERN)) {
    const unit = match[0].trim();
    if (unit && unit.length <= EPISODE_UNIT_CHAR_LIMIT) out.add(unit);
    if (out.size >= limit) break;
  }
  return out;
}

export function episodeQueryUnits(value: string): Set<string> {
  return episodeTextUnits(value, EPISODE_QUERY_UNIT_LIMIT);
}

export function episodeIndexUnits(
  episode: Pick<MemoryEpisode, 'summary' | 'entities' | 'toolNames'>,
): Set<string> {
  return new Set([
    ...episodeTextUnits(episode.summary, EPISODE_INDEX_UNIT_LIMIT - 64),
    ...episodeTextUnits(episode.entities.join(' '), 32),
    ...episodeTextUnits(episode.toolNames.join(' '), 32),
  ]);
}

export function scoreEpisodeForQuery(
  episode: MemoryEpisode,
  queryUnits: ReadonlySet<string>,
): number {
  if (queryUnits.size === 0) return 0;
  const searchable = episodeIndexUnits(episode);
  if (searchable.size === 0) return 0;
  let hits = 0;
  for (const unit of queryUnits) if (searchable.has(unit)) hits += 1;
  return hits / queryUnits.size;
}

export function scoreEpisodesForQuery(
  episodes: ReadonlyArray<MemoryEpisode>,
  queryUnits: ReadonlySet<string>,
): ScoredMemoryEpisode[] {
  return episodes
    .map((episode) => ({ episode, score: scoreEpisodeForQuery(episode, queryUnits) }))
    .filter((entry) => entry.score > 0);
}

export function sortScoredEpisodes(
  episodes: ReadonlyArray<ScoredMemoryEpisode>,
): ScoredMemoryEpisode[] {
  const sorted = [...episodes];
  sorted.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.episode.importance !== left.episode.importance) {
      return right.episode.importance - left.episode.importance;
    }
    if (right.episode.endedAt !== left.episode.endedAt) {
      return right.episode.endedAt - left.episode.endedAt;
    }
    return left.episode.id.localeCompare(right.episode.id);
  });
  return sorted;
}

function sameEpisodeTrajectory(left: MemoryEpisode, right: MemoryEpisode): boolean {
  return (
    left.conversationId === right.conversationId &&
    left.threadId === right.threadId &&
    left.taskId === right.taskId
  );
}

function newerEpisode(left: MemoryEpisode, right: MemoryEpisode): boolean {
  if (left.endedAt !== right.endedAt) return left.endedAt > right.endedAt;
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt;
  return left.id.localeCompare(right.id) < 0;
}

/**
 * Keep the strongest semantic match, but use a repeated slot from that same
 * trajectory for its newest relevant state instead of another older match.
 * A distinct second trajectory keeps its diversity slot.
 */
export function selectSemanticAndRecentEpisodes(
  ranked: ReadonlyArray<ScoredMemoryEpisode>,
  limit: number,
): ScoredMemoryEpisode[] {
  if (limit <= 0 || ranked.length === 0) return [];
  if (limit === 1 || ranked.length === 1) return ranked.slice(0, limit);

  const semanticAnchor = ranked[0]!;
  const second = ranked[1]!;
  if (!sameEpisodeTrajectory(semanticAnchor.episode, second.episode)) {
    return ranked.slice(0, limit);
  }

  let newestRelevant = semanticAnchor;
  for (const candidate of ranked) {
    if (
      sameEpisodeTrajectory(semanticAnchor.episode, candidate.episode) &&
      newerEpisode(candidate.episode, newestRelevant.episode)
    ) {
      newestRelevant = candidate;
    }
  }
  if (newestRelevant.episode.id === semanticAnchor.episode.id) {
    return ranked.slice(0, limit);
  }

  return [
    semanticAnchor,
    newestRelevant,
    ...ranked.filter(
      (candidate) =>
        candidate.episode.id !== semanticAnchor.episode.id &&
        candidate.episode.id !== newestRelevant.episode.id,
    ),
  ].slice(0, limit);
}

export function rankEpisodesForQuery(
  episodes: ReadonlyArray<MemoryEpisode>,
  queryUnits: ReadonlySet<string>,
): ScoredMemoryEpisode[] {
  return sortScoredEpisodes(scoreEpisodesForQuery(episodes, queryUnits));
}
