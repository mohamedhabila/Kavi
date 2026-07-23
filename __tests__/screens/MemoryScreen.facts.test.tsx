// ---------------------------------------------------------------------------
// Tests — MemoryScreen Facts & Episodes
// ---------------------------------------------------------------------------
//
// The memoryTools executors are mocked so the structured UI contract is
// exercised without spinning up the SQLite shim.
// ---------------------------------------------------------------------------

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockExecuteMemoryRecall = jest.fn();
const mockSetMemoryFactPinnedForManagement = jest.fn();
const mockExecuteMemoryForget = jest.fn();
const mockCorrectMemoryFactForManagement = jest.fn();
const mockSubscribeToMemoryChanges = jest.fn();
const mockNavigate = jest.fn();
let mockRouteParams: Record<string, unknown> = {};
let memoryListener: ((event: { updatedAt: number }) => void) | null = null;

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
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
      warning: '#ff0',
      warningBackground: '#332900',
      mode: 'dark',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/services/memory/changeNotifications', () => ({
  subscribeToMemoryChanges: (...args: any[]) => mockSubscribeToMemoryChanges(...args),
  getMemoryLastUpdatedAt: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/memory/memoryReset', () => ({
  resetCanonicalMemoryForManagement: jest.fn(),
}));

const mockRecallRecentEpisodes = jest.fn();

jest.mock('../../src/services/memory/episodeRecall', () => ({
  recallRecentEpisodes: (...args: any[]) => mockRecallRecentEpisodes(...args),
}));

jest.mock('../../src/services/memory/memoryOverview', () => ({
  loadMemoryOverviewSnapshot: () => ({
    focus: null,
    activeTask: null,
    recentFacts: [],
    consolidation: {
      memoryDisabled: false,
      tier: 'deterministic',
      providerName: null,
      explicitProviderSelected: false,
      isFallback: true,
    },
    pendingIngestionJobs: 0,
  }),
}));

jest.mock('../../src/services/memory/memoryDiagnostics', () => ({
  loadMemoryDiagnosticsSnapshot: () => ({
    threadId: null,
    budgetEntries: [],
    retrievalEntries: [],
  }),
}));

jest.mock('../../src/components/memory/MemoryDiagnosticsPanel', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    MemoryDiagnosticsPanel: () => React.createElement(View, { testID: 'memory-diagnostics-panel' }),
  };
});

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => ({ activeConversationId: null }),
  },
}));

jest.mock('../../src/services/memory/memoryTools', () => ({
  MAX_MANAGED_MEMORY_FACT_VALUE_LENGTH: 2_000,
  correctMemoryFactForManagement: (...args: any[]) =>
    mockCorrectMemoryFactForManagement(...args),
  executeMemoryRecall: (...args: any[]) => mockExecuteMemoryRecall(...args),
  queryMemoryFactsForManagement: (...args: any[]) => mockExecuteMemoryRecall(...args),
  executeMemoryRemember: jest.fn(),
  setMemoryFactPinnedForManagement: (...args: any[]) =>
    mockSetMemoryFactPinnedForManagement(...args),
  forgetMemoryFactForManagement: (...args: any[]) => mockExecuteMemoryForget(...args),
}));

const sampleFact = (overrides: Partial<any> = {}) => ({
  id: 'fact-1',
  subject: 'user',
  predicate: 'name',
  value: 'Mo',
  pinned: false,
  confidence: 0.95,
  createdAt: 1000,
  ...overrides,
});

describe('MemoryScreen — Facts & Episodes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = {};
    memoryListener = null;
    mockRecallRecentEpisodes.mockReturnValue([]);
    mockSubscribeToMemoryChanges.mockImplementation((listener: typeof memoryListener) => {
      memoryListener = listener;
      return jest.fn();
    });
    mockExecuteMemoryRecall.mockReturnValue({ ok: true, subject: null, facts: [] });
    mockSetMemoryFactPinnedForManagement.mockImplementation((_args, pinned) => ({
      ok: true,
      fact: sampleFact({ pinned }),
    }));
    mockCorrectMemoryFactForManagement.mockReturnValue({
      ok: true,
      status: 'corrected',
      fact: sampleFact({ value: 'Mohamed' }),
      supersededFactId: 'fact-1',
    });
    mockExecuteMemoryForget.mockReturnValue({
      ok: true,
      action: 'withdrawal',
      receipt: {
        status: 'withdrawn',
        withdrawalId: 'withdrawal-1',
        factId: 'fact-1',
        withdrawnAt: 1_000,
        counts: {},
      },
    });
  });

  it('renders the Facts tab and shows the empty state when no facts match', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);

    fireEvent.press(getByText('All memories'));

    await waitFor(() => {
      expect(getByTestId('memory-facts-tab')).toBeTruthy();
    });
    expect(
      getByText(
        'Nothing remembered yet. Ask Kavi to remember a preference or detail, and it will appear here.',
      ),
    ).toBeTruthy();
  });

  it('lists facts returned by executeMemoryRecall', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact(), sampleFact({ id: 'fact-2', value: 'Habila', predicate: 'lastname' })],
    });

    const { getAllByText, getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => {
      expect(getAllByText('About you')).toHaveLength(2);
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('Mo')).toBeTruthy();
      expect(getByText('Lastname')).toBeTruthy();
      expect(getByText('Habila')).toBeTruthy();
    });
  });

  it('Pin button uses explicit whole-vault management and refreshes the list', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => expect(getByTestId('memory-fact-pin-fact-1')).toBeTruthy());

    mockExecuteMemoryRecall.mockClear();
    fireEvent.press(getByTestId('memory-fact-pin-fact-1'));

    expect(mockSetMemoryFactPinnedForManagement).toHaveBeenCalledWith({ factId: 'fact-1' }, true);
    // Reload happens after a successful pin/unpin.
    expect(mockExecuteMemoryRecall).toHaveBeenCalled();
  });

  it('passes pinned=false when the fact is already pinned', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact({ pinned: true })],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => expect(getByTestId('memory-fact-pin-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-pin-fact-1'));
    expect(mockSetMemoryFactPinnedForManagement).toHaveBeenCalledWith({ factId: 'fact-1' }, false);
  });

  it('shows a content-free recovery alert when pinning fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });
    mockSetMemoryFactPinnedForManagement.mockReturnValue({
      ok: false,
      code: 'internal',
      error: 'private storage detail',
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));
    await waitFor(() => expect(getByTestId('memory-fact-pin-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-pin-fact-1'));

    expect(alertSpy).toHaveBeenLastCalledWith(
      'Memory not updated',
      'Reload memory and try again.',
    );
    expect(JSON.stringify(alertSpy.mock.calls.at(-1))).not.toContain('private storage detail');
    alertSpy.mockRestore();
  });

  it('corrects an exact remembered fact and refreshes the visible memories', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });

    const { getByText, getByTestId, queryByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));
    await waitFor(() => expect(getByTestId('memory-fact-correct-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-correct-fact-1'));

    expect(getByTestId('memory-correction-input').props.value).toBe('Mo');
    expect(getByTestId('memory-correction-save').props.accessibilityState).toEqual({
      disabled: true,
    });

    fireEvent.changeText(getByTestId('memory-correction-input'), 'x'.repeat(2_001));
    expect(getByTestId('memory-correction-save').props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(getByText('Keep this memory to 2000 characters or fewer.')).toBeTruthy();

    fireEvent.changeText(getByTestId('memory-correction-input'), 'x'.repeat(2_000));
    expect(getByTestId('memory-correction-save').props.accessibilityState).toEqual({
      disabled: false,
    });

    fireEvent.changeText(getByTestId('memory-correction-input'), 'Mohamed');
    mockExecuteMemoryRecall.mockClear();
    fireEvent.press(getByTestId('memory-correction-save'));

    expect(mockCorrectMemoryFactForManagement).toHaveBeenCalledWith({
      factId: 'fact-1',
      value: 'Mohamed',
    });
    expect(queryByTestId('memory-correction-modal')).toBeNull();
    expect(mockExecuteMemoryRecall).toHaveBeenCalled();
  });

  it('keeps correction failures private and clears feedback when editing resumes', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });
    mockCorrectMemoryFactForManagement.mockReturnValue({
      ok: false,
      status: 'failed_unknown',
      code: 'internal',
      error: 'PRIVATE STORAGE DETAIL',
    });

    const { getByText, getByTestId, queryByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));
    await waitFor(() => expect(getByTestId('memory-fact-correct-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-correct-fact-1'));
    fireEvent.changeText(getByTestId('memory-correction-input'), 'Mohamed');
    fireEvent.press(getByTestId('memory-correction-save'));

    expect(
      getByText('This memory could not be updated. Close it and try again.'),
    ).toBeTruthy();
    expect(queryByText('PRIVATE STORAGE DETAIL')).toBeNull();
    expect(getByTestId('memory-correction-modal')).toBeTruthy();

    fireEvent.changeText(getByTestId('memory-correction-input'), 'Mohamed Habila');
    expect(queryByText('This memory could not be updated. Close it and try again.')).toBeNull();
  });

  it('Forget confirmation cancels safely and executes withdrawal exactly once on confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => expect(getByTestId('memory-fact-forget-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-forget-fact-1'));
    expect(mockExecuteMemoryForget).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls.at(-1)?.[2];
    expect(buttons?.[0]).toEqual(expect.objectContaining({ style: 'cancel' }));
    act(() => buttons?.[0]?.onPress?.());
    expect(mockExecuteMemoryForget).not.toHaveBeenCalled();

    expect(buttons?.[1]).toEqual(expect.objectContaining({ style: 'destructive' }));
    act(() => buttons?.[1]?.onPress?.());
    expect(mockExecuteMemoryForget).toHaveBeenCalledTimes(1);
    expect(mockExecuteMemoryForget).toHaveBeenCalledWith({ factId: 'fact-1' });

    alertSpy.mockRestore();
  });

  it('shows a content-free failure alert and does not refresh when withdrawal fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });
    mockExecuteMemoryForget.mockReturnValue({
      ok: false,
      code: 'internal',
      error: 'sensitive database detail',
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));
    await waitFor(() => expect(getByTestId('memory-fact-forget-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-forget-fact-1'));
    const recallCountBeforeConfirm = mockExecuteMemoryRecall.mock.calls.length;
    const buttons = alertSpy.mock.calls.at(-1)?.[2];
    act(() => buttons?.[1]?.onPress?.());

    expect(mockExecuteMemoryForget).toHaveBeenCalledTimes(1);
    expect(mockExecuteMemoryRecall).toHaveBeenCalledTimes(recallCountBeforeConfirm);
    expect(alertSpy).toHaveBeenLastCalledWith('Memory not removed', 'Reload memory and try again.');
    expect(JSON.stringify(alertSpy.mock.calls.at(-1))).not.toContain('sensitive database detail');

    alertSpy.mockRestore();
  });

  it('searches across remembered details and keeps results semantic', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => expect(getByTestId('memory-facts-search')).toBeTruthy());

    mockExecuteMemoryRecall.mockClear();
    fireEvent.changeText(getByTestId('memory-facts-search'), 'mo');

    await waitFor(() => {
      expect(mockExecuteMemoryRecall).toHaveBeenCalled();
    });
    const lastCall = mockExecuteMemoryRecall.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual(
      expect.objectContaining({ search: 'mo', memoryKind: 'semantic_fact' }),
    );
  });

  it('seeds facts search from route params', async () => {
    mockRouteParams = { tab: 'facts', query: 'release target' };

    const { getByTestId } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByTestId('memory-facts-search').props.value).toBe('release target');
    });
    const calls = mockExecuteMemoryRecall.mock.calls.map((call) => call[0]);
    expect(
      calls.some(
        (args) => args?.search === 'release target' && args?.memoryKind === 'semantic_fact',
      ),
    ).toBe(true);
  });

  it('reloads facts when structured memory changes', async () => {
    mockExecuteMemoryRecall
      .mockReturnValueOnce({ ok: true, subject: null, facts: [] })
      .mockReturnValue({ ok: true, subject: null, facts: [sampleFact({ value: 'Fresh fact' })] });

    const { getByText } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(
        getByText('No recent memories yet. Ask Kavi to remember a preference or detail.'),
      ).toBeTruthy();
    });

    await act(async () => {
      memoryListener?.({ updatedAt: 100 });
    });

    await waitFor(() => {
      expect(getByText('Fresh fact')).toBeTruthy();
    });
  });

  // ── Episodes section ──────────────────────────────────────────────────────

  it('shows the episodes empty state when no episodes exist', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => expect(getByTestId('memory-facts-tab')).toBeTruthy());
    expect(getByText('Episodes')).toBeTruthy();
    expect(
      getByText('No episodes recorded yet. Episodes capture context from completed tasks.'),
    ).toBeTruthy();
  });

  it('lists episodes returned by recallRecentEpisodes', async () => {
    mockRecallRecentEpisodes.mockReturnValue([
      {
        id: 'ep-1',
        summary: 'Deployed to staging',
        messageIds: ['m1', 'm2'],
        toolNames: ['deploy'],
      },
      { id: 'ep-2', summary: 'Fixed auth bug', messageIds: ['m3'], toolNames: [] },
    ]);

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => {
      expect(getByTestId('memory-episode-ep-1')).toBeTruthy();
      expect(getByText('Deployed to staging')).toBeTruthy();
      expect(getByText('Fixed auth bug')).toBeTruthy();
    });
  });

  it('reloads episodes when structured memory changes', async () => {
    mockRecallRecentEpisodes
      .mockReturnValueOnce([])
      .mockReturnValue([
        { id: 'ep-fresh', summary: 'Fresh episode', messageIds: [], toolNames: [] },
      ]);

    const { getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('All memories'));

    await waitFor(() => {
      expect(
        getByText('No episodes recorded yet. Episodes capture context from completed tasks.'),
      ).toBeTruthy();
    });

    await act(async () => {
      memoryListener?.({ updatedAt: 100 });
    });

    await waitFor(() => {
      expect(getByText('Fresh episode')).toBeTruthy();
    });
  });
});
