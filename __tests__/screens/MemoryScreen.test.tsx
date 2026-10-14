jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  // Like the real hook on a focused screen: runs the effect again whenever it changes.
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('../../src/navigation/useBackToChat', () => ({
  useBackToChat: () => jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { MemoryScreen } from '../../src/screens/MemoryScreen';
import { closeMemoryDb } from '../../src/services/memory/database';
import * as memoryItemsStore from '../../src/services/memory/core/memoryItemsStore';
import {
  addMemoryItem,
  getCurrentMemoryItem,
  listMemoryItems,
} from '../../src/services/memory/core/memoryItemsStore';
import { resetMemoryCoreSchemaCacheForTests } from '../../src/services/memory/core/memorySchema';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function remember(
  text: string,
  now: number,
  extra: { pinned?: boolean; sensitive?: boolean } = {},
) {
  const result = addMemoryItem({ text, conversationId: 'conv-1', now, ...extra });
  if (result.status !== 'created') throw new Error(`not saved: ${result.status}`);
  return result.item;
}

/** Answers every confirmation by pressing its destructive button. */
function confirmAlerts(): jest.SpyInstance {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    (buttons as AlertButton[] | undefined)
      ?.find((button) => button.style === 'destructive')
      ?.onPress?.();
  });
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  mockRouteParams = {};
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

afterAll(() => {
  closeMemoryDb();
});

describe('the memory screen', () => {
  it('lists what Kavi remembers, newest first, marking pinned and sensitive items', async () => {
    remember('Sara is the user’s sister and lives in Porto', 1_000);
    remember('Prefers window seats on long flights', 2_000, { pinned: true });
    remember('Takes blood-pressure medication every morning', 3_000, { sensitive: true });

    render(<MemoryScreen />);

    await waitFor(() => expect(screen.getByText('3 memories')).toBeTruthy());
    const texts = screen
      .getAllByTestId(/^memory-item-[^-]+$/u)
      .map((card) => card.props.testID as string);
    expect(texts).toHaveLength(3);
    expect(screen.getAllByText('Pinned')).toHaveLength(1);
    expect(screen.getAllByText('Sensitive')).toHaveLength(1);
    expect(
      screen.getAllByText(/Porto|window seats|medication/u).map((node) => node.props.children),
    ).toEqual([
      'Takes blood-pressure medication every morning',
      'Prefers window seats on long flights',
      'Sara is the user’s sister and lives in Porto',
    ]);
  });

  it('finds memories by search, starting from a query the screen was opened with', () => {
    jest.useFakeTimers();
    remember('Sara is the user’s sister and lives in Porto', 1_000);
    remember('أفضل وقت للاجتماعات هو الصباح الباكر', 2_000);
    mockRouteParams = { query: 'sister Sara' };

    render(<MemoryScreen />);

    expect(screen.getByText('1 memory')).toBeTruthy();
    expect(screen.getByText('Sara is the user’s sister and lives in Porto')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('memory-search'), 'أفضل وقت');
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByText('أفضل وقت للاجتماعات هو الصباح الباكر')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('memory-search'), 'kayak');
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByText('No memories match your search.')).toBeTruthy();
  });

  it('searches once typing pauses, not on every keystroke', () => {
    jest.useFakeTimers();
    remember('Sara is the user’s sister and lives in Porto', 1_000);
    render(<MemoryScreen />);
    act(() => jest.runOnlyPendingTimers());
    const search = jest.spyOn(memoryItemsStore, 'searchMemoryItems');

    for (const query of ['S', 'Sa', 'Sar', 'Sara']) {
      fireEvent.changeText(screen.getByTestId('memory-search'), query);
    }
    expect(search).not.toHaveBeenCalled();

    act(() => jest.runOnlyPendingTimers());
    expect(search.mock.calls.map(([params]) => params.query)).toEqual(['Sara']);
    expect(screen.getByText('1 memory')).toBeTruthy();
  });

  it('pins an item and forgets another after confirmation', async () => {
    const seat = remember('Prefers window seats on long flights', 1_000);
    const porto = remember('Sara is the user’s sister and lives in Porto', 2_000);
    confirmAlerts();

    render(<MemoryScreen />);
    await waitFor(() => expect(screen.getByText('2 memories')).toBeTruthy());

    fireEvent.press(screen.getByTestId(`memory-item-pin-${seat.id}`));
    expect(getCurrentMemoryItem(seat.id)?.pinned).toBe(true);

    fireEvent.press(screen.getByTestId(`memory-item-forget-${porto.id}`));
    expect(getCurrentMemoryItem(porto.id)).toBeNull();
    await waitFor(() => expect(screen.getByText('1 memory')).toBeTruthy());
    expect(screen.queryByText('Sara is the user’s sister and lives in Porto')).toBeNull();
  });

  it('clears all memory after confirmation', async () => {
    remember('Prefers window seats on long flights', 1_000);
    remember('Sara is the user’s sister and lives in Porto', 2_000);
    confirmAlerts();

    render(<MemoryScreen />);
    await waitFor(() => expect(screen.getByText('2 memories')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('memory-clear-all'));
    });

    expect(listMemoryItems({ limit: 10, offset: 0 })).toEqual([]);
    await waitFor(() => expect(screen.getByText('0 memories')).toBeTruthy());
    expect(
      screen.getByText(
        'Nothing remembered yet. Ask Kavi to remember a preference or detail, and it will appear here.',
      ),
    ).toBeTruthy();
  });

  it('says when memory is off', async () => {
    useSettingsStore.setState({ disableLongTermMemory: true });

    render(<MemoryScreen />);

    await waitFor(() =>
      expect(screen.getByText("Memory is off, so Kavi isn't saving anything new.")).toBeTruthy(),
    );
  });
});
