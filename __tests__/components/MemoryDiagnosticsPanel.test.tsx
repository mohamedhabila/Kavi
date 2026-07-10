import { render } from '@testing-library/react-native';
import { MemoryDiagnosticsPanel } from '../../src/components/memory/MemoryDiagnosticsPanel';
import type { MemoryDiagnosticsSnapshot } from '../../src/services/memory/memoryDiagnostics';
import type { MemoryRetrievalEvent } from '../../src/services/memory/retrievalEventTypes';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
    },
  }),
}));

describe('MemoryDiagnosticsPanel', () => {
  it('renders budget and retrieval diagnostics rows', () => {
    const retrievalEvent: MemoryRetrievalEvent = {
      id: 'rl-1',
      operation: 'prompt_assembly',
      mode: 'query',
      outcome: 'completed',
      queryFingerprint: {
        hashAlgorithm: 'sha256',
        hash: 'a'.repeat(64),
        length: 17,
        unitCount: 3,
      },
      scope: {
        memoryConversationIdHash: 'b'.repeat(64),
        sourceThreadIdHash: 'c'.repeat(64),
        taskScopePresent: true,
      },
      counts: {
        candidateFactCount: 3,
        selectedFactCount: 2,
        selectedFactIds: ['fact-1', 'fact-2'],
        candidateEpisodeCount: 2,
        selectedEpisodeCount: 1,
        selectedEpisodeIds: ['ep-1'],
      },
      timings: {
        planMs: 1,
        factRecallMs: 2,
        episodeRecallMs: 3,
        candidateFetchMs: 1,
        scoreMs: 1,
        selectorMs: 0,
        evidenceExpansionMs: 0,
        totalMs: 6,
      },
      candidates: {
        strategy: 'hybrid',
        localSimilarityOutcome: 'not_requested',
        eligibleScanCount: 4,
        pinnedCount: 0,
        exactQuotedCount: 0,
        lexicalCount: 3,
        entityCount: 1,
        temporalCount: 1,
        localSimilarityCount: 0,
        unionCount: 3,
        diversifiedCount: 3,
        unionMs: 1,
      },
      expansion: {
        outcome: 'not_requested',
        requestedSourceCount: 0,
        acceptedSourceCount: 0,
        sourceWithEvidenceCount: 0,
        emittedEvidenceCount: 0,
        promptBudgetDroppedCount: 0,
        promptChars: 0,
        durationMs: 0,
      },
      selector: { mode: 'deterministic', outcome: 'not_requested' },
      barrier: { outcome: 'completed', waitMs: 2, queueAgeMs: 5 },
      createdAt: 2000,
    };
    const diagnostics: MemoryDiagnosticsSnapshot = {
      threadId: 'conv-1',
      budgetEntries: [
        {
          conversationId: 'conv-1',
          iteration: 2,
          model: 'gpt-test',
          timestamp: 1000,
          layers: {
            system: 12,
            tools: 4,
            messages: 90,
            memory_cacheable: 0,
            memory_dynamic: 8,
            goals: 1,
          },
          totalTokens: 115,
          contextWindow: 64000,
        },
      ],
      retrievalEntries: [retrievalEvent],
      localSimilarity: {
        model: 'unicode-char-ngram-v1',
        dimensions: 384,
        currentFactCount: 12,
        currentVectorCount: 10,
        pendingVectorCount: 2,
      },
    };

    const { getByTestId, queryByText } = render(
      <MemoryDiagnosticsPanel diagnostics={diagnostics} />,
    );

    expect(getByTestId('memory-diagnostics-panel')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-budget-2')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-retrieval-rl-1')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-local-similarity')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-scope')).toBeTruthy();
    expect(queryByText('hidden query text')).toBeNull();
    expect(queryByText(retrievalEvent.queryFingerprint.hash)).toBeNull();
  });

  it('renders empty states when diagnostics are unavailable', () => {
    const diagnostics: MemoryDiagnosticsSnapshot = {
      threadId: null,
      budgetEntries: [],
      retrievalEntries: [],
      localSimilarity: null,
    };

    const { getByTestId } = render(<MemoryDiagnosticsPanel diagnostics={diagnostics} />);

    expect(getByTestId('memory-diagnostics-budget-empty')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-retrieval-empty')).toBeTruthy();
  });
});
