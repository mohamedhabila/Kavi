// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeMemorySearch
// ---------------------------------------------------------------------------

const mockRecallFactSelectionForQuery = jest.fn();
const mockMarkFactsRecalled = jest.fn();
const mockGetEntityById = jest.fn();
const mockLoadActiveMemoryFactConflictSignals = jest.fn();

jest.mock('../../../src/services/memory/factRecall', () => ({
  recallFactSelectionForQuery: (...args: any[]) => mockRecallFactSelectionForQuery(...args),
}));

jest.mock('../../../src/services/memory/facts/observations', () => ({
  loadActiveMemoryFactConflictSignals: (...args: any[]) =>
    mockLoadActiveMemoryFactConflictSignals(...args),
}));

jest.mock('../../../src/services/memory/facts/mutations', () => ({
  markFactsRecalled: (...args: any[]) => mockMarkFactsRecalled(...args),
}));

jest.mock('../../../src/services/memory/entities', () => ({
  getEntityById: (...args: any[]) => mockGetEntityById(...args),
}));

jest.mock('../../../src/services/memory/memoryScopeStore', () => ({
  resolveLocalMemoryAccessScope: (scope: Record<string, unknown>) => ({
    memoryOwnerId: 'test-memory-owner',
    ...scope,
  }),
}));

import { executeMemorySearch } from '../../helpers/builtinExecutorHarness';
import { makeScoredFact } from '../../helpers/memoryFactFixtures';

const MEMORY_SEARCH_SCOPE = {
  memoryConversationId: 'conversation-1',
  sourceThreadId: 'conversation-1',
  personaId: 'default',
  taskId: null,
} as const;

describe('Builtin Tool Executor', () => {
  describe('executeMemorySearch', () => {
    beforeEach(() => {
      mockRecallFactSelectionForQuery.mockReset();
      mockRecallFactSelectionForQuery.mockResolvedValue({
        facts: [],
        resolutionFacts: [],
        scoredFacts: [],
      });
      mockLoadActiveMemoryFactConflictSignals.mockReset();
      mockLoadActiveMemoryFactConflictSignals.mockReturnValue([]);
      mockMarkFactsRecalled.mockReset();
      mockGetEntityById.mockReset();
    });

    it('searches the structured living-memory fact store for a query', async () => {
      const result = await executeMemorySearch({ query: 'test search' }, MEMORY_SEARCH_SCOPE);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.method).toBe('living_memory');
      expect(parsed.index).toBe('memory_facts');
      expect(mockRecallFactSelectionForQuery).toHaveBeenCalledWith(
        'test search',
        expect.objectContaining({
          limit: 10,
          threshold: 0.01,
          useIntent: 'automatic_prompt',
        }),
      );
    });

    it('handles missing query gracefully', async () => {
      const result = await executeMemorySearch({ query: '' }, MEMORY_SEARCH_SCOPE);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(
        expect.objectContaining({
          results: [],
          method: 'living_memory',
          index: 'memory_facts',
          totalFound: 0,
        }),
      );
      expect(mockRecallFactSelectionForQuery).not.toHaveBeenCalled();
    });

    it('returns citation-formatted living-memory facts', async () => {
      mockGetEntityById.mockReturnValueOnce({
        id: 'subject-1',
        canonicalName: 'project alpha',
      });
      const scoredFacts = [
        makeScoredFact({
          fact: {
            id: 'fact-1',
            subjectId: 'subject-1',
            predicate: 'decision',
            objectText: 'Use the local queue for durable enrichment.',
            sourceMessageId: 'message-1',
            memoryOwnerId: 'test-memory-owner',
            factClass: 'workflow',
            sourceAuthority: 'grounded_user',
            scope: 'conversation',
            originConversationId: 'conversation-1',
            originThreadId: 'conversation-1',
            memoryKind: 'decision',
          },
          score: 0.92,
          relevanceScore: 0.9,
        }),
      ];
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: scoredFacts.map((entry) => entry.fact),
        resolutionFacts: [],
        scoredFacts,
      });

      const result = await executeMemorySearch(
        { query: 'durable enrichment', maxResults: 5 },
        MEMORY_SEARCH_SCOPE,
      );
      const parsed = JSON.parse(result);

      expect(parsed.method).toBe('living_memory');
      expect(parsed.index).toBe('memory_facts');
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]).toEqual(
        expect.objectContaining({
          factId: 'fact-1',
          source: 'message-1',
          subject: 'project alpha',
          snippet: 'Use the local queue for durable enrichment.',
          citation: '[1] message-1',
          relevance: '92%',
          policy: { action: 'use', reason: 'eligible' },
        }),
      );
      expect(mockMarkFactsRecalled).toHaveBeenCalledWith(['fact-1'], expect.any(Number));
    });

    it('returns a degraded living-memory result on recall error', async () => {
      mockRecallFactSelectionForQuery.mockRejectedValueOnce(new Error('recall fail'));
      const result = await executeMemorySearch(
        { query: 'fallback', maxResults: 5 },
        MEMORY_SEARCH_SCOPE,
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('living_memory');
      expect(parsed.index).toBe('memory_facts');
      expect(parsed.degraded).toBe(true);
      expect(parsed.error).toBe('recall fail');
    });

    it('fails closed when persisted contradiction observations cannot be read', async () => {
      const scored = makeScoredFact({
        fact: {
          id: 'fact-observation-read-failure',
          memoryOwnerId: 'test-memory-owner',
          factClass: 'workflow',
          sourceAuthority: 'tool_observed',
          scope: 'conversation',
          originConversationId: 'conversation-1',
          originThreadId: 'conversation-1',
          originTaskId: null,
        },
      });
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: [scored.fact],
        resolutionFacts: [],
        scoredFacts: [scored],
      });
      mockLoadActiveMemoryFactConflictSignals.mockImplementationOnce(() => {
        throw new Error('injected observation read failure');
      });

      const parsed = JSON.parse(
        await executeMemorySearch({ query: 'remembered workflow' }, MEMORY_SEARCH_SCOPE),
      );

      expect(parsed.degraded).toBe(true);
      expect(parsed.results[0].policy).toEqual({
        action: 'abstain',
        reason: 'conflict_observation_read_failed',
      });
      expect(parsed.policyInstruction).toContain('never assert or act on action=abstain');
    });

    it('keeps assistant-inferred subjective memory out of automatic search results', async () => {
      const inferred = makeScoredFact({
        fact: {
          id: 'fact-subjective-inference',
          memoryOwnerId: 'test-memory-owner',
          factClass: 'subjective_user',
          sourceAuthority: 'assistant_inferred',
          scope: 'conversation',
          originConversationId: 'conversation-1',
          originThreadId: 'conversation-1',
          originTaskId: null,
        },
      }).fact;
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: [],
        resolutionFacts: [inferred],
        scoredFacts: [],
      });

      const parsed = JSON.parse(
        await executeMemorySearch({ query: 'possible preference' }, MEMORY_SEARCH_SCOPE),
      );

      expect(parsed.results).toEqual([]);
    });

    it('keeps unverified inferred experience views out of automatic search results', async () => {
      const runFact = makeScoredFact({
        fact: {
          id: 'fact-agent-run-1',
          subjectId: 'subject-run-1',
          predicate: 'agent_run',
          objectText: JSON.stringify({
            status: 'completed',
            outcome: 'Release receipt verified',
            evidenceSlices: [
              { action: 'Inspect release receipt', toolName: 'read_file', status: 'completed' },
            ],
            artifacts: ['artifacts/release-receipt.json'],
            gotchas: ['Refresh authorization before retrying'],
          }),
          attributes: {},
          sourceRunId: 'run-1',
          sourceTurnId: 'turn-1',
          sourceMessageId: 'message-1',
          contentHash: 'hash-1',
          memoryOwnerId: 'test-memory-owner',
          factClass: 'workflow',
          sourceAuthority: 'assistant_inferred',
          scope: 'conversation',
          originConversationId: 'conversation-1',
          originThreadId: 'conversation-1',
          originTaskId: null,
          memoryKind: 'agent_run',
        },
      }).fact;
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: [],
        resolutionFacts: [runFact],
        scoredFacts: [],
      });

      const parsed = JSON.parse(
        await executeMemorySearch({ query: 'release receipt procedure' }, MEMORY_SEARCH_SCOPE),
      );

      expect(parsed.results).toEqual([]);
      expect(parsed.policyInstruction).toContain('ask the user before relying on action=ask');
    });

    it('never projects sensitive facts through agent-invoked memory_search', async () => {
      const sensitive = makeScoredFact({
        fact: {
          id: 'fact-sensitive-search',
          memoryOwnerId: 'test-memory-owner',
          factClass: 'subjective_user',
          sourceAuthority: 'grounded_user',
          sensitivity: 'sensitive',
          scope: 'conversation',
          originConversationId: 'conversation-1',
          originThreadId: 'conversation-1',
          originTaskId: null,
        },
      });
      mockRecallFactSelectionForQuery.mockResolvedValueOnce({
        facts: [sensitive.fact],
        resolutionFacts: [],
        scoredFacts: [sensitive],
      });

      const parsed = JSON.parse(
        await executeMemorySearch({ query: 'private profile' }, MEMORY_SEARCH_SCOPE),
      );

      expect(parsed.results).toEqual([]);
      expect(mockMarkFactsRecalled).toHaveBeenCalledWith([], expect.any(Number));
    });
  });
});
