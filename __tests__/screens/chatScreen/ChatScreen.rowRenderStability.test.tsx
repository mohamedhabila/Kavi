const mockRowRenderCounts = new Map<string, number>();
const mockRowContentById = new Map<string, string>();
const mockRowPreviousProps = new Map<string, Record<string, unknown>>();
const mockRowPropDiffs = new Map<string, string[]>();

jest.mock('../../../src/screens/chatScreen/ConversationMessageRow', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  const ConversationMessageRow = React.memo(function MockConversationMessageRow(props: any) {
    const itemId = props.item.id;
    const content = props.item.resolvedMessage.content;
    const previousProps = mockRowPreviousProps.get(itemId);

    if (previousProps) {
      const propKeys = new Set([...Object.keys(previousProps), ...Object.keys(props)]);
      const changedProps = Array.from(propKeys).filter(
        (propKey) => previousProps[propKey] !== props[propKey],
      );
      mockRowPropDiffs.set(itemId, changedProps);
    }

    mockRowRenderCounts.set(itemId, (mockRowRenderCounts.get(itemId) ?? 0) + 1);
    mockRowContentById.set(itemId, content);
    mockRowPreviousProps.set(itemId, props);

    return React.createElement(
      View,
      { testID: `conversation-row-${itemId}` },
      React.createElement(Text, null, content || itemId),
    );
  });

  return { ConversationMessageRow };
});

import {
  act,
  fireEvent,
  render,
  waitFor,
  ChatScreen,
} from '../../../testSupport/chatScreen/runtime';
import {
  cleanupChatScreenTestEnvironment,
  resetChatScreenTestEnvironment,
} from '../../../testSupport/chatScreen/mockDefaults';
import { mockRunOrchestrator } from '../../../testSupport/chatScreen/serviceMocks';

const cloneRenderCounts = () => new Map(mockRowRenderCounts);

const expectCountsUnchanged = (beforeCounts: Map<string, number>, ignoredIds = new Set<string>()) => {
  for (const [itemId, count] of beforeCounts) {
    if (!ignoredIds.has(itemId)) {
      const nextCount = mockRowRenderCounts.get(itemId);
      if (nextCount !== count) {
        throw new Error(
          `Row ${itemId} rendered ${nextCount} times, expected ${count}; changed props: ${
            mockRowPropDiffs.get(itemId)?.join(', ') || 'none'
          }`,
        );
      }
    }
  }
};

describe('ChatScreen row render stability', () => {
  beforeEach(() => {
    mockRowRenderCounts.clear();
    mockRowContentById.clear();
    mockRowPreviousProps.clear();
    mockRowPropDiffs.clear();
    resetChatScreenTestEnvironment();
  });
  afterEach(cleanupChatScreenTestEnvironment);

  it('does not re-render message rows during composer edits', () => {
    const screen = render(<ChatScreen />);
    const beforeCounts = cloneRenderCounts();

    expect(beforeCounts.size).toBeGreaterThan(0);

    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Draft without row churn');

    expectCountsUnchanged(beforeCounts);
  });

  it('limits streaming draft updates to the active streaming row', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Stream row stability');
    fireEvent.press(screen.getByTestId('chat-send-button'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const beforeFirstDraft = cloneRenderCounts();

    act(() => {
      callbacks.onToken('First');
    });

    const streamingRowId = Array.from(mockRowContentById.entries()).find(([, content]) =>
      content.includes('First'),
    )?.[0];
    expect(streamingRowId).toBeDefined();
    expectCountsUnchanged(beforeFirstDraft, new Set([streamingRowId!]));

    const beforeSecondDraft = cloneRenderCounts();
    act(() => {
      callbacks.onToken(' update');
      jest.advanceTimersByTime(48);
    });

    expect(mockRowContentById.get(streamingRowId!)).toBe('First update');
    expectCountsUnchanged(beforeSecondDraft, new Set([streamingRowId!]));
  });

  it('does not start polling timers while the chat screen is idle', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    render(<ChatScreen />);

    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });
});
