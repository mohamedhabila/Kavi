// ---------------------------------------------------------------------------
// Tests — ToolCallDisplay Component
// ---------------------------------------------------------------------------

import { act, render, fireEvent } from '@testing-library/react-native';
import { summarizeToolCall, ToolCallDisplay } from '../../src/components/chat/ToolCallDisplay';
import { parseToolCallPoll } from '../../src/components/chat/ToolCallPoll';
import {
  formatCompactDuration,
  formatHumanDuration,
  getElapsedMs,
  getWaitingPresentation,
  humanizeToolName,
  pickWaitingPhrase,
} from '../../src/components/chat/toolCallPresentation';
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
      primary: '#08f',
      primarySoft: '#024',
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

  it('should invoke the file viewer action for completed file tools', () => {
    const onViewFile = jest.fn();
    const { getByText } = render(
      <ToolCallDisplay
        toolCall={makeToolCall({ name: 'write_file', arguments: '{"path":"src/app.ts"}' })}
        onViewFile={onViewFile}
      />,
    );

    fireEvent.press(getByText('View'));
    expect(onViewFile).toHaveBeenCalledWith('src/app.ts');
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

describe('tool call presentation helpers', () => {
  it('formats compact and human durations', () => {
    expect(formatCompactDuration(65000)).toBe('1:05');
    expect(formatHumanDuration(1200)).toBe('1s');
    expect(formatHumanDuration(60000)).toBe('1m');
    expect(formatHumanDuration(65000)).toBe('1m 5s');
  });

  it('computes elapsed time from active and completed tool call timestamps', () => {
    const now = 10000;

    expect(getElapsedMs(makeToolCall({ startedAt: undefined, updatedAt: undefined }), now)).toBe(
      null,
    );
    expect(getElapsedMs(makeToolCall({ status: 'running', startedAt: 3000 }), now)).toBe(7000);
    expect(
      getElapsedMs(
        makeToolCall({ status: 'completed', startedAt: 3000, completedAt: 8000 }),
        now,
      ),
    ).toBe(5000);
  });

  it('rotates waiting phrases by elapsed time', () => {
    expect(pickWaitingPhrase(null)).toBe('Monitoring progress');
    expect(pickWaitingPhrase(10000)).toBe('Waiting for the next update');
    expect(pickWaitingPhrase(30000)).toBe('Checking again soon');
  });

  it('humanizes tool names and honors translations', () => {
    expect(humanizeToolName('read_file')).toBe('Read File');
    expect(humanizeToolName('read_file', () => 'Open file')).toBe('Open file');
  });

  it('builds waiting presentations for browser, workflow, session, and generic wait tools', () => {
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'browser_wait',
          arguments: '{"text":"Loaded"}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting for "Loaded"' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'browser_wait',
          arguments: '{"selector":"#ready"}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting for #ready' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'browser_wait',
          arguments: '{"timeMs":"60000"}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting 1m' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'expo_eas_workflow_wait',
          arguments: '{"workflowRunId":"run-123"}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting on workflow run-123' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'sessions_wait',
          arguments: '{"sessionId":"sub-1234567890","waitTimeoutMs":5000}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting on agent sub-12345678...', detail: 'Up to 5s' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'sessions_wait',
          arguments: '{"sessionIds":["sub-one","sub-two"]}',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting on 2 agents', detail: undefined });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'custom_wait',
          arguments: 'not json',
          status: 'running',
        }),
      ),
    ).toEqual({ title: 'Waiting on Custom Wait' });
  });

  it('returns null for non-waiting tool presentations and malformed summaries', () => {
    expect(getWaitingPresentation(makeToolCall({ name: 'read_file' }))).toBeNull();
    expect(summarizeToolCall(makeToolCall({ arguments: 'not json' }))).toBeNull();
  });

  it.each([
    ['file_edit', { path: 'src/app.ts' }, 'Editing src/app.ts'],
    ['file_edit', {}, 'Editing a file'],
    ['read_file', {}, 'Reading a file'],
    ['canvas_create', { title: 'Plan' }, 'Creating canvas Plan'],
    ['canvas_create', {}, 'Creating a canvas'],
    ['canvas_update', { surfaceId: 'surface-1' }, 'Updating surface-1'],
    ['canvas_update', {}, 'Updating a canvas'],
    ['canvas_read', { surfaceId: 'surface-2' }, 'Reading surface-2'],
    ['canvas_read', {}, 'Reading a canvas'],
    ['canvas_snapshot', { surfaceId: 'surface-3' }, 'Capturing surface-3'],
    ['canvas_snapshot', {}, 'Capturing a canvas snapshot'],
    ['web_fetch', { url: 'not a url that is intentionally long for display shortening' }, /^Fetching .+\.\.\.$/],
    ['web_fetch', {}, 'Fetching a page'],
    ['ssh_exec', { command: 'ls -la' }, 'Running ls -la'],
    ['ssh_exec', {}, 'Running a remote command'],
    ['ssh_read_file', { path: '/tmp/a.txt' }, 'Reading /tmp/a.txt'],
    ['ssh_read_file', {}, 'Reading a remote file'],
    ['ssh_write_file', { path: '/tmp/b.txt' }, 'Writing /tmp/b.txt'],
    ['ssh_write_file', {}, 'Writing a remote file'],
    ['ssh_list_directory', { path: '/tmp' }, 'Listing /tmp'],
    ['ssh_list_directory', {}, 'Listing a remote directory'],
    ['wait', { ms: '60000' }, 'Waiting 1m'],
    ['unknown_tool', {}, null],
  ])('summarizes %s with arguments %j', (name, args, expected) => {
    const summary = summarizeToolCall(
      makeToolCall({
        name,
        arguments: JSON.stringify(args),
      }),
    );

    if (expected instanceof RegExp) {
      expect(summary).toMatch(expected);
    } else {
      expect(summary).toBe(expected);
    }
  });

  it('uses translation callbacks for translated summaries and translated fallbacks', () => {
    const translate = (key: string, params?: Record<string, string | number>) =>
      `${key}:${params?.path ?? params?.id ?? params?.url ?? ''}`;

    expect(
      summarizeToolCall(
        makeToolCall({ name: 'write_file', arguments: '{"path":"src/main.ts"}' }),
        translate,
      ),
    ).toBe('toolCall.summaries.writeFilePath:src/main.ts');
    expect(
      summarizeToolCall(
        makeToolCall({ name: 'canvas_read', arguments: '{"surfaceId":"surface-1"}' }),
        (key) => key,
      ),
    ).toBe('Reading surface-1');
  });

  it('parses only valid poll_create results', () => {
    expect(parseToolCallPoll('read_file', '{"poll":{"question":"Q","options":[]}}')).toBeNull();
    expect(parseToolCallPoll('poll_create')).toBeNull();
    expect(parseToolCallPoll('poll_create', 'not json')).toBeNull();
    expect(parseToolCallPoll('poll_create', '{"poll":{"question":"Q","options":[]}}')).toEqual({
      question: 'Q',
      options: [],
    });
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
