// ---------------------------------------------------------------------------
// Tests — ToolCallDisplay Component
// ---------------------------------------------------------------------------

import { act, render, fireEvent } from '@testing-library/react-native';
import { summarizeToolCall, ToolCallDisplay } from '../../src/components/chat/ToolCallDisplay';
import { ToolCall } from '../../src/types/message';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      border: '#333',
      danger: '#f00',
      success: '#0f0',
      toolCard: '#111',
      toolCardHeader: '#222',
      codeBackground: '#000',
    },
  }),
  AppPalette: {},
}));

const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: 'tc1',
  name: 'read_file',
  arguments: '{"path":"test.txt"}',
  status: 'completed',
  ...overrides,
});

describe('ToolCallDisplay', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render tool name', () => {
    const { getByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    expect(getByText('Read File')).toBeTruthy();
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
    expect(getByText('completed')).toBeTruthy();
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
    const { getByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    fireEvent.press(getByText('Read File'));
    expect(getByText('Arguments:')).toBeTruthy();
  });

  it('should show formatted JSON arguments', () => {
    const tc = makeToolCall({ arguments: '{"path":"test.txt","encoding":"utf8"}' });
    const { getByText, getAllByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByText('Read File'));
    // Should contain pretty-printed JSON
    expect(getAllByText(/test\.txt/).length).toBeGreaterThan(0);
  });

  it('should show result when expanded', () => {
    const tc = makeToolCall({ result: 'file content here' });
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByText('Read File'));
    expect(getByText('Result:')).toBeTruthy();
    expect(getByText('file content here')).toBeTruthy();
  });

  it('should show error when expanded and failed', () => {
    const tc = makeToolCall({ status: 'failed', error: 'Permission denied' });
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByText('Read File'));
    expect(getByText('Error:')).toBeTruthy();
    expect(getByText('Permission denied')).toBeTruthy();
  });

  it('should handle invalid JSON arguments gracefully', () => {
    const tc = makeToolCall({ arguments: 'not valid json' });
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    fireEvent.press(getByText('Read File'));
    expect(getByText('not valid json')).toBeTruthy();
  });

  it('should toggle expansion', () => {
    const { getByText, queryByText } = render(<ToolCallDisplay toolCall={makeToolCall()} />);
    fireEvent.press(getByText('Read File'));
    expect(queryByText('Arguments:')).toBeTruthy();
    fireEvent.press(getByText('Read File'));
    expect(queryByText('Arguments:')).toBeNull();
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
    const { getByText } = render(<ToolCallDisplay toolCall={tc} />);
    expect(getByText('Choose one')).toBeTruthy();
    fireEvent.press(getByText('Option A'));
    expect(getByText('1')).toBeTruthy();
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
    // "completed · 5s" format
    expect(getByText(/completed.*5s/i)).toBeTruthy();
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
    // Should show "completed" without duration suffix
    expect(getByText('completed')).toBeTruthy();
    expect(queryByText(/\d+s/)).toBeNull();
  });
});

// ── Session tool summaries ────────────────────────────────────────────

describe('summarizeToolCall — session tools', () => {
  it('summarizes sessions_spawn with agent name', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Implement the backend', name: 'Backend Architect' }),
      }),
    );
    expect(summary).toBe('🧠 Spawning agent: Backend Architect');
  });

  it('summarizes sessions_spawn without name', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Do some work' }),
      }),
    );
    expect(summary).toBe('🧠 Spawning sub-agent');
  });

  it('summarizes blocking sessions_spawn', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_spawn',
        arguments: JSON.stringify({ prompt: 'Do work', name: 'Worker', waitForCompletion: true }),
      }),
    );
    expect(summary).toBe('🧠 Spawning agent: Worker (blocking)');
  });

  it('summarizes sessions_status with truncated session ID', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_status',
        arguments: JSON.stringify({ sessionId: 'sub-1234567890-abcdef' }),
      }),
    );
    expect(summary).toBe('Checking agent sub-12345678…');
  });

  it('summarizes sessions_list', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_list',
        arguments: '{}',
      }),
    );
    expect(summary).toBe('Listing active agents');
  });

  it('summarizes sessions_send', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_send',
        arguments: JSON.stringify({ sessionId: 'sub-001-xyz', message: 'Iterate on the design' }),
      }),
    );
    expect(summary).toBe('Messaging agent sub-001-xyz…');
  });

  it('summarizes blocking sessions_send', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_send',
        arguments: JSON.stringify({
          sessionId: 'sub-001-xyz',
          message: 'Iterate on the design',
          waitForCompletion: true,
        }),
      }),
    );
    expect(summary).toBe('Messaging agent sub-001-xyz… (blocking)');
  });

  it('summarizes sessions_history', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_history',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Reading agent sub-999-abc… history');
  });

  it('summarizes sessions_output', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_output',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Reading final output from agent sub-999-abc…');
  });

  it('summarizes sessions_wait', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_wait',
        arguments: JSON.stringify({ sessionId: 'sub-999-abcdef', waitTimeoutMs: 5000 }),
      }),
    );
    expect(summary).toBe('Waiting on agent sub-999-abcd…');
  });

  it('summarizes sessions_cancel', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_cancel',
        arguments: JSON.stringify({ sessionId: 'sub-999-abc' }),
      }),
    );
    expect(summary).toBe('Stopping agent sub-999-abc…');
  });

  it('summarizes sessions_yield', () => {
    const summary = summarizeToolCall(
      makeToolCall({
        name: 'sessions_yield',
        arguments: '{}',
      }),
    );
    expect(summary).toBe('⏸ Recording agent checkpoint');
  });
});
