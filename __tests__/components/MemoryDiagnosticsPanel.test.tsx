import { render } from '@testing-library/react-native';
import { MemoryDiagnosticsPanel } from '../../src/components/memory/MemoryDiagnosticsPanel';
import type { MemoryDiagnosticsSnapshot } from '../../src/services/memory/memoryDiagnostics';

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
      retrievalEntries: [
        {
          id: 'rl-1',
          threadId: 'conv-1',
          taskId: 'goal-9',
          query: 'hidden query text',
          factIds: ['fact-1', 'fact-2'],
          episodeIds: ['ep-1'],
          tokenEstimate: 55,
          createdAt: 2000,
        },
      ],
    };

    const { getByTestId, queryByText } = render(
      <MemoryDiagnosticsPanel diagnostics={diagnostics} />,
    );

    expect(getByTestId('memory-diagnostics-panel')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-budget-2')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-retrieval-rl-1')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-scope')).toBeTruthy();
    expect(queryByText('hidden query text')).toBeNull();
  });

  it('renders empty states when diagnostics are unavailable', () => {
    const diagnostics: MemoryDiagnosticsSnapshot = {
      threadId: null,
      budgetEntries: [],
      retrievalEntries: [],
    };

    const { getByTestId } = render(<MemoryDiagnosticsPanel diagnostics={diagnostics} />);

    expect(getByTestId('memory-diagnostics-budget-empty')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-retrieval-empty')).toBeTruthy();
  });
});