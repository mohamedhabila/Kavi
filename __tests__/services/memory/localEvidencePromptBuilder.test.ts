import * as expansionModule from '../../../src/services/memory/localEvidenceExpansion';
import { buildLocalEvidencePrompt } from '../../../src/services/memory/localEvidencePromptBuilder';
import type { MemoryFact } from '../../../src/services/memory/facts/types';

function fact(id: string): MemoryFact {
  return { id, sourceRunId: null } as MemoryFact;
}

describe('local evidence prompt builder', () => {
  afterEach(() => jest.restoreAllMocks());

  it('performs no local query for zero selected evidence', () => {
    const expansion = jest.spyOn(expansionModule, 'expandLocalEvidence');

    expect(buildLocalEvidencePrompt({ facts: [], episodes: [], asOf: 1 })).toEqual({
      section: null,
      diagnostics: {
        outcome: 'not_requested',
        requestedSourceCount: 0,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
    });
    expect(expansion).not.toHaveBeenCalled();
  });

  it('fails closed without querying when exact scope is unavailable', () => {
    const expansion = jest.spyOn(expansionModule, 'expandLocalEvidence');
    const result = buildLocalEvidencePrompt({ facts: [fact('fact-1')], episodes: [], asOf: 1 });

    expect(result).toMatchObject({
      section: null,
      diagnostics: {
        outcome: 'scope_unavailable',
        requestedSourceCount: 1,
        acceptedSourceCount: 0,
        emittedEvidenceCount: 0,
        promptChars: 0,
      },
    });
    expect(expansion).not.toHaveBeenCalled();
  });

  it('returns a closed failed outcome instead of leaking local expansion errors', () => {
    jest.spyOn(expansionModule, 'expandLocalEvidence').mockImplementation(() => {
      throw new Error('PRIVATE LOCAL DATABASE ERROR');
    });
    const result = buildLocalEvidencePrompt({
      facts: [fact('fact-1')],
      episodes: [],
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      asOf: 1,
    });

    expect(result).toMatchObject({
      section: null,
      diagnostics: { outcome: 'failed', requestedSourceCount: 1, emittedEvidenceCount: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE LOCAL DATABASE ERROR');
  });
});
