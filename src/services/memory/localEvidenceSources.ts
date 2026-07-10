import type { EpisodeRecallSelection } from './episodes/accessPolicyTypes';
import type { MemoryFact } from './facts/types';
import type { LocalEvidenceSource, ScopedLocalEvidenceSource } from './localEvidenceExpansionTypes';
import type { RequiredMemoryAccessScopeIdentity } from './memoryScopeIdentity';

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
  episodeSelections: ReadonlyArray<EpisodeRecallSelection>,
  currentScope: RequiredMemoryAccessScopeIdentity,
): ScopedLocalEvidenceSource[] {
  const sources: ScopedLocalEvidenceSource[] = [];
  const seen = new Set<string>();
  const appendCurrent = (source: LocalEvidenceSource): void => {
    const scope = currentScope;
    const key = `${scope.memoryConversationId}:${scope.sourceThreadId}:${sourceKey(source)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({
      ...source,
      memoryConversationId: scope.memoryConversationId,
      sourceThreadId: scope.sourceThreadId,
      lane: 'current_thread',
      authorizedOrigin: null,
    });
  };

  const rankCount = Math.max(facts.length, episodeSelections.length);
  for (let index = 0; index < rankCount; index += 1) {
    const fact = facts[index];
    if (fact) appendCurrent({ kind: 'fact', factId: fact.id });
    const selection = episodeSelections[index];
    if (selection) {
      if (selection.lane === 'cross_thread') {
        const key = `${selection.authorizedOrigin.memoryConversationId}:${selection.authorizedOrigin.sourceThreadId}:episode:${selection.episode.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            kind: 'episode',
            episodeId: selection.episode.id,
            memoryConversationId: selection.authorizedOrigin.memoryConversationId,
            sourceThreadId: selection.authorizedOrigin.sourceThreadId,
            lane: 'cross_thread',
            authorizedOrigin: selection.authorizedOrigin,
            accessDecision: selection.accessDecision,
            relevanceScore: selection.relevanceScore,
          });
        }
      } else {
        appendCurrent({ kind: 'episode', episodeId: selection.episode.id });
      }
    }
    const sourceRunId = fact?.sourceRunId?.trim();
    if (sourceRunId) appendCurrent({ kind: 'run', sourceRunId });
  }
  return sources;
}
