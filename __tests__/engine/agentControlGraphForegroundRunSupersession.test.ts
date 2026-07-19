import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { createForegroundRequestRegistry } from '../../src/engine/graph/foregroundRun/requestRegistry';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import { admitPendingClarificationReply } from '../../src/services/agents/clarificationReplyAdmission';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';
import {
  createConversation,
  createExecutionContext,
  createProvider,
} from '../helpers/foregroundRunExecutionContextHarness';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/services/agents/clarificationReplyAdmission', () => {
  const actual = jest.requireActual('../../src/services/agents/clarificationReplyAdmission');
  return { ...actual, admitPendingClarificationReply: jest.fn() };
});

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedAdmitPendingClarificationReply =
  admitPendingClarificationReply as jest.MockedFunction<typeof admitPendingClarificationReply>;

function useRealRequestRegistry(context: ReturnType<typeof createExecutionContext>): void {
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
}

function configureReadyPreflight(
  conversation: ReturnType<typeof createConversation>,
  provider: ReturnType<typeof createProvider>,
): void {
  mockedResolveForegroundRunPreflight.mockResolvedValue({
    kind: 'ready',
    provider,
    providerWithApiKey: provider,
    model: provider.model,
    finalizationProviderContext: {
      provider,
      model: provider.model,
      systemPromptText: conversation.systemPrompt,
      conversationId: conversation.id,
    },
  });
}

describe('foreground run supersession', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetOnDeviceGuardsForTests();
  });

  it('does not surface a wait error from a request that is no longer current', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    const setChatError = jest.fn();
    context.helpers.setChatError = setChatError;
    context.requests.isCurrentForegroundRequest.mockReturnValue(false);
    context.durability.waitForProjectionAvailability.mockRejectedValueOnce(
      new Error('model_projection_wait_cancelled'),
    );
    configureReadyPreflight(conversation, provider);

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(setChatError).not.toHaveBeenCalled();
    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('retargets the durable projection and starts a new run for an admitted task switch', async () => {
    const waitingRun: AgentRun = {
      id: 'run-awaiting-user',
      userMessageId: 'user-1',
      workflowTaskAnchor: {
        sourceMessageId: 'user-1',
        content: 'Move my calendar event.',
        attachments: [],
      },
      goal: 'Move my calendar event.',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
      currentPhase: 'work',
      phases: [],
      checkpoints: [],
      summary: {
        assistantTurns: 1,
        startedTools: 1,
        completedTools: 1,
        failedTools: 0,
        spawnedSubAgents: 0,
      },
      controlGraph: createInitialAgentControlGraphSnapshot({
        status: 'awaiting_user',
        pendingUserInput: {
          requestedAfterUserMessageId: 'user-1',
          requiredInformation: [
            {
              key: 'calendar.new_time',
              requiredFor: 'execution',
              semanticRole: 'time',
              resolution: 'unresolved',
            },
          ],
          updatedAt: 2,
        },
      }),
    };
    const conversation = createConversation({
      mode: 'agentic',
      activeAgentRunId: waitingRun.id,
      agentRuns: [waitingRun],
      messages: [
        { id: 'user-1', role: 'user', content: waitingRun.goal, timestamp: 1 } as Message,
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'What new time should I use?',
          timestamp: 2,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'request_clarification',
          },
        } as Message,
        {
          id: 'user-2',
          role: 'user',
          content: 'Recover my interrupted planning file instead.',
          timestamp: 3,
        } as Message,
      ],
    });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    configureReadyPreflight(conversation, provider);
    mockedAdmitPendingClarificationReply.mockResolvedValue({
      runId: waitingRun.id,
      disposition: 'new_request',
      resolvedInformationKeys: [],
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage?.('Recovered the planning file.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.store.completeAgentRun).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ status: 'cancelled' }),
      waitingRun.id,
    );
    expect(context.store.startAgentRun).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ userMessageId: 'user-2' }),
    );
    expect(context.durability.createModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ requestMessageId: 'user-2' }),
    );
    expect(context.durability.mutateModelProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ requestMessageId: 'user-1' }),
      }),
    );
  });

  it('lets the newest turn win while the old claimed projection is creating its journal', async () => {
    const conversation = createConversation({ mode: 'agentic' });
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    useRealRequestRegistry(context);
    configureReadyPreflight(conversation, provider);
    const defaultCreateModelExecution =
      context.durability.createModelExecution.getMockImplementation()!;
    let releaseFirstCreate = () => {};
    const firstCreateBarrier = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });
    context.durability.createModelExecution.mockImplementationOnce(async (input) => {
      await firstCreateBarrier;
      return defaultCreateModelExecution(input);
    });
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onAssistantMessage?.('The newest turn completed.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
      callbacks.onAgentControlGraphStateChange?.(
        createInitialAgentControlGraphSnapshot({ status: 'awaiting_review' }),
      );
      callbacks.onDone();
      return { terminalDisposition: 'final_candidate' };
    });

    const first = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });
    while (context.durability.createModelExecution.mock.calls.length < 1) {
      await Promise.resolve();
    }
    const second = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });

    releaseFirstCreate();
    await Promise.all([first, second]);

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: expect.objectContaining({ expectedStatus: 'queued' }),
        status: 'cancelled',
      }),
    );
    expect(context.store.completeAgentRun).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({ status: 'cancelled' }),
      'run-1',
    );
  });

  it('drops a stale resume when its requested run terminalizes during projection wait', async () => {
    const runningRun: AgentRun = {
      id: 'run-to-resume',
      userMessageId: 'user-1',
      goal: 'Finish the task',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      currentPhase: 'work',
      phases: [],
      checkpoints: [],
      summary: {
        assistantTurns: 1,
        startedTools: 0,
        completedTools: 0,
        failedTools: 0,
        spawnedSubAgents: 0,
      },
    };
    const conversation = createConversation({
      mode: 'agentic',
      activeAgentRunId: runningRun.id,
      agentRuns: [runningRun],
    });
    let latestConversation = conversation;
    const provider = createProvider('target-provider', 'target-model');
    const context = createExecutionContext({
      conversation,
      providers: [provider],
      ensureCanonicalConversation: jest.fn(),
      recordConversationTurnMemory: jest.fn(),
    });
    context.helpers.getConversation = () => latestConversation;
    context.helpers.getConversations = () => [latestConversation];
    const clearTrackedRunCancellation = jest.fn();
    context.helpers.clearTrackedRunCancellation = clearTrackedRunCancellation;
    let releaseAvailability = () => {};
    context.durability.waitForProjectionAvailability.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseAvailability = resolve;
        }),
    );
    configureReadyPreflight(conversation, provider);

    const execution = executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: { reuseAgentRunId: runningRun.id },
    });
    while (context.durability.waitForProjectionAvailability.mock.calls.length < 1) {
      await Promise.resolve();
    }
    latestConversation = {
      ...conversation,
      activeAgentRunId: undefined,
      agentRuns: [{ ...runningRun, status: 'completed', updatedAt: 2 }],
    };
    releaseAvailability();

    await execution;

    expect(clearTrackedRunCancellation).not.toHaveBeenCalled();
    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });
});
