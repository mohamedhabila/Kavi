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

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
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

describe('foreground turn capture', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('captures the turn between durable completion and owner release', async () => {
    const conversation = createConversation();
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
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

    const recordConversationTurnMemory = context.helpers.recordConversationTurnMemory as jest.Mock;
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
    );
    expect(context.durability.completeModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      recordConversationTurnMemory.mock.invocationCallOrder[0],
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.releaseModelProjection.mock.invocationCallOrder[0],
    );
  });

  it('captures the final of a newly tracked punctuation-only turn', async () => {
    const conversation = createConversation({
      messages: [{ id: 'user-1', role: 'user', content: '...', timestamp: 1 }],
    });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
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

    expect(context.store.startAgentRun).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('closes a slash command without a workflow run or a captured turn', async () => {
    const conversation = createConversation({
      messages: [{ id: 'user-1', role: 'user', content: '/new', timestamp: 1 }],
    });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
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

  it('journals a final candidate that delivered no answer as failed', async () => {
    const conversation = createConversation();
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
      recordConversationTurnMemory,
    });
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

  it('captures a complete failure report but journals the persisted run failure', async () => {
    const conversation = createConversation();
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
      recordConversationTurnMemory,
    });
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      deliverFinalAssistantMessage(callbacks);
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'failed' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'failed' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
  });

  it('fails an incomplete response without capturing it', async () => {
    const conversation = createConversation();
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
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

  it('leaves an untracked slash-command turn recoverable when no final was persisted', async () => {
    const conversation = createConversation({
      messages: [{ id: 'user-1', role: 'user', content: '/new', timestamp: 1 }],
    });
    const provider = createProvider('target-provider', 'target-model');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureConversation: jest.fn(),
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

    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.relinquishModelExecutionProcessOwnership).toHaveBeenCalledTimes(1);
  });
});
