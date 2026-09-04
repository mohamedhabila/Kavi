// ---------------------------------------------------------------------------
// Tests — ToolCallDisplay Component
// ---------------------------------------------------------------------------
//
// Pure-function coverage for the presentation helpers and session-tool summaries
// lives in the sibling suites (split out to stay under the maintainability line
// limit): ToolCallDisplay.presentationHelpers.test.ts and
// ToolCallDisplay.sessionSummaries.test.ts. All three share fixtures from
// __tests__/helpers/toolCallDisplayFixtures.ts.

import { StyleSheet } from 'react-native';
import { act, render, fireEvent } from '@testing-library/react-native';
import { summarizeToolCall, ToolCallDisplay } from '../../src/components/chat/ToolCallDisplay';
import { makeToolCall } from '../helpers/toolCallDisplayFixtures';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      border: '#333',
      danger: '#f00',
      success: '#0f0',
      primary: '#08f',
      primarySoft: '#024',
      toolCard: '#111',
      toolCardHeader: '#222',
      codeBackground: '#000',
    },
  }),
  AppPalette: {},
}));

describe('ToolCallDisplay', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render the human outcome before the internal tool name', () => {
    const { getByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    expect(getByText('Reading test.txt')).toBeTruthy();
  });

  it('should render a friendly summary for file operations', () => {
    const tc = makeToolCall({ name: 'write_file', arguments: '{"path":"game/index.html"}' });
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    expect(getByText('Creating game/index.html')).toBeTruthy();
  });

  it('should shorten long canvas navigation URLs in the collapsed summary', () => {
    const longUrl =
      'https://www.example.com/projects/kavi/canvases/focused/view/index.html?mode=preview&panel=debug';
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'canvas_navigate',
        arguments: JSON.stringify({ url: longUrl }),
      }),
    );

    expect(summary).toMatch(
      /^Loading example\.com\/projects\/kavi\/canvases\/focused\/view\/.+\.\.\.$/,
    );
  });

  it('should render status text', () => {
    const { getByText } = render(
      <ToolCallDisplay toolCall={makeToolCall({ status: 'completed' })} />,
    );
    expect(getByText('Done')).toBeTruthy();
  });

  it('should show check icon for completed status', () => {
    const { getByTestId } = render(
      <ToolCallDisplay toolCall={makeToolCall({ status: 'completed' })} />,
    );
    expect(getByTestId('icon-Check')).toBeTruthy();
  });

  it('should show X icon for failed status', () => {
    const { getByTestId } = render(
      <ToolCallDisplay toolCall={makeToolCall({ status: 'failed' })} />,
    );
    expect(getByTestId('icon-X')).toBeTruthy();
  });

  it('should show a spinner for running status', () => {
    const { getByTestId } = render(
      <ToolCallDisplay toolCall={makeToolCall({ status: 'running' })} />,
    );
    expect(getByTestId('tool-call-running-indicator')).toBeTruthy();
  });

  it('should show a waiting banner with elapsed time for wait tools', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));

    const { getByTestId, getByText, getAllByText } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          name: 'wait',
          arguments: '{"ms":12000,"reason":"polling remote job"}',
          status: 'running',
          startedAt: Date.now() - 5000,
        })}
      />,
    );

    expect(getByTestId('tool-call-waiting-banner')).toBeTruthy();
    expect(getByText(/0:05 elapsed/i)).toBeTruthy();
    expect(getByText(/polling remote job/i)).toBeTruthy();
    expect(getAllByText('Waiting 12s').length).toBeGreaterThan(0);
  });

  it('should advance elapsed time for running tools even when updatedAt is set at start', () => {
    jest.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z').getTime();
    jest.setSystemTime(startedAt);

    const { getByText } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({
          status: 'running',
          startedAt,
          updatedAt: startedAt,
        })}
      />,
    );

    expect(getByText(/0:00 elapsed/i)).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(3000);
      jest.setSystemTime(startedAt + 3000);
    });

    expect(getByText(/0:03 elapsed/i)).toBeTruthy();
  });

  it('should show Wrench icon for pending status', () => {
    const { getByTestId } = render(
      <ToolCallDisplay toolCall={makeToolCall({ status: 'pending' })} />,
    );
    expect(getByTestId('icon-Wrench')).toBeTruthy();
  });

  it('should not show arguments by default (collapsed)', () => {
    const { queryByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    expect(queryByText('Arguments:')).toBeNull();
  });

  it('should show arguments when expanded', () => {
    const { getByText, getByTestId, queryByText } = render(
      <ToolCallDisplay toolCall={makeToolCall()} />,
    );
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(getByText('Technical details')).toBeTruthy();
    expect(queryByText('Inputs')).toBeNull();
    fireEvent.press(getByTestId('tool-call-technical-disclosure-tc1'));
    expect(getByText('Inputs')).toBeTruthy();
  });

  it('should show formatted JSON arguments', () => {
    const tc = makeToolCall({ arguments: '{"path":"test.txt","encoding":"utf8"}' });
    const { getByTestId, getAllByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    fireEvent.press(getByTestId('tool-call-technical-disclosure-tc1'));
    // Should contain pretty-printed JSON
    expect(getAllByText(/test\.txt/).length).toBeGreaterThan(0);
  });

  it('should show result when expanded', () => {
    const tc = makeToolCall({ result: 'file content here' });
    const { getByText, getByTestId } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(getByText('Result')).toBeTruthy();
    expect(getByText('file content here')).toBeTruthy();
  });

  it('should explain a failed action before showing its technical error', () => {
    const tc = makeToolCall({ status: 'failed', error: 'Permission denied' });
    const { getByText, getByTestId, queryByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(getByText('Access is needed')).toBeTruthy();
    expect(queryByText('Permission denied')).toBeNull();
    fireEvent.press(getByTestId('tool-call-technical-disclosure-tc1'));
    expect(getByText('Error details')).toBeTruthy();
    expect(getByText('Permission denied')).toBeTruthy();
  });

  it('should handle invalid JSON arguments gracefully', () => {
    const tc = makeToolCall({ arguments: 'not valid json' });
    const { getByText, getByTestId } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    fireEvent.press(getByTestId('tool-call-technical-disclosure-tc1'));
    expect(getByText('not valid json')).toBeTruthy();
  });

  it('should toggle expansion', () => {
    const { getByTestId, queryByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    expect(getByTestId('tool-call-disclosure-tc1').props.accessibilityState).toEqual({
      expanded: false,
    });
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(queryByText('Technical details')).toBeTruthy();
    expect(getByTestId('tool-call-disclosure-tc1').props.accessibilityState).toEqual({
      expanded: true,
    });
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(queryByText('Technical details')).toBeNull();
  });

  it('exposes technical disclosure state on a 48-point target', () => {
    const { getByTestId } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));

    const disclosure = getByTestId('tool-call-technical-disclosure-tc1');
    expect(StyleSheet.flatten(disclosure.props.style)).toEqual(
      expect.objectContaining({ minHeight: 48 }),
    );
    expect(disclosure.props.accessibilityState).toEqual({ expanded: false });
    fireEvent.press(disclosure);
    expect(getByTestId('tool-call-technical-disclosure-tc1').props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  it('should render interactive polls from poll_create results', () => {
    const tc = makeToolCall({
      name: 'poll_create',
      result: JSON.stringify({
        status: 'created',
        poll: {
          question: 'Choose one',
          options: [
            { id: 'a', label: 'Option A', votes: 0 },
            { id: 'b', label: 'Option B', votes: 0 },
          ],
        },
      }),
    });
    const { getByText, getAllByText } = render(<ToolCallDisplay toolCall={tc} />);
    expect(getByText('Choose one')).toBeTruthy();
    fireEvent.press(getByText('Option A'));
    expect(getByText('1')).toBeTruthy();
    fireEvent.press(getByText('Option A'));
    expect(getAllByText('0')).toHaveLength(2);
  });

  it('should allow multiple poll options when configured', () => {
    const tc = makeToolCall({
      name: 'poll_create',
      result: JSON.stringify({
        poll: {
          question: 'Choose any',
          allowMultiple: true,
          options: [
            { id: 'a', label: 'Option A', votes: 0 },
            { id: 'b', label: 'Option B', votes: 0 },
          ],
        },
      }),
    });
    const { getByText, getAllByText } = render(<ToolCallDisplay toolCall={tc} />);

    fireEvent.press(getByText('Option A'));
    fireEvent.press(getByText('Option B'));
    expect(getAllByText('1')).toHaveLength(2);

    fireEvent.press(getByText('Option A'));
    expect(getAllByText('1')).toHaveLength(1);
  });

  it('keeps file viewing separate from disclosure on a 48-point action target', () => {
    const onViewFile = jest.fn();
    const { getByTestId, queryByText } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({ name: 'write_file', arguments: '{"path":"src/app.ts"}' })}
        onViewFile={onViewFile}
      />,
    );

    const viewAction = getByTestId('tool-call-view-file-tc1');
    expect(StyleSheet.flatten(viewAction.props.style)).toEqual(
      expect.objectContaining({ minHeight: 48, minWidth: 64 }),
    );
    fireEvent.press(viewAction);
    expect(onViewFile).toHaveBeenCalledWith('src/app.ts');
    expect(queryByText('Technical details')).toBeNull();

    fireEvent.press(getByTestId('tool-call-disclosure-tc1'));
    expect(queryByText('Technical details')).toBeTruthy();
    expect(onViewFile).toHaveBeenCalledTimes(1);
  });

  it.each(['canvas_create', 'canvas_update', 'canvas_navigate', 'canvas_snapshot'])(
    'opens completed %s results in Canvas on a separate 48-point action',
    (name) => {
      const onViewCanvas = jest.fn();
      const { getByTestId, queryByText } = render(
        <ToolCallDisplay
          toolCall={makeToolCall({ name, arguments: '{"id":"surface-1"}' })}
          onViewCanvas={onViewCanvas}
        />,
      );

      const viewAction = getByTestId('tool-call-view-canvas-tc1');
      expect(viewAction.props.accessibilityLabel).toBe('View canvas');
      expect(StyleSheet.flatten(viewAction.props.style)).toEqual(
        expect.objectContaining({ minHeight: 48, minWidth: 64 }),
      );

      fireEvent.press(viewAction);
      expect(onViewCanvas).toHaveBeenCalledTimes(1);
      expect(queryByText('Technical details')).toBeNull();
    },
  );

  it('does not offer Canvas for unfinished or non-viewable canvas actions', () => {
    const { queryByTestId, rerender } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({ name: 'canvas_create', status: 'running' })}
        onViewCanvas={jest.fn()}
      />,
    );
    expect(queryByTestId('tool-call-view-canvas-tc1')).toBeNull();

    rerender(
      <ToolCallDisplay
        toolCall={makeToolCall({ name: 'canvas_delete', status: 'completed' })}
        onViewCanvas={jest.fn()}
      />,
    );
    expect(queryByTestId('tool-call-view-canvas-tc1')).toBeNull();
  });

  it('should show elapsed duration for completed tools with significant runtime', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const tc = makeToolCall({
      status: 'completed',
      startedAt: now - 5200,
      completedAt: now,
    });
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    expect(getByText(/Done.*5s/i)).toBeTruthy();
  });

  it('should not show elapsed for completed tools with sub-500ms runtime', () => {
    jest.useFakeTimers();
    const now = Date.now();
    jest.setSystemTime(now);

    const tc = makeToolCall({
      status: 'completed',
      startedAt: now - 200,
      completedAt: now,
    });
    const { getByText, queryByText } = render(<ToolCallDisplay toolCall={tc} />);
    expect(getByText('Done')).toBeTruthy();
    expect(queryByText(/\d+s/)).toBeNull();
  });
});
