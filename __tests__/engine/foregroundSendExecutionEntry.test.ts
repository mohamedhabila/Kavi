// ---------------------------------------------------------------------------
// Kavi — Foreground send entry point contract
// ---------------------------------------------------------------------------
// The chat screen and the acceptance harness must submit turns through the same
// composer path. These tests pin the ordering guarantees that path provides so a
// harness cannot drift back into hand-rolled turn submission.
// ---------------------------------------------------------------------------

import { executeForegroundConversationSend } from '../../src/engine/graph/foregroundRun/sendExecution';
import type { ForegroundConversationSendContext } from '../../src/engine/graph/foregroundRun/sendExecution';

jest.mock('../../src/store/modelProjectionIntentCoordinator', () => ({
  beginModelProjectionIntent: jest.fn(() => ({ release: jest.fn() })),
}));

jest.mock('../../src/services/conversationWorkspace/attachments', () => ({
  importConversationWorkspaceAttachment: jest.fn(async (_conversationId, attachment) => ({
    attachment: { ...attachment, imported: true },
  })),
}));

function createContext(
  overrides: Partial<ForegroundConversationSendContext> = {},
): { context: ForegroundConversationSendContext; calls: string[] } {
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
    // Matches the chat screen exactly: no options means a single-argument call.
    expect(context.runChat).toHaveBeenCalledWith('active-conversation');
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
    expect(context.runChat).toHaveBeenCalledWith('created-conversation');
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

    await expect(
      executeForegroundConversationSend({ context, text: 'hello' }),
    ).rejects.toThrow('run failed');
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
