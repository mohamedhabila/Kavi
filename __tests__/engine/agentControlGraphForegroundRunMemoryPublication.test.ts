import { runOrchestrator } from '../../src/engine/orchestrator';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';
import type { PendingVerifiedProcedureObservation } from '../../src/services/memory/verifiedProcedure/executionSession';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const mockCommitPendingVerifiedProcedureObservation = jest.fn();

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/services/memory/verifiedProcedure/executionSession', () => ({
  commitPendingVerifiedProcedureObservation: (...args: unknown[]) =>
    mockCommitPendingVerifiedProcedureObservation(...args),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;

function deliverFinalAssistantMessage(callbacks: Parameters<typeof runOrchestrator>[1]): void {
  callbacks.onAssistantMessage?.('The requested turn is complete.', [], undefined, {
    kind: 'final',
    completionStatus: 'complete',
    finishReason: 'stop',
  });
  callbacks.onAgentControlGraphStateChange?.(
    createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
  );
}

describe('foreground terminal memory publication', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it.each([
    ['agentic', 'run-1'],
    ['chitchat', null],
  ] as const)(
    'commits %s procedure evidence with exact turn-memory lineage between durable completion and owner release',
    async (mode, sourceRunId) => {
      const conversation = createConversation({ mode });
      const provider = createProvider('target-provider', 'target-model');
      const context = createExecutionContext({
        conversation,
        providers: [provider],
        ensureCanonicalConversation: jest.fn(),
        recordConversationTurnMemory: jest.fn(),
      });
      mockedResolveForegroundRunPreflight.mockResolvedValue(
        createReadyPreflightResult({ conversation, provider }),
      );
      const pending = Object.freeze({}) as PendingVerifiedProcedureObservation;
      mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
        deliverFinalAssistantMessage(callbacks);
        callbacks.onDone();
        return {
          terminalDisposition: 'final_candidate',
          pendingVerifiedProcedureObservation: pending,
        };
      });
      mockCommitPendingVerifiedProcedureObservation.mockResolvedValue({ status: 'recorded' });

      await executeForegroundConversationRun({ context, conversationId: conversation.id });

      const recordConversationTurnMemory = context.helpers
        .recordConversationTurnMemory as jest.Mock;
      expect(recordConversationTurnMemory.mock.calls[0][2].sourceEndMessageId).toBe(
        context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
      );
      expect(mockCommitPendingVerifiedProcedureObservation).toHaveBeenCalledWith({
        memoryLineage: {
          sourceMessageId:
            context.durability.createModelExecution.mock.calls[0][0].requestMessageId,
          sourceRunId,
          sourceTurnId:
            context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
          taskId: null,
        },
        pending,
        surface: 'foreground',
        terminalObservedAt: expect.any(Number),
      });
      expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
        context.durability.completeModelExecution.mock.invocationCallOrder[0],
      );
      expect(context.durability.completeModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
        mockCommitPendingVerifiedProcedureObservation.mock.invocationCallOrder[0],
      );
      expect(
        mockCommitPendingVerifiedProcedureObservation.mock.invocationCallOrder[0],
      ).toBeLessThan(context.durability.releaseModelProjection.mock.invocationCallOrder[0]);
    },
  );

  it('blocks journal completion and projection release until terminal memory is published', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    let resolvePublication!: (value: { disposition: 'enqueued'; jobId: string }) => void;
    const recordConversationTurnMemory = jest.fn(
      () =>
        new Promise<{ disposition: 'enqueued'; jobId: string }>((resolve) => {
          resolvePublication = resolve;
        }),
    );
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const execution = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });
    while (recordConversationTurnMemory.mock.calls.length === 0) await Promise.resolve();

    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(2);
    expect(
      context.getCurrentConversation().messages.find((message) => message.role === 'assistant')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });

    resolvePublication({ disposition: 'enqueued', jobId: 'job-deferred' });
    await execution;

    expect(context.durability.flushChatState).toHaveBeenCalledTimes(4);
    expect(
      context.getCurrentConversation().messages.find((message) => message.role === 'assistant')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: 'enqueued' });
    expect(context.durability.flushChatState.mock.invocationCallOrder[1]).toBeLessThan(
      recordConversationTurnMemory.mock.invocationCallOrder[0],
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.flushChatState.mock.invocationCallOrder[2],
    );
    expect(context.durability.flushChatState.mock.invocationCallOrder[2]).toBeLessThan(
      context.durability.completeModelExecution.mock.invocationCallOrder[0],
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledTimes(1);
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['opt_out', true, false],
    ['ephemeral_thread', false, true],
  ] as const)(
    'persists an initial %s receipt without invoking durable memory publication',
    async (disposition, disabled, isSideThread) => {
      useSettingsStore.setState({ disableLongTermMemory: disabled });
      const conversation = createConversation({ mode: 'chitchat', isSideThread });
      const provider = createProvider('target-provider', 'target-model');
      const recordConversationTurnMemory = jest.fn();
      const context = createExecutionContext({
        conversation,
        providers: [provider],
        ensureCanonicalConversation: jest.fn(),
        recordConversationTurnMemory,
      });
      mockedResolveForegroundRunPreflight.mockResolvedValue(
        createReadyPreflightResult({ conversation, provider }),
      );
      mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
        deliverFinalAssistantMessage(callbacks);
        callbacks.onDone();
        return { terminalDisposition: 'final_candidate' };
      });

      await executeForegroundConversationRun({ context, conversationId: conversation.id });

      expect(recordConversationTurnMemory).not.toHaveBeenCalled();
      expect(
        context.getCurrentConversation().messages.find((message) => message.role === 'assistant')
          ?.memoryPublication,
      ).toEqual({ version: 1, disposition });
      expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
      expect(context.durability.completeModelExecution).toHaveBeenCalledTimes(1);
    },
  );

  it('reuses an already terminal receipt without publishing the turn again', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      const final = context
        .getCurrentConversation()
        .messages.find((message) => message.role === 'assistant');
      expect(final).toBeDefined();
      expect(
        context.store.transitionMessageMemoryPublication(conversation.id, final!.id, 'opt_out'),
      ).toMatchObject({ status: 'applied' });
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
    expect(context.durability.completeModelExecution).toHaveBeenCalledTimes(1);
  });

  it.each([2, 3])(
    'withholds journal completion when source changes during receipt flush %i',
    async (mutationFlushNumber) => {
      const conversation = createConversation({ mode: 'chitchat' });
      const provider = createProvider('target-provider', 'target-model');
      const recordConversationTurnMemory = jest.fn();
      const context = createExecutionContext({
        conversation,
        providers: [provider],
        ensureCanonicalConversation: jest.fn(),
        recordConversationTurnMemory,
      });
      context.durability.flushChatState.mockImplementation(async () => {
        if (context.durability.flushChatState.mock.calls.length !== mutationFlushNumber) return;
        const final = context
          .getCurrentConversation()
          .messages.find((message) => message.role === 'assistant');
        if (final) context.store.updateMessage(conversation.id, final.id, 'Changed during flush');
      });
      mockedResolveForegroundRunPreflight.mockResolvedValue(
        createReadyPreflightResult({ conversation, provider }),
      );
      mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
        deliverFinalAssistantMessage(callbacks);
        callbacks.onDone();
        return { terminalDisposition: 'final_candidate' };
      });

      await expect(
        executeForegroundConversationRun({ context, conversationId: conversation.id }),
      ).rejects.toThrow('foreground_terminal_memory_source_changed');

      expect(recordConversationTurnMemory).toHaveBeenCalledTimes(mutationFlushNumber - 2);
      expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
      expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    },
  );

  it('publishes an exact untracked agentic turn without creating a synthetic run', async () => {
    const conversation = createConversation({
      mode: 'agentic',
      messages: [{ id: 'user-1', role: 'user', content: '...', timestamp: 1 }],
    });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      expect.any(Object),
      expect.objectContaining({
        sourceEndMessageId:
          context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
        sourceRunId: undefined,
      }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('closes an explicit command without inventing a memory source', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('closes an agentic slash command without creating a workflow run or memory source', async () => {
    const conversation = createConversation({
      mode: 'agentic',
      messages: [{ id: 'user-1', role: 'user', content: '/new', timestamp: 1 }],
    });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('journals a broken tracked final candidate as failed when final recovery fails', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    context.helpers.ensureAgentRunFinalResponse = jest.fn().mockResolvedValue(undefined);
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.store.startAgentRun).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('publishes a complete failure report but journals the persisted run failure', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    const pending = Object.freeze({}) as PendingVerifiedProcedureObservation;
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'failed' }),
      );
      callbacks.onDone();
      return {
        terminalDisposition: 'failed',
        pendingVerifiedProcedureObservation: pending,
      };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(mockCommitPendingVerifiedProcedureObservation).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('fails an incomplete untracked response without publishing it', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage?.('The response was cut short.', [], undefined, {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'length',
      });
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary untracked turn recoverable when no final was persisted', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('foreground_terminal_memory_untracked_final_unavailable');

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.relinquishModelExecutionProcessOwnership).toHaveBeenCalledTimes(1);
  });

  it('withholds journal completion when the published source changes before commit', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    recordConversationTurnMemory.mockImplementation(async () => {
      const sourceEndMessageId = recordConversationTurnMemory.mock.calls[0][2]
        .sourceEndMessageId as string;
      context.store.updateMessage(
        conversation.id,
        sourceEndMessageId,
        'The final changed while publication was pending.',
      );
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('foreground_terminal_memory_source_changed');

    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.relinquishModelExecutionProcessOwnership).toHaveBeenCalledTimes(1);
  });

  it('leaves the journal and projection recoverable when terminal memory publication fails', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest
      .fn()
      .mockRejectedValue(new Error('memory publication unavailable'));
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('memory publication unavailable');

    expect(context.durability.relinquishModelExecutionProcessOwnership).toHaveBeenCalledWith(
      context.durability.createModelExecution.mock.calls[0][0].runId,
    );
    expect(
      context.getCurrentConversation().messages.find((message) => message.role === 'assistant')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(2);
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
  });
});
