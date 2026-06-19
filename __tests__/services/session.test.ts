// ---------------------------------------------------------------------------
// Tests — Session Manager
// ---------------------------------------------------------------------------

import {
  resetIdleTimer,
  clearIdleTimer,
  exportConversationAsMarkdown,
} from '../../src/services/session/manager';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

const makeMsg = (role: 'user' | 'assistant', content: string, ts = Date.now()): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: ts,
  attachments: [],
});

const makeConv = (
  title: string,
  messages: Message[] = [],
  overrides: Partial<Conversation> = {},
): Conversation => ({
  id: `conv-${Math.random()}`,
  title,
  messages,
  createdAt: Date.now() - 100000,
  updatedAt: Date.now(),
  model: 'gpt-5.4',
  providerId: 'p1',
  ...overrides,
});

describe('idle timer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    clearIdleTimer();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls onIdle after timeout', () => {
    const onIdle = jest.fn();
    resetIdleTimer(onIdle, 5000);
    jest.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', () => {
    const onIdle = jest.fn();
    resetIdleTimer(onIdle, 5000);
    jest.advanceTimersByTime(3000);
    resetIdleTimer(onIdle, 5000);
    jest.advanceTimersByTime(3000);
    expect(onIdle).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('clearIdleTimer prevents callback', () => {
    const onIdle = jest.fn();
    resetIdleTimer(onIdle, 5000);
    clearIdleTimer();
    jest.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('unrefs the idle timer when supported', () => {
    const unref = jest.fn();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as any);

    resetIdleTimer(jest.fn(), 5000);

    expect(unref).toHaveBeenCalledTimes(1);

    clearIdleTimer();
    setTimeoutSpy.mockRestore();
  });
});

describe('exportConversationAsMarkdown', () => {
  it('includes title', () => {
    const conv = makeConv('Test Chat');
    const md = exportConversationAsMarkdown(conv);
    expect(md).toContain('# Test Chat');
  });

  it('includes messages with role headers', () => {
    const conv = makeConv('Chat', [makeMsg('user', 'Hello'), makeMsg('assistant', 'Hi there')]);
    const md = exportConversationAsMarkdown(conv);
    expect(md).toContain('## User');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hello');
    expect(md).toContain('Hi there');
  });

  it('includes tool call info', () => {
    const msg = makeMsg('assistant', 'Working...');
    msg.toolCalls = [
      {
        id: 'tc1',
        name: 'read_file',
        arguments: '{}',
        status: 'completed',
        result: 'file content here',
      },
    ];
    const conv = makeConv('TC Chat', [msg]);
    const md = exportConversationAsMarkdown(conv);
    expect(md).toContain('Tool Calls');
    expect(md).toContain('read_file');
  });

  it('handles tool calls without result', () => {
    const msg = makeMsg('assistant', 'Working...');
    msg.toolCalls = [{ id: 'tc1', name: 'run_cmd', arguments: '{}', status: 'running' }];
    const conv = makeConv('TC Chat', [msg]);
    const md = exportConversationAsMarkdown(conv);
    expect(md).toContain('run_cmd');
    expect(md).not.toContain('Result:');
  });

  it('handles messages without tool calls', () => {
    const conv = makeConv('Simple', [makeMsg('user', 'Hello')]);
    const md = exportConversationAsMarkdown(conv);
    expect(md).not.toContain('Tool Calls');
  });
});
