import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockLoadOverview = jest.fn();
const mockLoadDiagnostics = jest.fn();
const mockExecuteMemoryRecall = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

const mockUseFocusEffect = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => mockUseFocusEffect(callback),
  useRoute: () => ({ params: { tab: 'overview', query: 'atlas' } }),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => jest.fn(),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      primarySoft: '#030',
      danger: '#f00',
      warningBackground: '#332900',
      warning: '#ff0',
    },
  }),
}));

jest.mock('../../src/services/memory/store', () => ({
  readGlobalMemory: jest.fn(async () => ''),
  writeGlobalMemory: jest.fn(),
  listDailyMemoryFiles: jest.fn(() => []),
  readDailyMemory: jest.fn(async () => ''),
  clearAllMemory: jest.fn(),
  subscribeToMemoryChanges: jest.fn(() => jest.fn()),
  getMemoryLastUpdatedAt: jest.fn(() => null),
}));

jest.mock('../../src/services/memory/memoryOverview', () => ({
  loadMemoryOverviewSnapshot: (...args: unknown[]) => mockLoadOverview(...args),
}));

jest.mock('../../src/services/memory/memoryDiagnostics', () => ({
  ...jest.requireActual('../../src/services/memory/memoryDiagnostics'),
  loadMemoryDiagnosticsSnapshot: (...args: unknown[]) => mockLoadDiagnostics(...args),
}));

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => ({ activeConversationId: 'conv-overview' }),
  },
}));

jest.mock('../../src/services/memory/memoryTools', () => ({
  executeMemoryRecall: (...args: unknown[]) => mockExecuteMemoryRecall(...args),
  executeMemoryForget: jest.fn(),
  executeMemoryPin: jest.fn(),
  executeMemoryUnpin: jest.fn(),
  executeMemoryBlockRead: jest.fn(() => ({ ok: true, blocks: [] })),
  executeMemoryBlockEdit: jest.fn(),
}));

jest.mock('../../src/services/memory/episodeRecall', () => ({
  recallRecentEpisodes: jest.fn(() => []),
}));

describe('MemoryScreen overview tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFocusEffect.mockImplementation(() => undefined);
    mockLoadOverview.mockReturnValue({
      focus: { content: 'Release hardening' },
      activeTask: { title: 'Ship Android build' },
      recentFacts: [],
      consolidation: {
        memoryDisabled: false,
        tier: 'chat',
        providerName: 'Gemini',
        explicitProviderSelected: false,
        isFallback: true,
      },
      pendingIngestionJobs: 2,
    });
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      facts: [{ id: 'fact-1', subject: 'project', predicate: 'codename', value: 'Atlas' }],
    });
    mockLoadDiagnostics.mockReturnValue({
      threadId: 'conv-overview',
      budgetEntries: [
        {
          conversationId: 'conv-overview',
          iteration: 1,
          model: 'test-model',
          timestamp: 1,
          layers: {
            system: 10,
            tools: 0,
            messages: 50,
            memory_cacheable: 0,
            memory_dynamic: 0,
            goals: 1,
          },
          totalTokens: 61,
          contextWindow: 128000,
        },
      ],
      retrievalEntries: [
        {
          id: 'rl-1',
          threadId: 'conv-overview',
          taskId: 'goal-1',
          query: 'hidden',
          factIds: ['fact-9'],
          episodeIds: [],
          tokenEstimate: 20,
          createdAt: 2,
        },
      ],
    });
  });

  it('opens overview by default and seeds search from sidebar query', async () => {
    const { getByTestId, getByDisplayValue } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByTestId('memory-overview-tab-panel')).toBeTruthy();
    });

    expect(getByDisplayValue('atlas')).toBeTruthy();
    expect(mockExecuteMemoryRecall).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'atlas' }),
    );
    expect(getByTestId('memory-overview-focus').props.children).toContain('Release hardening');
    expect(getByTestId('memory-overview-task').props.children).toContain('Ship Android build');
    expect(getByTestId('memory-overview-ingestion-pending')).toBeTruthy();
    expect(mockLoadDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-overview' }),
    );
    expect(getByTestId('memory-diagnostics-panel')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-budget-1')).toBeTruthy();
    expect(getByTestId('memory-diagnostics-retrieval-rl-1')).toBeTruthy();
  });

  it('runs recall when overview search is submitted', async () => {
    const { getByTestId } = render(<MemoryScreen />);
    const input = getByTestId('memory-overview-search');

    fireEvent.changeText(input, 'metadata');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(mockExecuteMemoryRecall).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'metadata' }),
      );
    });
  });
});