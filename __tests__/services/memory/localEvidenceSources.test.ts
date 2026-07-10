import { deriveLocalEvidenceSources } from '../../../src/services/memory/localEvidenceSources';
import type { MemoryEpisode } from '../../../src/services/memory/episodes/types';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(id: string, sourceRunId: string | null = null): MemoryFact {
  return { id, sourceRunId } as MemoryFact;
}

function episode(id: string): MemoryEpisode {
  return { id } as MemoryEpisode;
}

describe('local evidence source derivation', () => {
  it('interleaves ranked fact, episode, and run sources deterministically', () => {
    expect(
      deriveLocalEvidenceSources(
        [fact('fact-1', 'run-1'), fact('fact-2', 'run-2'), fact('fact-3')],
        [episode('episode-1'), episode('episode-2')],
      ),
    ).toEqual([
      { kind: 'fact', factId: 'fact-1' },
      { kind: 'episode', episodeId: 'episode-1' },
      { kind: 'run', sourceRunId: 'run-1' },
      { kind: 'fact', factId: 'fact-2' },
      { kind: 'episode', episodeId: 'episode-2' },
      { kind: 'run', sourceRunId: 'run-2' },
      { kind: 'fact', factId: 'fact-3' },
    ]);
  });

  it('deduplicates shared runs and ignores absent run provenance', () => {
    expect(
      deriveLocalEvidenceSources(
        [fact('fact-1', ' run-shared '), fact('fact-2', 'run-shared'), fact('fact-3', '   ')],
        [],
      ),
    ).toEqual([
      { kind: 'fact', factId: 'fact-1' },
      { kind: 'run', sourceRunId: 'run-shared' },
      { kind: 'fact', factId: 'fact-2' },
      { kind: 'fact', factId: 'fact-3' },
    ]);
  });

  it('returns an empty source slate for zero retrieval evidence', () => {
    expect(deriveLocalEvidenceSources([], [])).toEqual([]);
  });
});
