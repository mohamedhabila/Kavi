// ---------------------------------------------------------------------------
// Tests — ToolCallDisplay presentation helpers
// ---------------------------------------------------------------------------
//
// Split out of ToolCallDisplay.test.tsx to stay under the maintainability line
// limit. Component-rendering coverage lives there; session-tool summarizeToolCall
// coverage lives in ToolCallDisplay.sessionSummaries.test.ts. All three share
// fixtures from __tests__/helpers/toolCallDisplayFixtures.ts.

import { summarizeToolCall } from '../../src/components/chat/ToolCallDisplay';
import { parseToolCallPoll } from '../../src/components/chat/ToolCallPoll';
import {
  formatCompactDuration,
  formatHumanDuration,
  getElapsedMs,
  getWaitingPresentation,
  humanizeToolName,
  pickWaitingPhrase,
} from '../../src/components/chat/toolCallPresentation';
import { i18n } from '../../src/i18n/manager';
import { makeToolCall } from '../helpers/toolCallDisplayFixtures';

const t = i18n.t.bind(i18n);

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
      getElapsedMs(makeToolCall({ status: 'completed', startedAt: 3000, completedAt: 8000 }), now),
    ).toBe(5000);
  });

  it('rotates waiting phrases by elapsed time', () => {
    expect(pickWaitingPhrase(null, t)).toBe('Monitoring progress');
    expect(pickWaitingPhrase(10000, t)).toBe('Waiting for the next update');
    expect(pickWaitingPhrase(30000, t)).toBe('Checking again soon');
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
        t,
      ),
    ).toEqual({ title: 'Waiting for "Loaded"' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'browser_wait',
          arguments: '{"selector":"#ready"}',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting for #ready' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'browser_wait',
          arguments: '{"timeMs":"60000"}',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting 1m' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'expo_eas_workflow_wait',
          arguments: '{"workflowRunId":"run-123"}',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting on workflow run-123' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'sessions_wait',
          arguments: '{"sessionId":"sub-1234567890","waitTimeoutMs":5000}',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting on agent sub-12345678...', detail: 'Up to 5s' });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'sessions_wait',
          arguments: '{"sessionIds":["sub-one","sub-two"]}',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting on 2 agents', detail: undefined });
    expect(
      getWaitingPresentation(
        makeToolCall({
          name: 'custom_wait',
          arguments: 'not json',
          status: 'running',
        }),
        t,
      ),
    ).toEqual({ title: 'Waiting on Custom Wait' });
  });

  it('returns null for non-waiting tool presentations and malformed summaries', () => {
    expect(getWaitingPresentation(makeToolCall({ name: 'read_file' }), t)).toBeNull();
    expect(summarizeToolCall(makeToolCall({ arguments: 'not json' }))).toBeNull();
  });

  it('renders a localized (non-English) waiting header once the locale is switched to Arabic', async () => {
    await i18n.setLocale('ar');
    try {
      const presentation = getWaitingPresentation(
        makeToolCall({
          name: 'sessions_wait',
          arguments: '{"sessionId":"sub-1234567890","waitTimeoutMs":5000}',
          status: 'running',
        }),
        t,
      );
      expect(presentation?.title).not.toBe('Waiting on agent sub-12345678...');
      expect(presentation?.title).not.toMatch(/Waiting on agent/);
      expect(presentation?.title).toContain('في انتظار الوكيل');
      expect(pickWaitingPhrase(null, t)).not.toBe('Monitoring progress');
      expect(pickWaitingPhrase(null, t)).toBe('مراقبة التقدم');
    } finally {
      await i18n.setLocale('en');
    }
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
    [
      'web_fetch',
      { url: 'not a url that is intentionally long for display shortening' },
      /^Fetching .+\.\.\.$/,
    ],
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
