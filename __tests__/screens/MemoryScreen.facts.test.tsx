// ---------------------------------------------------------------------------
// Tests — MemoryScreen Facts & Blocks tabs
// ---------------------------------------------------------------------------
//
// These tests pin the structured-fact / block UI added to MemoryScreen on top
// of the legacy global/daily file-backed editor. The memoryTools executors are
// mocked so the UI contract is exercised without spinning up the SQLite shim.
// ---------------------------------------------------------------------------

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockExecuteMemoryRecall = jest.fn();
const mockExecuteMemoryPin = jest.fn();
const mockExecuteMemoryUnpin = jest.fn();
const mockExecuteMemoryForget = jest.fn();
const mockExecuteMemoryBlockRead = jest.fn();
const mockExecuteMemoryBlockEdit = jest.fn();
const mockSubscribeToMemoryChanges = jest.fn();
let mockRouteParams: Record<string, unknown> = {};
let memoryListener:
  | ((event: { scope: 'global' | 'conversation' | 'daily' | 'structured' | 'all'; updatedAt: number }) => void)
  | null = null;

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
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
      panel: '#111',
      border: '#333',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      primarySoft: '#030',
      danger: '#f00',
      warning: '#ff0',
      warningBackground: '#332900',
      mode: 'dark',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/services/memory/store', () => ({
  readGlobalMemory: jest.fn().mockResolvedValue(''),
  writeGlobalMemory: jest.fn(),
  listDailyMemoryFiles: jest.fn().mockReturnValue([]),
  readDailyMemory: jest.fn().mockResolvedValue(''),
  clearAllMemory: jest.fn(),
  subscribeToMemoryChanges: (...args: any[]) => mockSubscribeToMemoryChanges(...args),
  getMemoryLastUpdatedAt: jest.fn().mockReturnValue(null),
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
  executeMemoryRecall: (...args: any[]) => mockExecuteMemoryRecall(...args),
  executeMemoryRemember: jest.fn(),
  executeMemoryPin: (...args: any[]) => mockExecuteMemoryPin(...args),
  executeMemoryUnpin: (...args: any[]) => mockExecuteMemoryUnpin(...args),
  executeMemoryForget: (...args: any[]) => mockExecuteMemoryForget(...args),
  executeMemoryBlockRead: (...args: any[]) => mockExecuteMemoryBlockRead(...args),
  executeMemoryBlockEdit: (...args: any[]) => mockExecuteMemoryBlockEdit(...args),
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

const sampleBlock = (overrides: Partial<any> = {}) => ({
  label: 'persona',
  description: 'How the assistant behaves',
  content: 'Friendly and concise',
  pinned: true,
  charLimit: 1000,
  charsUsed: 20,
  ...overrides,
});

describe('MemoryScreen — Facts & Blocks tabs', () => {
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
    mockExecuteMemoryBlockRead.mockReturnValue({ ok: true, blocks: [] });
    mockExecuteMemoryPin.mockReturnValue({ ok: true, fact: sampleFact({ pinned: true }) });
    mockExecuteMemoryUnpin.mockReturnValue({ ok: true, fact: sampleFact({ pinned: false }) });
    mockExecuteMemoryForget.mockReturnValue({
      ok: true,
      fact: sampleFact(),
      mode: 'invalidate',
    });
    mockExecuteMemoryBlockEdit.mockReturnValue({ ok: true, block: sampleBlock() });
  });

  it('renders the Facts tab and shows the empty state when no facts match', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);

    fireEvent.press(getByText('Facts'));

    await waitFor(() => {
      expect(getByTestId('memory-facts-tab')).toBeTruthy();
    });
    expect(getByText('No facts recorded yet. The AI will remember structured facts here.')).toBeTruthy();
  });

  it('lists facts returned by executeMemoryRecall', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact(), sampleFact({ id: 'fact-2', value: 'Habila', predicate: 'lastname' })],
    });

    const { getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => {
      expect(getByText('user · name')).toBeTruthy();
      expect(getByText('Mo')).toBeTruthy();
      expect(getByText('user · lastname')).toBeTruthy();
      expect(getByText('Habila')).toBeTruthy();
    });
  });

  it('Pin button calls executeMemoryPin and refreshes the list', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => expect(getByTestId('memory-fact-pin-fact-1')).toBeTruthy());

    mockExecuteMemoryRecall.mockClear();
    fireEvent.press(getByTestId('memory-fact-pin-fact-1'));

    expect(mockExecuteMemoryPin).toHaveBeenCalledWith({ factId: 'fact-1' });
    // Reload happens after a successful pin/unpin.
    expect(mockExecuteMemoryRecall).toHaveBeenCalled();
  });

  it('Unpin button is used when the fact is already pinned', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact({ pinned: true })],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => expect(getByTestId('memory-fact-pin-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-pin-fact-1'));
    expect(mockExecuteMemoryUnpin).toHaveBeenCalledWith({ factId: 'fact-1' });
    expect(mockExecuteMemoryPin).not.toHaveBeenCalled();
  });

  it('Forget button calls executeMemoryForget with invalidate mode', async () => {
    mockExecuteMemoryRecall.mockReturnValue({
      ok: true,
      subject: null,
      facts: [sampleFact()],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => expect(getByTestId('memory-fact-forget-fact-1')).toBeTruthy());

    fireEvent.press(getByTestId('memory-fact-forget-fact-1'));
    expect(mockExecuteMemoryForget).toHaveBeenCalledWith({
      factId: 'fact-1',
      mode: 'invalidate',
    });
  });

  it('typing in the search filter passes subject to executeMemoryRecall', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => expect(getByTestId('memory-facts-search')).toBeTruthy());

    mockExecuteMemoryRecall.mockClear();
    fireEvent.changeText(getByTestId('memory-facts-search'), 'mo');

    await waitFor(() => {
      expect(mockExecuteMemoryRecall).toHaveBeenCalled();
    });
    const lastCall = mockExecuteMemoryRecall.mock.calls.at(-1)?.[0];
    expect(lastCall?.subject).toBe('mo');
  });

  it('seeds facts search from route params', async () => {
    mockRouteParams = { tab: 'facts', query: 'release target' };

    const { getByTestId } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByTestId('memory-facts-search').props.value).toBe('release target');
    });
    const calls = mockExecuteMemoryRecall.mock.calls.map((call) => call[0]);
    expect(calls.some((args) => args?.subject === 'release target')).toBe(true);
  });

  it('reloads facts when structured memory changes', async () => {
    mockExecuteMemoryRecall
      .mockReturnValueOnce({ ok: true, subject: null, facts: [] })
      .mockReturnValue({ ok: true, subject: null, facts: [sampleFact({ value: 'Fresh fact' })] });

    const { getByText } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByText('No facts recorded yet. The AI will remember structured facts here.')).toBeTruthy();
    });

    await act(async () => {
      memoryListener?.({ scope: 'structured', updatedAt: 100 });
    });

    await waitFor(() => {
      expect(getByText('Fresh fact')).toBeTruthy();
    });
  });

  it('renders the Blocks tab and lists blocks returned by executeMemoryBlockRead', async () => {
    mockExecuteMemoryBlockRead.mockReturnValue({
      ok: true,
      blocks: [sampleBlock(), sampleBlock({ label: 'preferences', content: 'Likes brevity' })],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Blocks'));

    await waitFor(() => {
      expect(getByTestId('memory-blocks-tab')).toBeTruthy();
      expect(getByTestId('memory-block-persona')).toBeTruthy();
      expect(getByTestId('memory-block-preferences')).toBeTruthy();
    });
  });

  it('editing a block draft and pressing Save calls executeMemoryBlockEdit', async () => {
    mockExecuteMemoryBlockRead.mockReturnValue({
      ok: true,
      blocks: [sampleBlock()],
    });

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Blocks'));

    await waitFor(() => expect(getByTestId('memory-block-editor-persona')).toBeTruthy());

    fireEvent.changeText(getByTestId('memory-block-editor-persona'), 'Curious and witty');
    fireEvent.press(getByTestId('memory-block-save-persona'));

    expect(mockExecuteMemoryBlockEdit).toHaveBeenCalledWith({
      label: 'persona',
      content: 'Curious and witty',
      replace: true,
    });
  });

  it('Blocks tab shows empty state when no blocks are defined', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Blocks'));

    await waitFor(() => expect(getByTestId('memory-blocks-tab')).toBeTruthy());
    expect(getByText('No memory blocks defined.')).toBeTruthy();
  });

  // ── Episodes section ──────────────────────────────────────────────────────

  it('shows the episodes empty state when no episodes exist', async () => {
    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => expect(getByTestId('memory-facts-tab')).toBeTruthy());
    expect(getByText('Episodes')).toBeTruthy();
    expect(getByText('No episodes recorded yet. Episodes capture context from completed tasks.')).toBeTruthy();
  });

  it('lists episodes returned by recallRecentEpisodes', async () => {
    mockRecallRecentEpisodes.mockReturnValue([
      { id: 'ep-1', summary: 'Deployed to staging', messageIds: ['m1', 'm2'], toolNames: ['deploy'] },
      { id: 'ep-2', summary: 'Fixed auth bug', messageIds: ['m3'], toolNames: [] },
    ]);

    const { getByText, getByTestId } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => {
      expect(getByTestId('memory-episode-ep-1')).toBeTruthy();
      expect(getByText('Deployed to staging')).toBeTruthy();
      expect(getByText('Fixed auth bug')).toBeTruthy();
    });
  });

  it('reloads episodes when structured memory changes', async () => {
    mockRecallRecentEpisodes
      .mockReturnValueOnce([])
      .mockReturnValue([{ id: 'ep-fresh', summary: 'Fresh episode', messageIds: [], toolNames: [] }]);

    const { getByText } = render(<MemoryScreen />);
    fireEvent.press(getByText('Facts'));

    await waitFor(() => {
      expect(getByText('No episodes recorded yet. Episodes capture context from completed tasks.')).toBeTruthy();
    });

    await act(async () => {
      memoryListener?.({ scope: 'structured', updatedAt: 100 });
    });

    await waitFor(() => {
      expect(getByText('Fresh episode')).toBeTruthy();
    });
  });
});
