// ---------------------------------------------------------------------------
// Tests — MemoryScreen Facts & Blocks tabs
// ---------------------------------------------------------------------------
//
// These tests pin the structured-fact / block UI added to MemoryScreen on top
// of the legacy global/daily file-backed editor. The memoryTools executors are
// mocked so the UI contract is exercised without spinning up the SQLite shim.
// ---------------------------------------------------------------------------

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockExecuteMemoryRecall = jest.fn();
const mockExecuteMemoryPin = jest.fn();
const mockExecuteMemoryUnpin = jest.fn();
const mockExecuteMemoryForget = jest.fn();
const mockExecuteMemoryBlockRead = jest.fn();
const mockExecuteMemoryBlockEdit = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: () => undefined,
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
  subscribeToMemoryChanges: jest.fn().mockReturnValue(() => undefined),
  getMemoryLastUpdatedAt: jest.fn().mockReturnValue(null),
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
});
