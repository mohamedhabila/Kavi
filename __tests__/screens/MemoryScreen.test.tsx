import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MemoryScreen } from '../../src/screens/MemoryScreen';

const mockUseFocusEffect = jest.fn();
const mockReadGlobalMemory = jest.fn();
const mockWriteGlobalMemory = jest.fn();
const mockListDailyMemoryFiles = jest.fn();
const mockReadDailyMemory = jest.fn();
const mockClearAllMemory = jest.fn();
const mockSubscribeToMemoryChanges = jest.fn();
const mockGetMemoryLastUpdatedAt = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => mockUseFocusEffect(callback),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => jest.fn(),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      panel: '#111',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      onDanger: '#fff',
      dangerSoft: '#300',
      success: '#0f0',
      overlay: 'rgba(0,0,0,0.5)',
      inputBackground: '#111',
      inputBorder: '#333',
      toolCard: '#111',
      toolCardHeader: '#111',
      codeBackground: '#111',
      link: '#0f0',
      onPrimaryLink: '#fff',
      warning: '#ff0',
      warningBackground: '#332900',
      accent: '#0f0',
      info: '#09f',
      userBubble: '#222',
      assistantBubble: '#111',
      mode: 'dark',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/services/memory/store', () => ({
  readGlobalMemory: (...args: any[]) => mockReadGlobalMemory(...args),
  writeGlobalMemory: (...args: any[]) => mockWriteGlobalMemory(...args),
  listDailyMemoryFiles: (...args: any[]) => mockListDailyMemoryFiles(...args),
  readDailyMemory: (...args: any[]) => mockReadDailyMemory(...args),
  clearAllMemory: (...args: any[]) => mockClearAllMemory(...args),
  subscribeToMemoryChanges: (...args: any[]) => mockSubscribeToMemoryChanges(...args),
  getMemoryLastUpdatedAt: (...args: any[]) => mockGetMemoryLastUpdatedAt(...args),
}));

// MemoryScreen now reads from the structured fact store.
// These tests focus on the file-backed global/daily tabs, so we stub the
// memoryTools executors to return empty result sets — the dedicated facts/blocks
// tab tests live in MemoryScreen.facts.test.tsx.
jest.mock('../../src/services/memory/memoryTools', () => ({
  executeMemoryRecall: () => ({ ok: true, subject: null, facts: [] }),
  executeMemoryRemember: () => ({ ok: true, fact: null, status: 'created', superseded: [] }),
  executeMemoryPin: () => ({ ok: true, fact: null }),
  executeMemoryUnpin: () => ({ ok: true, fact: null }),
  executeMemoryForget: () => ({ ok: true, fact: null, mode: 'invalidate' }),
  executeMemoryBlockRead: () => ({ ok: true, blocks: [] }),
  executeMemoryBlockEdit: () => ({ ok: true, block: null }),
}));

let memoryListener:
  | ((event: { scope: 'global' | 'daily' | 'all'; updatedAt: number }) => void)
  | null = null;
let focusEffectCallback: (() => void | (() => void)) | null = null;
let currentGlobalMemory = 'First memory';

describe('MemoryScreen', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    memoryListener = null;
    focusEffectCallback = null;
    currentGlobalMemory = 'First memory';
    mockWriteGlobalMemory.mockReset();
    mockClearAllMemory.mockReset();
    mockReadGlobalMemory.mockImplementation(async () => currentGlobalMemory);
    mockListDailyMemoryFiles.mockReturnValue([]);
    mockReadDailyMemory.mockResolvedValue(null);
    mockGetMemoryLastUpdatedAt.mockReturnValue(null);
    mockSubscribeToMemoryChanges.mockImplementation((listener: typeof memoryListener) => {
      memoryListener = listener;
      return jest.fn();
    });
    mockUseFocusEffect.mockImplementation((callback: () => void | (() => void)) => {
      focusEffectCallback = callback;
    });
  });

  it('loads global memory on mount', async () => {
    const { getByDisplayValue } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('First memory')).toBeTruthy();
    });
  });

  it('refreshes immediately when global memory changes elsewhere', async () => {
    currentGlobalMemory = 'Initial memory';

    const { getByDisplayValue, queryByDisplayValue } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('Initial memory')).toBeTruthy();
    });

    currentGlobalMemory = 'Updated memory';

    await act(async () => {
      memoryListener?.({ scope: 'global', updatedAt: Date.now() });
    });

    await waitFor(() => {
      expect(getByDisplayValue('Updated memory')).toBeTruthy();
    });

    expect(queryByDisplayValue('Initial memory')).toBeNull();
  });

  it('refreshes when the screen regains focus', async () => {
    currentGlobalMemory = 'Initial memory';

    const { getByDisplayValue } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('Initial memory')).toBeTruthy();
    });

    currentGlobalMemory = 'Focused memory';

    await act(async () => {
      await focusEffectCallback?.();
    });

    await waitFor(() => {
      expect(getByDisplayValue('Focused memory')).toBeTruthy();
    });
  });

  it('does not overwrite unsaved edits when external memory changes', async () => {
    currentGlobalMemory = 'Saved memory';

    const { getByDisplayValue, getByText } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('Saved memory')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('Saved memory'), 'Unsaved local edit');
    currentGlobalMemory = 'Remote saved memory';

    await act(async () => {
      memoryListener?.({ scope: 'global', updatedAt: Date.now() });
    });

    await waitFor(() => {
      expect(getByDisplayValue('Unsaved local edit')).toBeTruthy();
      expect(
        getByText(
          'Memory changed elsewhere while you had unsaved edits. Refresh to load the latest saved version.',
        ),
      ).toBeTruthy();
    });
  });

  it('saves edited global memory and clears the dirty state', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    currentGlobalMemory = 'Saved memory';

    const { getByDisplayValue, getByLabelText, queryByLabelText } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('Saved memory')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('Saved memory'), 'Updated memory');
    fireEvent.press(getByLabelText('Save'));

    expect(mockWriteGlobalMemory).toHaveBeenCalledWith('Updated memory');
    expect(alertSpy).toHaveBeenCalledWith('Saved', 'Memory has been saved.');
    await waitFor(() => expect(queryByLabelText('Save')).toBeNull());
    alertSpy.mockRestore();
  });

  it('reloads the latest global memory when refreshing an external-update notice', async () => {
    currentGlobalMemory = 'Saved memory';

    const { getByDisplayValue, getByText, queryByText, queryByDisplayValue } = render(
      <MemoryScreen />,
    );

    await waitFor(() => {
      expect(getByDisplayValue('Saved memory')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('Saved memory'), 'Unsaved local edit');
    currentGlobalMemory = 'Remote saved memory';

    await act(async () => {
      memoryListener?.({ scope: 'global', updatedAt: Date.now() });
    });

    await waitFor(() => {
      expect(
        getByText(
          'Memory changed elsewhere while you had unsaved edits. Refresh to load the latest saved version.',
        ),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Refresh'));
    });

    await waitFor(() => {
      expect(getByDisplayValue('Remote saved memory')).toBeTruthy();
      expect(queryByDisplayValue('Unsaved local edit')).toBeNull();
      expect(
        queryByText(
          'Memory changed elsewhere while you had unsaved edits. Refresh to load the latest saved version.',
        ),
      ).toBeNull();
    });
  });

  it('loads daily notes and lets the user switch between dates', async () => {
    mockListDailyMemoryFiles.mockReturnValue(['2026-01-01', '2026-01-02']);
    mockReadDailyMemory.mockImplementation(async (date: string) => {
      if (date === '2026-01-02') return 'Second daily note';
      return 'First daily note';
    });

    const { getAllByText, getByText, queryByText } = render(<MemoryScreen />);

    fireEvent.press(getByText('Daily Notes (2)'));

    await waitFor(() => {
      expect(getByText('First daily note')).toBeTruthy();
      expect(getAllByText('2026-01-01').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.press(getByText('2026-01-02'));
    });

    await waitFor(() => {
      expect(getByText('Second daily note')).toBeTruthy();
      expect(queryByText('First daily note')).toBeNull();
    });
  });

  it('refreshes the daily tab when daily memory changes elsewhere', async () => {
    let dailyFiles = ['2026-01-01'];
    mockListDailyMemoryFiles.mockImplementation(() => dailyFiles);
    mockReadDailyMemory.mockImplementation(async (date: string) => {
      if (date === '2026-01-02') return 'Second daily note';
      return dailyFiles.includes('2026-01-02') ? 'Updated first daily note' : 'First daily note';
    });

    const { getByText } = render(<MemoryScreen />);

    fireEvent.press(getByText('Daily Notes (1)'));

    await waitFor(() => {
      expect(getByText('First daily note')).toBeTruthy();
    });

    dailyFiles = ['2026-01-01', '2026-01-02'];

    await act(async () => {
      memoryListener?.({ scope: 'daily', updatedAt: Date.now() });
    });

    await waitFor(() => {
      expect(getByText('Updated first daily note')).toBeTruthy();
      expect(getByText('Daily Notes (2)')).toBeTruthy();
      expect(getByText('2026-01-02')).toBeTruthy();
    });
  });

  it('clears all memory after destructive confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((button: any) => button.style === 'destructive');
      destructive?.onPress?.();
    });
    currentGlobalMemory = 'Saved memory';
    mockListDailyMemoryFiles.mockReturnValue(['2026-01-01']);
    mockReadDailyMemory.mockResolvedValue('Daily note');

    const { getByDisplayValue, getByLabelText, getByText, queryByText } = render(<MemoryScreen />);

    await waitFor(() => {
      expect(getByDisplayValue('Saved memory')).toBeTruthy();
    });

    fireEvent.press(getByText('Daily Notes (1)'));

    await waitFor(() => {
      expect(getByText('Daily note')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByLabelText('Clear All'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Clear All Memory',
      'This will permanently delete all global memory and daily notes. This cannot be undone.',
      expect.any(Array),
    );
    expect(mockClearAllMemory).toHaveBeenCalled();

    await waitFor(() => {
      expect(
        getByText('No daily notes yet. These are created automatically during conversations.'),
      ).toBeTruthy();
      expect(queryByText('Daily note')).toBeNull();
    });

    alertSpy.mockRestore();
  });
});
