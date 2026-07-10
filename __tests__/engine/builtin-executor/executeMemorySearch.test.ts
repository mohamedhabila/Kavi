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

    it('returns assistant-inferred subjective memory only as an ask decision', async () => {
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

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]).toMatchObject({
        factId: inferred.id,
        relevance: null,
        policy: {
          action: 'ask',
          reason: 'subjective_authority_confirmation_required',
        },
      });
    });

    it('exposes bounded typed experience views with the selected run policy and provenance', async () => {
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

      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].policy).toEqual({
        action: 'ask',
        reason: 'workflow_authority_confirmation_required',
      });
      expect(parsed.results[0].experienceViews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'procedure',
            evidence: expect.objectContaining({
              factId: 'fact-agent-run-1',
              sourceRunId: 'run-1',
              sourceTurnId: 'turn-1',
              sourceMessageId: 'message-1',
            }),
            applicability: expect.objectContaining({
              conversationId: 'conversation-1',
              threadId: 'conversation-1',
              generalization: 'single_run',
            }),
          }),
          expect.objectContaining({
            kind: 'artifact',
            values: ['artifacts/release-receipt.json'],
          }),
          expect.objectContaining({
            kind: 'gotcha',
            values: ['Refresh authorization before retrying'],
          }),
        ]),
      );
      expect(parsed.policyInstruction).toContain('ask the user before relying on action=ask');
    });
  });
});
