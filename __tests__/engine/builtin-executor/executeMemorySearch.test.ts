// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeMemorySearch
// ---------------------------------------------------------------------------

const mockRecallScoredFactsForQuery = jest.fn();
const mockMarkFactsRecalled = jest.fn();
const mockGetEntityById = jest.fn();

jest.mock('../../../src/services/memory/factRecall', () => ({
  recallScoredFactsForQuery: (...args: any[]) => mockRecallScoredFactsForQuery(...args),
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
      mockRecallScoredFactsForQuery.mockReset();
      mockRecallScoredFactsForQuery.mockResolvedValue([]);
      mockMarkFactsRecalled.mockReset();
      mockGetEntityById.mockReset();
    });

    it('searches the structured living-memory fact store for a query', async () => {
      const result = await executeMemorySearch({ query: 'test search' }, MEMORY_SEARCH_SCOPE);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.method).toBe('living_memory');
      expect(parsed.index).toBe('memory_facts');
      expect(mockRecallScoredFactsForQuery).toHaveBeenCalledWith(
        'test search',
        expect.objectContaining({
          limit: 10,
          threshold: 0.01,
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
      expect(mockRecallScoredFactsForQuery).not.toHaveBeenCalled();
    });

    it('returns citation-formatted living-memory facts', async () => {
      mockGetEntityById.mockReturnValueOnce({
        id: 'subject-1',
        canonicalName: 'project alpha',
      });
      mockRecallScoredFactsForQuery.mockResolvedValueOnce([
        makeScoredFact({
          fact: {
            id: 'fact-1',
            subjectId: 'subject-1',
            predicate: 'decision',
            objectText: 'Use the local queue for durable enrichment.',
            sourceMessageId: 'message-1',
            scope: 'conversation',
            originConversationId: 'conversation-1',
            originThreadId: 'conversation-1',
            memoryKind: 'decision',
          },
          score: 0.92,
          relevanceScore: 0.9,
        }),
      ]);

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
        }),
      );
      expect(mockMarkFactsRecalled).toHaveBeenCalledWith(['fact-1'], expect.any(Number));
    });

    it('returns a degraded living-memory result on recall error', async () => {
      mockRecallScoredFactsForQuery.mockRejectedValueOnce(new Error('recall fail'));
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
  });
});
