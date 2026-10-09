import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import {
  resolveRunCompletionNotice,
  startRunCompletionNotifications,
} from '../../src/services/notifications/runCompletionNotifications';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { Message } from '../../src/types/message';

// A long task is only delivered if the person learns it finished. When a run ends while
// the app is in the background, they get one notice that opens the conversation.

const flush = () => new Promise((resolve) => setImmediate(resolve));

function user(id: string): Message {
  return { id, role: 'user', content: 'Plan my week', timestamp: 1 } as Message;
}

function final(
  completionStatus: 'complete' | 'incomplete',
  finishReason = 'stop',
  id = 'assistant-final',
): Message {
  return {
    id,
    role: 'assistant',
    content: 'Here is your plan.',
    timestamp: 2,
    assistantMetadata: { kind: 'final', completionStatus, finishReason },
  } as Message;
}

function intermediate(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: 2,
    assistantMetadata: {
      kind: 'intermediate',
      completionStatus: 'complete',
      finishReason: 'tool_calls',
    },
  } as Message;
}

function run(status: AgentRun['status'], graphStatus?: string): AgentRun {
  return {
    id: 'run-1',
    status,
    ...(graphStatus ? { controlGraph: { status: graphStatus } } : {}),
  } as AgentRun;
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    title: 'Weekly plan',
    messages: [user('user-1'), final('complete')],
    ...overrides,
  } as Conversation;
}

describe('resolveRunCompletionNotice', () => {
  it('announces a completed answer', () => {
    expect(resolveRunCompletionNotice(conversation())).toBe('answer_ready');
  });

  it('asks for a reply when the run ended on a clarifying question', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({
          messages: [user('user-1'), final('complete', 'request_clarification')],
          activeAgentRunId: 'run-1',
          agentRuns: [run('running', 'awaiting_user')],
        }),
      ),
    ).toBe('needs_input');
  });

  it('says the run did not finish when its final answer is incomplete', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({ messages: [user('user-1'), final('incomplete', 'max_iterations')] }),
      ),
    ).toBe('unfinished');
  });

  it('waits while the run continues with background work', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({ activeAgentRunId: 'run-1', agentRuns: [run('running', 'waiting_async')] }),
      ),
    ).toBeNull();
  });

  it('announces once the run itself has completed', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({ activeAgentRunId: 'run-1', agentRuns: [run('completed', 'finalized')] }),
      ),
    ).toBe('answer_ready');
  });

  it('says nothing for a turn that ended without a final answer, as a cancelled one does', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({ messages: [user('user-1'), intermediate('assistant-draft')] }),
      ),
    ).toBeNull();
  });

  it('never reports an earlier turn’s answer for the latest request', () => {
    expect(
      resolveRunCompletionNotice(
        conversation({ messages: [user('user-1'), final('complete'), user('user-2')] }),
      ),
    ).toBeNull();
  });

  it('reads the answer that follows a message sent during the run', () => {
    const steer = { ...user('user-steer'), steerOfRunId: 'request-1' } as Message;
    expect(
      resolveRunCompletionNotice(
        conversation({
          messages: [user('user-1'), intermediate('assistant-1'), steer, final('complete')],
        }),
      ),
    ).toBe('answer_ready');
  });
});

describe('startRunCompletionNotifications', () => {
  const translations: Record<string, string> = {
    'notifications.runAnswerReady': 'Your answer is ready',
    'notifications.runNeedsInput': 'Kavi needs your reply',
    'notifications.runUnfinished': "Kavi couldn't finish",
    'notifications.runOpenConversation': 'Tap to open the conversation',
  };

  function setup(
    options: {
      foreground?: boolean;
      canNotify?: boolean;
      conversations?: Conversation[];
      notify?: jest.Mock;
    } = {},
  ) {
    const registry = createForegroundRequestRegistry();
    const conversations = options.conversations ?? [conversation()];
    const notify = options.notify ?? jest.fn().mockResolvedValue('notification-1');
    const canNotify = jest.fn().mockResolvedValue(options.canNotify ?? true);
    const stop = startRunCompletionNotifications({
      requests: registry,
      isAppInForeground: () => options.foreground ?? false,
      getConversation: (id) => conversations.find((candidate) => candidate.id === id),
      canNotify,
      notify,
      t: (key) => translations[key] ?? key,
    });
    const handle = (conversationId: string) => ({
      conversationId,
      requestId: `request-${conversationId}`,
      controller: new AbortController(),
    });
    return { registry, notify, canNotify, stop, handle };
  }

  it('notifies when a run ends while the app is in the background', async () => {
    const { registry, notify, handle } = setup();
    const request = handle('conversation-1');
    registry.register(request);
    registry.clear(request);
    await flush();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      identifier: 'chat-run-completed:conversation-1',
      title: 'Your answer is ready',
      body: 'Weekly plan',
      data: { screen: 'Chat', conversationId: 'conversation-1', source: 'chat_run_completed' },
    });
  });

  it('stays quiet while the person is watching the conversation', async () => {
    const { registry, notify, handle } = setup({ foreground: true });
    const request = handle('conversation-1');
    registry.register(request);
    registry.clear(request);
    await flush();

    expect(notify).not.toHaveBeenCalled();
  });

  it('does not ask for permission from the background', async () => {
    const { registry, notify, canNotify, handle } = setup({ canNotify: false });
    const request = handle('conversation-1');
    registry.register(request);
    registry.clear(request);
    await flush();

    expect(canNotify).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not announce a run replaced by its own continuation', async () => {
    const { registry, notify, handle } = setup();
    registry.register(handle('conversation-1'));
    registry.register({ ...handle('conversation-1'), requestId: 'request-resumed' });
    await flush();

    expect(notify).not.toHaveBeenCalled();
  });

  it('announces only the conversation whose run ended', async () => {
    const other = conversation({ id: 'conversation-2', title: 'Trip' });
    const { registry, notify, handle } = setup({ conversations: [conversation(), other] });
    const first = handle('conversation-1');
    registry.register(first);
    registry.register(handle('conversation-2'));
    registry.clear(first);
    await flush();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].data.conversationId).toBe('conversation-1');
  });

  it('opens the conversation by name only when it has a real title', async () => {
    const { registry, notify, handle } = setup({
      conversations: [conversation({ title: '  ' })],
    });
    const request = handle('conversation-1');
    registry.register(request);
    registry.clear(request);
    await flush();

    expect(notify.mock.calls[0][0].body).toBe('Tap to open the conversation');
  });

  it('logs a notice it could not deliver without throwing into the registry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registry, handle } = setup({
      notify: jest.fn().mockRejectedValue(new Error('notifications unavailable')),
    });
    const request = handle('conversation-1');
    registry.register(request);
    expect(() => registry.clear(request)).not.toThrow();
    await flush();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stops listening once stopped', async () => {
    const { registry, notify, stop, handle } = setup();
    const request = handle('conversation-1');
    registry.register(request);
    stop();
    registry.clear(request);
    await flush();

    expect(notify).not.toHaveBeenCalled();
  });
});
