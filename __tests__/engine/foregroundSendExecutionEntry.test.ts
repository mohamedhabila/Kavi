// ---------------------------------------------------------------------------
// Kavi — Foreground send entry point contract
// ---------------------------------------------------------------------------
// The chat screen and the acceptance harness must submit turns through the same
// composer path. These tests pin the ordering guarantees that path provides so a
// harness cannot drift back into hand-rolled turn submission.
// ---------------------------------------------------------------------------

import { executeForegroundConversationSend } from '../../src/engine/graph/foregroundRun/sendExecution';
import type { ForegroundConversationSendContext } from '../../src/engine/graph/foregroundRun/sendExecution';
import type { RunChatOptions } from '../../src/engine/graph/foregroundRun/contracts';
import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import {
  createSteeringQueue,
  MAX_QUEUED_STEERING_MESSAGES,
} from '../../src/engine/graph/foregroundRun/steeringQueue';

jest.mock('../../src/store/modelProjectionIntentCoordinator', () => ({
  beginModelProjectionIntent: jest.fn(() => ({ release: jest.fn() })),
}));

jest.mock('../../src/services/conversationWorkspace/attachments', () => ({
  importConversationWorkspaceAttachment: jest.fn(async (_conversationId, attachment) => ({
    attachment: { ...attachment, imported: true },
  })),
}));

function createContext(overrides: Partial<ForegroundConversationSendContext> = {}): {
  context: ForegroundConversationSendContext;
  calls: string[];
} {
  const calls: string[] = [];
  const context: ForegroundConversationSendContext = {
    addMessage: jest.fn(() => {
      calls.push('addMessage');
    }),
    attachmentWorkspaceImportFailedMessage: 'attachment import failed',
    clearComposerDraft: jest.fn(() => {
      calls.push('clearComposerDraft');
    }),
    defaultConversationMode: 'chat',
    ensureCanonicalConversation: jest.fn(() => {
      calls.push('ensureCanonicalConversation');
      return 'created-conversation';
    }),
    generateId: () => 'generated-message-id',
    getLiveActiveConversationId: () => 'active-conversation',
    isAgenticMode: false,
    markNextScrollForced: jest.fn(() => {
      calls.push('markNextScrollForced');
    }),
    releaseConversationWrite: jest.fn(() => {
      calls.push('releaseConversationWrite');
    }),
    reserveConversationWrite: jest.fn(() => {
      calls.push('reserveConversationWrite');
      return true;
    }),
    runChat: jest.fn(async () => {
      calls.push('runChat');
    }),
    setChatError: jest.fn(),
    steering: { queue: createSteeringQueue(), registry: createForegroundRequestRegistry() },
    steeringQueueFullMessage: 'queue full',
    waitForConversationWriteAvailability: jest.fn(async () => {
      calls.push('waitForConversationWriteAvailability');
      return true;
    }),
    ...overrides,
  };
  return { context, calls };
}

describe('executeForegroundConversationSend', () => {
  it('appends the user message only after the conversation write is gated', async () => {
    const { context, calls } = createContext();

    await executeForegroundConversationSend({ context, text: 'hello' });

    expect(calls).toEqual([
      'reserveConversationWrite',
      'waitForConversationWriteAvailability',
      'markNextScrollForced',
      'addMessage',
      'clearComposerDraft',
      'runChat',
      'releaseConversationWrite',
      'releaseConversationWrite',
    ]);
  });

  it('reuses the live active conversation instead of creating one', async () => {
    const { context } = createContext();

    await executeForegroundConversationSend({ context, text: 'hello' });

    expect(context.ensureCanonicalConversation).not.toHaveBeenCalled();
    // Without caller options the only run option is the send's latency timeline.
    expect(context.runChat).toHaveBeenCalledWith('active-conversation', {
      latencyTimeline: expect.objectContaining({ mark: expect.any(Function) }),
    });
  });

  it('hands the run a latency timeline that already marked the user message', async () => {
    const { context } = createContext();

    await executeForegroundConversationSend({ context, text: 'hello' });

    const runOptions = (context.runChat as jest.Mock).mock.calls[0][1] as RunChatOptions;
    const timeline = runOptions.latencyTimeline!;
    expect(timeline.mark('user_message_added')).toBeUndefined();
    expect(timeline.mark('recovery_ready')).toEqual({
      user_message_added: expect.any(Number),
      recovery_ready: expect.any(Number),
    });
  });

  it('creates a canonical conversation when none is active, using the agentic persona', async () => {
    const { context } = createContext({
      getLiveActiveConversationId: () => null,
      isAgenticMode: true,
      defaultConversationMode: 'agentic',
    });

    await executeForegroundConversationSend({ context, text: 'hello' });

    expect(context.ensureCanonicalConversation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'agentic', reportMissingProvider: true }),
    );
    expect(context.runChat).toHaveBeenCalledWith('created-conversation', {
      latencyTimeline: expect.objectContaining({ mark: expect.any(Function) }),
    });
  });

  it('does not send when the conversation write cannot be reserved', async () => {
    const { context } = createContext({ reserveConversationWrite: jest.fn(() => false) });

    await executeForegroundConversationSend({ context, text: 'hello' });

    expect(context.addMessage).not.toHaveBeenCalled();
    expect(context.runChat).not.toHaveBeenCalled();
  });

  it('abandons the turn and releases the write when gating is superseded', async () => {
    const { context } = createContext({
      waitForConversationWriteAvailability: jest.fn(async () => false),
    });

    await executeForegroundConversationSend({ context, text: 'hello' });

    expect(context.addMessage).not.toHaveBeenCalled();
    expect(context.runChat).not.toHaveBeenCalled();
    expect(context.releaseConversationWrite).toHaveBeenCalledWith('active-conversation');
  });

  it('imports attachments into the conversation workspace before appending', async () => {
    const { context } = createContext();

    await executeForegroundConversationSend({
      attachments: [{ id: 'a1', name: 'note.txt' } as never],
      context,
      text: 'with attachment',
    });

    expect(context.addMessage).toHaveBeenCalledWith(
      'active-conversation',
      expect.objectContaining({
        attachments: [expect.objectContaining({ imported: true })],
        content: 'with attachment',
        role: 'user',
      }),
    );
  });

  it('surfaces the attachment failure message and does not run the turn', async () => {
    const attachments = require('../../src/services/conversationWorkspace/attachments');
    attachments.importConversationWorkspaceAttachment.mockRejectedValueOnce(
      new Error('workspace offline'),
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { context } = createContext();

    await executeForegroundConversationSend({
      attachments: [{ id: 'a1', name: 'note.txt' } as never],
      context,
      text: 'with attachment',
    });

    expect(context.setChatError).toHaveBeenCalledWith('attachment import failed');
    expect(context.runChat).not.toHaveBeenCalled();
    expect(context.releaseConversationWrite).toHaveBeenCalledWith('active-conversation');
    warn.mockRestore();
  });

  it('releases the conversation write even when the run throws', async () => {
    const { context } = createContext({
      runChat: jest.fn(async () => {
        throw new Error('run failed');
      }),
    });

    await expect(executeForegroundConversationSend({ context, text: 'hello' })).rejects.toThrow(
      'run failed',
    );
    expect(context.releaseConversationWrite).toHaveBeenCalledWith('active-conversation');
  });

  it('forwards run options to the turn execution', async () => {
    const { context } = createContext();

    await executeForegroundConversationSend({
      context,
      runOptions: { maxTokens: 1234 },
      text: 'hello',
    });

    expect(context.runChat).toHaveBeenCalledWith(
      'active-conversation',
      expect.objectContaining({ maxTokens: 1234 }),
    );
  });
});

describe('sending while a run works (steering)', () => {
  function steeringSetup() {
    const queue = createSteeringQueue();
    const registry = createForegroundRequestRegistry();
    const { context, calls } = createContext({ steering: { queue, registry } });
    let sequence = 0;
    context.generateId = () => `message-${++sequence}`;
    const startRun = (requestId: string) => {
      const handle = {
        conversationId: 'active-conversation',
        requestId,
        controller: new AbortController(),
      };
      registry.register(handle);
      return { end: () => registry.clear(handle) };
    };
    return { calls, context, queue, startRun };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('queues the message for the running run instead of starting a turn', async () => {
    const { calls, context, queue, startRun } = steeringSetup();
    const run = startRun('run-1');

    const sending = executeForegroundConversationSend({ context, text: 'Make it vegetarian.' });
    await flush();

    expect(queue.get('active-conversation')).toEqual([
      expect.objectContaining({ targetRunId: 'run-1', text: 'Make it vegetarian.' }),
    ]);
    expect(calls).toEqual(['clearComposerDraft']);
    queue.take('active-conversation', 'run-1');
    run.end();
    await sending;

    expect(context.runChat).not.toHaveBeenCalled();
    expect(context.addMessage).not.toHaveBeenCalled();
  });

  it('sends what the run never took as one next turn, once', async () => {
    const { context, startRun } = steeringSetup();
    const run = startRun('run-1');

    const first = executeForegroundConversationSend({ context, text: 'Make it vegetarian.' });
    const second = executeForegroundConversationSend({ context, text: 'And under 30 euros.' });
    await flush();
    run.end();
    await Promise.all([first, second]);

    expect(context.runChat).toHaveBeenCalledTimes(1);
    expect(context.addMessage).toHaveBeenCalledTimes(1);
    expect(context.addMessage).toHaveBeenCalledWith(
      'active-conversation',
      expect.objectContaining({
        role: 'user',
        content: 'Make it vegetarian.\n\nAnd under 30 euros.',
      }),
    );
  });

  it('follows a run that continues the work, and sends only once none is left', async () => {
    const { context, queue, startRun } = steeringSetup();
    startRun('run-1');

    const sending = executeForegroundConversationSend({ context, text: 'Use metric units.' });
    await flush();
    const continuation = startRun('run-2');
    await flush();

    expect(queue.get('active-conversation')).toEqual([
      expect.objectContaining({ targetRunId: 'run-2' }),
    ]);
    expect(context.runChat).not.toHaveBeenCalled();
    continuation.end();
    await sending;

    expect(context.runChat).toHaveBeenCalledTimes(1);
  });

  it('keeps attachments and commands as turns of their own', async () => {
    const { context, queue, startRun } = steeringSetup();
    startRun('run-1');

    await executeForegroundConversationSend({
      context,
      text: 'Look at this',
      attachments: [{ id: 'a', type: 'image', uri: 'file:///a.jpg', name: 'a.jpg' } as never],
    });
    await executeForegroundConversationSend({ context, text: '/new' });

    expect(queue.get('active-conversation')).toEqual([]);
    expect(context.runChat).toHaveBeenCalledTimes(2);
  });

  it('refuses a message past the queue bound and leaves it in the composer', async () => {
    const { context, queue, startRun } = steeringSetup();
    startRun('run-1');
    for (let index = 0; index < MAX_QUEUED_STEERING_MESSAGES; index += 1) {
      queue.enqueue({
        id: `queued-${index}`,
        conversationId: 'active-conversation',
        targetRunId: 'run-1',
        text: `queued ${index}`,
        enqueuedAt: 1,
      });
    }

    await executeForegroundConversationSend({ context, text: 'One more thing.' });

    expect(context.setChatError).toHaveBeenLastCalledWith('queue full');
    expect(context.clearComposerDraft).not.toHaveBeenCalled();
    expect(context.runChat).not.toHaveBeenCalled();
  });
});
