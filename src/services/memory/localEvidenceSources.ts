import type { MemoryEpisode } from './episodes/types';
import type { MemoryFact } from './facts/types';
import type { LocalEvidenceSource } from './localEvidenceExpansionTypes';

function sourceKey(source: LocalEvidenceSource): string {
  if (source.kind === 'fact') return `fact:${source.factId}`;
  if (source.kind === 'episode') return `episode:${source.episodeId}`;
  return `run:${source.sourceRunId}`;
}

/**
 * Projects the ranked retrieval slate into a deterministic, unique expansion slate.
 * Source kinds are interleaved by retrieval rank so one dense lane cannot starve
 * the other lanes when the local expander applies its frozen source bound.
 */
export function deriveLocalEvidenceSources(
  facts: ReadonlyArray<MemoryFact>,
  episodes: ReadonlyArray<MemoryEpisode>,
): LocalEvidenceSource[] {
  const sources: LocalEvidenceSource[] = [];
  const seen = new Set<string>();
  const append = (source: LocalEvidenceSource): void => {
    const key = sourceKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(source);
  };

  const rankCount = Math.max(facts.length, episodes.length);
  for (let index = 0; index < rankCount; index += 1) {
    const fact = facts[index];
    if (fact) append({ kind: 'fact', factId: fact.id });
    const episode = episodes[index];
    if (episode) append({ kind: 'episode', episodeId: episode.id });
    const sourceRunId = fact?.sourceRunId?.trim();
    if (sourceRunId) append({ kind: 'run', sourceRunId });
  }
  return sources;
}
