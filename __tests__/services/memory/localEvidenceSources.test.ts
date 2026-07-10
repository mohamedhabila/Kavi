import { deriveLocalEvidenceSources } from '../../../src/services/memory/localEvidenceSources';
import type { MemoryEpisode } from '../../../src/services/memory/episodes/types';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(id: string, sourceRunId: string | null = null): MemoryFact {
  return { id, sourceRunId } as MemoryFact;
}

function episode(id: string): MemoryEpisode {
  return { id } as MemoryEpisode;
}

const currentScope = {
  memoryOwnerId: 'owner-1',
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'thread-1',
  personaId: 'default',
  taskId: null,
} as const;

function currentEpisode(id: string) {
  return { episode: episode(id), lane: 'current_thread' as const, authorizedOrigin: null };
}

describe('local evidence source derivation', () => {
  it('interleaves ranked fact, episode, and run sources deterministically', () => {
    expect(
      deriveLocalEvidenceSources(
        [fact('fact-1', 'run-1'), fact('fact-2', 'run-2'), fact('fact-3')],
        [currentEpisode('episode-1'), currentEpisode('episode-2')],
        currentScope,
      ),
    ).toEqual([
      {
        kind: 'fact',
        factId: 'fact-1',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'episode',
        episodeId: 'episode-1',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'run',
        sourceRunId: 'run-1',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'fact',
        factId: 'fact-2',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'episode',
        episodeId: 'episode-2',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'run',
        sourceRunId: 'run-2',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
      {
        kind: 'fact',
        factId: 'fact-3',
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        lane: 'current_thread',
        authorizedOrigin: null,
      },
    ]);
  });

  it('deduplicates shared runs and ignores absent run provenance', () => {
    expect(
      deriveLocalEvidenceSources(
        [fact('fact-1', ' run-shared '), fact('fact-2', 'run-shared'), fact('fact-3', '   ')],
        [],
        currentScope,
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'fact', factId: 'fact-1' }),
      expect.objectContaining({ kind: 'run', sourceRunId: 'run-shared' }),
      expect.objectContaining({ kind: 'fact', factId: 'fact-2' }),
      expect.objectContaining({ kind: 'fact', factId: 'fact-3' }),
    ]);
  });

  it('returns an empty source slate for zero retrieval evidence', () => {
    expect(deriveLocalEvidenceSources([], [], currentScope)).toEqual([]);
  });
});
