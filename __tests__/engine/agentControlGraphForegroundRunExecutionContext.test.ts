import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';
import {
  __resetOnDeviceGuardsForTests,
  isMainInferenceActive,
} from '../../src/services/memory/onDeviceGuards';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/foregroundInterruptedResponse', () => ({
  resolveForegroundInterruptedResponseOutcome: jest.fn(),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedResolveForegroundInterruptedResponseOutcome =
  resolveForegroundInterruptedResponseOutcome as jest.MockedFunction<
    typeof resolveForegroundInterruptedResponseOutcome
  >;

function deliverFinalAssistantMessage(
  callbacks: Parameters<typeof runOrchestrator>[1],
  content = 'The requested turn is complete.',
): void {
  callbacks.onAssistantMessage?.(content, [], undefined, {
    kind: 'final',
    completionStatus: 'complete',
    finishReason: 'stop',
  });
  callbacks.onAgentControlGraphStateChange?.(
    createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
  );
}

describe('foreground run target-conversation execution context', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetOnDeviceGuardsForTests();
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('uses one target snapshot for orchestration, commands, and terminal memory provenance', async () => {
    const conversation = createConversation({ mode: 'chitchat', personaId: 'reviewer' });
    const staleProvider = createProvider('stale-provider', 'stale-model');
    const targetProvider = createProvider('target-provider', 'target-model');
    const finalizationProvider = { ...targetProvider, apiKey: 'hydrated-key' };
    const ensureCanonicalConversation = jest.fn(() => 'new-conversation');
    const recordConversationTurnMemory = jest.fn();
    const context = createExecutionContext({
      conversation,
      providers: [staleProvider, targetProvider],
      ensureCanonicalConversation,
      recordConversationTurnMemory,
    });

    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({
        conversation,
        provider: targetProvider,
        providerWithApiKey: finalizationProvider,
      }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onCommandResult?.({ action: 'new_conversation' });
      deliverFinalAssistantMessage(callbacks, 'A new conversation is ready.');
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });

    expect(mockedRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.id,
        personaId: 'reviewer',
        executionRunId: context.durability.createModelExecution.mock.calls[0][0].runId,
      }),
      expect.any(Object),
    );
    expect(ensureCanonicalConversation).toHaveBeenCalledWith({
      mode: 'chitchat',
      personaId: 'reviewer',
      reportMissingProvider: true,
    });
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        id: 'target-provider',
        model: 'target-model',
      }),
      expect.objectContaining({
        memoryConversationId: conversation.id,
        sourceEndMessageId:
          context.durability.completeModelExecution.mock.calls[0][0].projectionMessageId,
      }),
    );
    expect(context.durability.createModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation.id,
        requestMessageId: 'user-1',
        runId: context.durability.claimModelProjection.mock.calls[0][0].owner.runId,
      }),
    );
    const reservedAssistantMessageId =
      context.durability.claimModelProjection.mock.calls[0][0].owner.assistantMessageId;
    expect(
      context.durability.createModelExecution.mock.calls[0][0].requestState.messages,
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reservedAssistantMessageId })]),
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(context.durability.createModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockedRunOrchestrator.mock.invocationCallOrder[0],
    );
    expect(context.durability.claimModelProjection.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.flushChatState.mock.invocationCallOrder[0],
    );
    expect(context.durability.flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      mockedResolveForegroundRunPreflight.mock.invocationCallOrder[0],
    );
    expect(mockedResolveForegroundRunPreflight.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.createModelExecution.mock.invocationCallOrder[0],
    );
    expect(context.durability.createModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.activateModelExecution.mock.invocationCallOrder[0],
    );
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
    expect(context.durability.flushChatState.mock.invocationCallOrder[1]).toBeLessThan(
      recordConversationTurnMemory.mock.invocationCallOrder[0],
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.completeModelExecution.mock.invocationCallOrder[0],
    );
    expect(context.durability.completeModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.releaseModelProjection.mock.invocationCallOrder[0],
    );
    expect(context.durability.releaseModelProjection.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.flushChatState.mock.invocationCallOrder[2],
    );
  });

  it('waits for slow startup recovery readiness before creating exactly one generation', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    let markReady = () => {};
    context.durability.waitForRecoveryReadiness.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          markReady = resolve;
        }),
    );
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    const execution = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });
    await Promise.resolve();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();

    markReady();
    await execution;

    expect(context.durability.waitForRecoveryReadiness).toHaveBeenCalledTimes(1);
    expect(context.durability.createModelExecution).toHaveBeenCalledTimes(1);
    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('does not create a tracked run when projection availability fails', async () => {
    const conversation = createConversation({ mode: 'agentic' });
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
    context.durability.waitForProjectionAvailability.mockRejectedValueOnce(
      new Error('model_projection_wait_timeout'),
    );

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.helpers.setChatError).toHaveBeenCalledWith('model_projection_wait_timeout');
  });

  it('holds the inference lease through terminal lifecycle and releases it after completion', async () => {
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
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      expect(isMainInferenceActive()).toBe(true);
      deliverFinalAssistantMessage(callbacks);
      callbacks.onDone();
      expect(isMainInferenceActive()).toBe(true);
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(isMainInferenceActive()).toBe(false);
  });

  it('releases the inference lease after an orchestrator exception', async () => {
    const conversation = createConversation({ mode: 'agentic' });
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
    mockedRunOrchestrator.mockImplementation(async () => {
      expect(isMainInferenceActive()).toBe(true);
      throw new Error('provider failed');
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(isMainInferenceActive()).toBe(false);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('relinquishes process ownership when terminal journal completion fails', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
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
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });
    context.durability.completeModelExecution.mockRejectedValueOnce(
      new Error('journal unavailable'),
    );

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('journal unavailable');

    expect(context.durability.relinquishModelExecutionProcessOwnership).toHaveBeenCalledWith(
      context.durability.claimModelProjection.mock.calls[0][0].owner.runId,
    );
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
  });

  it('does not call the model when the journal-first boundary cannot be persisted', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
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
    context.durability.createModelExecution.mockRejectedValueOnce(new Error('journal unavailable'));

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.durability.flushChatState).toHaveBeenCalledTimes(3);
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
    expect(context.getCurrentConversation().messages.at(-1)?.assistantMetadata).toMatchObject({
      kind: 'final',
      completionStatus: 'incomplete',
      finishReason: 'interrupted_before_start',
    });
  });

  it('does not create a journal generation when the reservation claim fails', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
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
    context.durability.claimModelProjection.mockReturnValueOnce('owner_conflict');

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(context.durability.activateModelExecution).not.toHaveBeenCalled();
    expect(context.durability.completeModelExecution).not.toHaveBeenCalled();
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
  });

  it('closes a superseded generation without starting inference after the journal boundary', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
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
    context.durability.activateModelExecution.mockImplementationOnce(async ({ lease }) => {
      context.requests.isCurrentForegroundRequest.mockReturnValue(false);
      return {
        ...lease,
        expectedStatus: 'running',
        updatedAt: 11,
        checkpointId: 'checkpoint-cancelled',
      };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(isMainInferenceActive()).toBe(false);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('closes and releases the old generation before a nested resume may begin', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    const resumeAgentRun = jest.fn().mockResolvedValue(undefined);
    context.helpers.getResumeAgentRun = () => resumeAgentRun;
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Goals still open',
      checkpointDetail: 'stream closed',
      resumePrompt: 'Continue the interrupted run.',
      resumeUserPrompt: 'Continue.',
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onError(new Error('stream closed'));
      callbacks.onDone();
      return { terminalDisposition: 'failed' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(context.durability.completeModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.releaseModelProjection.mock.invocationCallOrder[0],
    );
    expect(context.durability.releaseModelProjection.mock.invocationCallOrder[0]).toBeLessThan(
      resumeAgentRun.mock.invocationCallOrder[0],
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledTimes(1);
  });

  it('waits for an aborted same-conversation owner to release before running the new turn', async () => {
    const conversation = createConversation({ mode: 'chitchat' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    const registry = createForegroundRequestRegistry();
    context.requests = {
      abortForegroundRequestForConversation: (conversationId, reason) =>
        registry.abortForConversation(conversationId, reason),
      clearForegroundRequest: (conversationId, requestId, controller) =>
        registry.clear({ conversationId, requestId, controller }),
      isCurrentForegroundRequest: (conversationId, requestId, controller) =>
        registry.isCurrent({ conversationId, requestId, controller }),
      registerForegroundRequest: (requestId, conversationId, controller) =>
        registry.register({ conversationId, requestId, controller }),
      setStreamingMessageId: (conversationId, requestId, controller, messageId) =>
        registry.setStreamingMessageId({ conversationId, requestId, controller }, messageId),
    };
    mockedResolveForegroundRunPreflight.mockResolvedValue(
      createReadyPreflightResult({ conversation, provider }),
    );
    let invocation = 0;
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      invocation += 1;
      if (invocation === 1) {
        await new Promise<void>((_resolve, reject) => {
          options.signal.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
        });
        return;
      }
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    const first = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });
    while (mockedRunOrchestrator.mock.calls.length < 1) await Promise.resolve();
    const second = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });

    await Promise.all([first, second]);

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(2);
    expect(context.durability.waitForProjectionAvailability).toHaveBeenCalledTimes(2);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('keeps callbacks and cleanup owned by each concurrent conversation', async () => {
    const firstConversation = createConversation({
      id: 'conversation-a',
      mode: 'chitchat',
      personaId: 'default',
    });
    const secondConversation = createConversation({
      id: 'conversation-b',
      mode: 'chitchat',
      personaId: 'default',
    });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation: firstConversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    context.helpers.getConversation = (conversationId: string) =>
      [firstConversation, secondConversation].find(
        (conversation) => conversation.id === conversationId,
      );
    context.helpers.getConversations = () => [firstConversation, secondConversation];

    const registry = createForegroundRequestRegistry();
    context.requests = {
      abortForegroundRequestForConversation: (conversationId, reason) =>
        registry.abortForConversation(conversationId, reason),
      clearForegroundRequest: (conversationId, requestId, controller) =>
        registry.clear({ conversationId, requestId, controller }),
      isCurrentForegroundRequest: (conversationId, requestId, controller) =>
        registry.isCurrent({ conversationId, requestId, controller }),
      registerForegroundRequest: (requestId, conversationId, controller) =>
        registry.register({ conversationId, requestId, controller }),
      setStreamingMessageId: (conversationId, requestId, controller, messageId) =>
        registry.setStreamingMessageId({ conversationId, requestId, controller }, messageId),
    };

    mockedResolveForegroundRunPreflight.mockImplementation(async ({ conversation }) => ({
      kind: 'ready',
      provider,
      providerWithApiKey: provider,
      model: provider.model,
      finalizationProviderContext: {
        provider,
        model: provider.model,
        systemPromptText: conversation?.systemPrompt ?? '',
        conversationId: conversation?.id ?? '',
      },
    }));

    const callbacksByConversation = new Map<string, Parameters<typeof runOrchestrator>[1]>();
    const releaseByConversation = new Map<string, () => void>();
    mockedRunOrchestrator.mockImplementation(
      (options, callbacks) =>
        new Promise<Awaited<ReturnType<typeof runOrchestrator>>>((resolve) => {
          callbacksByConversation.set(options.conversationId, callbacks);
          releaseByConversation.set(options.conversationId, () =>
            resolve({ terminalDisposition: 'command' }),
          );
        }),
    );

    const firstRun = executeForegroundConversationRun({
      context,
      conversationId: firstConversation.id,
    });
    const secondRun = executeForegroundConversationRun({
      context,
      conversationId: secondConversation.id,
    });
    for (let attempt = 0; attempt < 10 && callbacksByConversation.size < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect(callbacksByConversation.size).toBe(2);
    expect(isMainInferenceActive()).toBe(true);
    callbacksByConversation
      .get(firstConversation.id)
      ?.onUserMessageEnriched?.('user-a', 'enriched-a');
    callbacksByConversation
      .get(secondConversation.id)
      ?.onUserMessageEnriched?.('user-b', 'enriched-b');
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      firstConversation.id,
      'user-a',
      'enriched-a',
    );
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      secondConversation.id,
      'user-b',
      'enriched-b',
    );

    callbacksByConversation.get(firstConversation.id)?.onDone();
    releaseByConversation.get(firstConversation.id)?.();
    await firstRun;

    expect(registry.hasConversation(firstConversation.id)).toBe(false);
    expect(registry.hasConversation(secondConversation.id)).toBe(true);
    expect(isMainInferenceActive()).toBe(true);
    callbacksByConversation
      .get(secondConversation.id)
      ?.onUserMessageEnriched?.('user-b', 'still-current');
    expect(context.store.updateMessageEnrichedContent).toHaveBeenCalledWith(
      secondConversation.id,
      'user-b',
      'still-current',
    );

    callbacksByConversation.get(secondConversation.id)?.onDone();
    releaseByConversation.get(secondConversation.id)?.();
    await secondRun;
    expect(registry.size).toBe(0);
    expect(isMainInferenceActive()).toBe(false);
  });
});
