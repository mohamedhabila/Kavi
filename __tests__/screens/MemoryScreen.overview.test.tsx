import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockLoadOverview = jest.fn();
const mockLoadDiagnostics = jest.fn();
const mockExecuteMemoryRecall = jest.fn();
const mockResetCanonicalMemory = jest.fn();
let mockActiveConversationId = 'conv-overview';
let mockFocusEffectCallback: (() => void) | null = null;

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
      surfaceAlt: '#191919',
      panel: '#111',
      border: '#333',
      subtleBorder: '#292929',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#000',
      primarySoft: '#030',
      danger: '#f00',
      inputBackground: '#181818',
      inputBorder: '#333',
      overlay: 'rgba(0,0,0,0.65)',
      warningBackground: '#332900',
      warning: '#ff0',
    },
  }),
}));

jest.mock('../../src/services/memory/changeNotifications', () => ({
  subscribeToMemoryChanges: jest.fn(() => jest.fn()),
  getMemoryLastUpdatedAt: jest.fn(() => null),
}));

jest.mock('../../src/services/memory/memoryReset', () => ({
  resetCanonicalMemoryForManagement: () => mockResetCanonicalMemory(),
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
    getState: () => ({ activeConversationId: mockActiveConversationId }),
  },
}));

jest.mock('../../src/services/memory/memoryTools', () => ({
  MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH: 2_000,
  correctMemoryFactForManagement: jest.fn(),
  executeMemoryRecall: (...args: unknown[]) => mockExecuteMemoryRecall(...args),
  queryMemoryFactsForManagement: (...args: unknown[]) => mockExecuteMemoryRecall(...args),
  forgetMemoryFactForManagement: jest.fn(),
  setMemoryFactPinnedForManagement: jest.fn(),
}));

jest.mock('../../src/services/memory/episodeRecall', () => ({
  recallRecentEpisodes: jest.fn(() => []),
}));

function diagnosticsSnapshot(threadId: string, eventId: string) {
  return {
    threadId,
    budgetEntries: [],
    retrievalEntries: [
      {
        id: eventId,
        operation: 'prompt_assembly' as const,
        mode: 'query' as const,
        outcome: 'completed' as const,
        queryFingerprint: {
          hashAlgorithm: 'sha256' as const,
          hash: 'a'.repeat(64),
          length: 12,
          unitCount: 2,
        },
        scope: {
          memoryConversationIdHash: 'b'.repeat(64),
          sourceThreadIdHash: 'c'.repeat(64),
          taskScopePresent: true,
        },
        counts: {
          candidateFactCount: 2,
          selectedFactCount: 1,
          selectedFactIds: ['fact-9'],
          candidateEpisodeCount: 0,
          selectedEpisodeCount: 0,
          selectedEpisodeIds: [],
        },
        timings: {
          planMs: 1,
          factRecallMs: 2,
          episodeRecallMs: 0,
          candidateFetchMs: 1,
          scoreMs: 1,
          selectorMs: 0,
          evidenceExpansionMs: 0,
          totalMs: 3,
        },
        expansion: {
          outcome: 'not_requested' as const,
          requestedSourceCount: 0,
          acceptedSourceCount: 0,
          sourceWithEvidenceCount: 0,
          emittedEvidenceCount: 0,
          promptBudgetDroppedCount: 0,
          promptChars: 0,
          durationMs: 0,
        },
        selector: { mode: 'deterministic' as const, outcome: 'not_requested' as const },
        barrier: null,
        createdAt: 2,
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('MemoryScreen overview tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveConversationId = 'conv-overview';
    mockFocusEffectCallback = null;
    mockUseFocusEffect.mockImplementation((callback: () => void) => {
      mockFocusEffectCallback = callback;
    });
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
    mockLoadDiagnostics.mockResolvedValue({
      ...diagnosticsSnapshot('conv-overview', 'rl-1'),
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
    });
  });

  it('opens overview by default without loading or exposing diagnostics', async () => {
    const { getByTestId, getByDisplayValue, queryByTestId } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByTestId('memory-overview-tab-panel')).toBeTruthy();
    });

    expect(getByDisplayValue('atlas')).toBeTruthy();
    expect(mockExecuteMemoryRecall).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'atlas', memoryKind: 'semantic_fact' }),
    );
    expect(getByTestId('memory-overview-focus').props.children).toContain('Release hardening');
    expect(getByTestId('memory-overview-task').props.children).toContain('Ship Android build');
    expect(queryByTestId('memory-diagnostics-panel')).toBeNull();
    expect(queryByTestId('memory-overview-ingestion-pending')).toBeNull();
    expect(mockLoadDiagnostics).not.toHaveBeenCalled();
  });

  it('keeps diagnostics collapsed in Advanced and loads them only on request', async () => {
    const { getByTestId, queryByTestId } = render(<MemoryScreen />);

    fireEvent.press(getByTestId('memory-advanced-tab'));

    expect(getByTestId('memory-advanced-tab-panel')).toBeTruthy();
    expect(getByTestId('memory-advanced-consolidation')).toBeTruthy();
    expect(getByTestId('memory-advanced-ingestion-pending')).toBeTruthy();
    expect(queryByTestId('memory-diagnostics-panel')).toBeNull();
    expect(mockLoadDiagnostics).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('memory-diagnostics-toggle'));

    await waitFor(() => {
      expect(getByTestId('memory-diagnostics-panel')).toBeTruthy();
    });
    expect(mockLoadDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-overview' }),
    );
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
        expect.objectContaining({ search: 'metadata', memoryKind: 'semantic_fact' }),
      );
    });
  });

  it('clears canonical memory only after destructive confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByTestId } = render(<MemoryScreen />);

    fireEvent.press(getByTestId('memory-advanced-tab'));
    fireEvent.press(getByTestId('memory-clear-all'));
    const destructiveAction = alertSpy.mock.calls[0]?.[2]?.find(
      (action) => action.style === 'destructive',
    );
    expect(mockResetCanonicalMemory).not.toHaveBeenCalled();

    await act(async () => {
      destructiveAction?.onPress?.();
    });

    expect(mockResetCanonicalMemory).toHaveBeenCalledTimes(1);
  });

  it('does not commit an out-of-order diagnostics snapshot after the active thread changes', async () => {
    const conversationA = deferred<ReturnType<typeof diagnosticsSnapshot>>();
    mockActiveConversationId = 'conv-a';
    mockLoadDiagnostics.mockImplementation(({ threadId }: { threadId: string }) =>
      threadId === 'conv-a'
        ? conversationA.promise
        : Promise.resolve(diagnosticsSnapshot('conv-b', 'rl-b')),
    );
    const { getByTestId, queryByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByTestId('memory-advanced-tab'));
    fireEvent.press(getByTestId('memory-diagnostics-toggle'));
    await waitFor(() => {
      expect(mockLoadDiagnostics).toHaveBeenCalledWith({ threadId: 'conv-a' });
    });

    mockActiveConversationId = 'conv-b';
    await act(async () => {
      mockFocusEffectCallback?.();
    });
    await waitFor(() => {
      expect(getByTestId('memory-diagnostics-retrieval-rl-b')).toBeTruthy();
    });

    await act(async () => {
      conversationA.resolve(diagnosticsSnapshot('conv-a', 'rl-a'));
      await conversationA.promise;
    });

    expect(getByTestId('memory-diagnostics-retrieval-rl-b')).toBeTruthy();
    expect(queryByTestId('memory-diagnostics-retrieval-rl-a')).toBeNull();
  });

  it('keeps the everyday overview available when diagnostics fail', async () => {
    mockLoadDiagnostics.mockRejectedValueOnce(new Error('diagnostics unavailable'));
    const { getByTestId, getByText } = render(<MemoryScreen />);

    fireEvent.press(getByTestId('memory-advanced-tab'));
    fireEvent.press(getByTestId('memory-diagnostics-toggle'));

    await waitFor(() => {
      expect(
        getByText('Diagnostics could not be loaded. Refresh and try again.'),
      ).toBeTruthy();
    });

    fireEvent.press(getByTestId('memory-overview-tab'));
    expect(getByTestId('memory-overview-focus').props.children).toContain('Release hardening');
  });
});
