import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { resolveForegroundInterruptedResponseOutcome } from '../../src/engine/graph/foregroundRun/foregroundInterruptedResponse';
import { buildMobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import { reduceAgentControlGraph } from '../../src/engine/graph/agentControlGraph';
import { buildAgentRunMobileControllerAsyncOperation } from '../../src/services/agents/mobileControllerAsyncOperation';
import { settleMobileControllerOutcome } from '../../src/services/executionJournal/mobileControllerOutcomeStore';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';
import {
  createMobileControllerCapabilityFixture,
  createMobileControllerOutcomeFixture,
  createMobileControllerSettlementFixture,
  createPersistedMobileControllerHandoffFixture,
} from '../helpers/mobileControllerHandoffFixture';
import { makeTestAgentRun } from '../helpers/factories';

const mockCanWriteLongTermMemory = jest.fn();

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/foregroundInterruptedResponse', () => ({
  resolveForegroundInterruptedResponseOutcome: jest.fn(),
}));

jest.mock('../../src/services/executionJournal/mobileControllerOutcomeStore', () => ({
  settleMobileControllerOutcome: jest.fn(),
}));

jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  canWriteLongTermMemory: (...args: unknown[]) => mockCanWriteLongTermMemory(...args),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedResolveForegroundInterruptedResponseOutcome =
  resolveForegroundInterruptedResponseOutcome as jest.MockedFunction<
    typeof resolveForegroundInterruptedResponseOutcome
  >;
const mockedSettleMobileControllerOutcome = settleMobileControllerOutcome as jest.MockedFunction<
  typeof settleMobileControllerOutcome
>;

describe('foreground mobile controller binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRunOrchestrator.mockReset();
    mockedResolveForegroundRunPreflight.mockReset();
    mockedResolveForegroundInterruptedResponseOutcome.mockReset();
    mockedSettleMobileControllerOutcome.mockReset();
    mockCanWriteLongTermMemory.mockReturnValue(true);
    __resetOnDeviceGuardsForTests();
    mockedResolveForegroundInterruptedResponseOutcome.mockResolvedValue({
      status: 'failed',
      checkpointTitle: 'Turn failed',
      checkpointDetail: 'stream closed',
    });
  });

  it('binds the host controller with a foreground persistence barrier', async () => {
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
    const publication = buildMobileControllerPublishedHandoff(
      createPersistedMobileControllerHandoffFixture(),
      { conversationId: conversation.id, agentRunId: 'agent-run-1' },
    );
    if (!publication) throw new Error('expected mobile controller publication fixture');
    const publishHandoff = jest.fn().mockResolvedValue(undefined);
    const reviewAction = jest.fn().mockReturnValue({ kind: 'allow' });
    let flushCountBeforeControllerPersistence = -1;
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      if (!options.mobileController) throw new Error('expected mobile controller runtime port');
      expect(options.mobileController.reviewAction).toBeDefined();
      await options.mobileController.reviewAction?.({
        action: {
          kind: 'activate',
          target: {
            kind: 'coordinate',
            observationId: 'observation-before-1',
            x: 500,
            y: 500,
          },
        },
        currentObservation: options.mobileController.currentObservation,
      });
      flushCountBeforeControllerPersistence = context.durability.flushChatState.mock.calls.length;
      await options.mobileController.persistGraphState();
      await options.mobileController.publishHandoff(publication);
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: {
        mobileController: {
          capability: {
            version: 1,
            controllerId: 'android-controller-1',
            controllerContractVersion: 1,
            capabilityDigest: `sha256:${'a'.repeat(64)}`,
            policyAdmissionDigest: `sha256:${'b'.repeat(64)}`,
            environmentClass: 'managed',
            supportedActionKinds: ['activate'],
            allowedAppIds: [],
            observationEvidence: ['screenshot', 'window_identity'],
            outcomeDeliveryModes: ['deferred'],
            normalizedCoordinateScale: 1_000,
            maxPendingActions: 1,
            maxPayloadBytes: 16_384,
            timeoutMs: 10_000,
          },
          currentObservation: {
            observationId: 'observation-before-1',
            digest: `sha256:${'c'.repeat(64)}`,
            appId: 'notes',
            windowId: 'editor',
          },
          reviewAction,
          publishHandoff,
        },
      },
    });

    expect(flushCountBeforeControllerPersistence).toBeGreaterThanOrEqual(0);
    expect(context.durability.flushChatState.mock.calls.length).toBeGreaterThan(
      flushCountBeforeControllerPersistence,
    );
    expect(
      context.durability.flushChatState.mock.invocationCallOrder[
        flushCountBeforeControllerPersistence
      ],
    ).toBeLessThan(publishHandoff.mock.invocationCallOrder[0]);
    expect(publishHandoff).toHaveBeenCalledWith(publication);
    expect(reviewAction).toHaveBeenCalledTimes(1);
  });

  it('settles one host outcome and resumes the exact run with one correlated tool result', async () => {
    const persisted = createPersistedMobileControllerHandoffFixture();
    const handoff = persisted.handoffRef;
    const operation = buildAgentRunMobileControllerAsyncOperation({
      handoff,
      status: 'running',
      updatedAt: 40,
    });
    if (!operation) throw new Error('expected mobile controller async operation');
    const controlGraph = reduceAgentControlGraph(undefined, [
      { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 20 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: handoff.toolCallId, name: 'mobile_ui_action' }],
        timestamp: 30,
      },
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [operation],
        timestamp: 40,
      },
    ]);
    const conversation = createConversation({
      mode: 'agentic',
      activeAgentRunId: 'agent-run-mobile-1',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: 'Enter the draft in the open editor and continue until it is saved.',
          timestamp: 1,
        },
        {
          id: 'assistant-mobile-1',
          role: 'assistant',
          content: '',
          timestamp: 30,
          toolCalls: [
            {
              id: handoff.toolCallId,
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'running',
              startedAt: 30,
              updatedAt: 40,
            },
          ],
        },
      ],
      agentRuns: [
        makeTestAgentRun({
          id: 'agent-run-mobile-1',
          userMessageId: 'user-1',
          workflowTaskAnchor: {
            sourceMessageId: 'user-1',
            content: 'Enter the draft in the open editor and continue until it is saved.',
            attachments: [],
          },
          status: 'running',
          updatedAt: 40,
          controlGraph,
        }),
      ],
    });
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
    const outcome = createMobileControllerOutcomeFixture();
    const settlement = await createMobileControllerSettlementFixture();
    mockedSettleMobileControllerOutcome.mockResolvedValue(settlement);
    mockedRunOrchestrator.mockImplementation(async (options, callbacks) => {
      expect(options.agentRunId).toBe('agent-run-mobile-1');
      expect(options.internalUserMessageCount).toBe(1);
      expect(options.initialAgentControlGraphState).toEqual(
        expect.objectContaining({ status: 'ready', pendingAsyncCount: 0 }),
      );
      expect(options.messages.filter((message) => message.role === 'tool')).toEqual([
        expect.objectContaining({
          toolCallId: handoff.toolCallId,
          content: settlement.toolMessage.content,
        }),
      ]);
      expect(
        options.messages.filter((message) =>
          message.attachments?.some((attachment) => attachment.id === 'current-screen-1'),
        ),
      ).toEqual([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining(outcome.afterObservation!.observationId),
        }),
      ]);
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    if (!outcome.afterObservation) throw new Error('expected after-observation fixture');
    const runOptions = {
      reuseAgentRunId: 'agent-run-mobile-1',
      mobileController: {
        capability: createMobileControllerCapabilityFixture(),
        currentObservation: outcome.afterObservation,
        currentObservationImage: {
          id: 'current-screen-1',
          type: 'image' as const,
          uri: 'inline://current-screen-1.png',
          name: 'current-screen-1.png',
          mimeType: 'image/png',
          size: 8,
          base64: 'iVBORw0KGgo=',
        },
        publishHandoff: jest.fn(),
      },
      mobileControllerOutcome: { handoff, outcome },
    };
    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: runOptions,
    });

    expect(mockedSettleMobileControllerOutcome).toHaveBeenCalledWith({
      handoff,
      outcome,
      receivedAt: expect.any(Number),
    });
    expect(context.store.startAgentRun).not.toHaveBeenCalled();
    expect(context.store.applyMobileControllerOutcome).toHaveBeenCalledTimes(1);
    expect(context.durability.flushChatState).toHaveBeenCalled();
    expect(
      JSON.stringify(context.durability.createModelExecution.mock.calls[0]?.[0]),
    ).not.toContain('iVBORw0KGgo=');
    expect(JSON.stringify(context.durability.createModelExecution.mock.calls[0]?.[0])).toContain(
      outcome.afterObservation.observationId,
    );
    expect(
      context
        .getCurrentConversation()
        .messages.some((message) =>
          message.attachments?.some((attachment) => attachment.id === 'current-screen-1'),
        ),
    ).toBe(false);
    const storedResults = context
      .getCurrentConversation()
      .messages.filter(
        (message) => message.role === 'tool' && message.toolCallId === handoff.toolCallId,
      );
    expect(storedResults).toHaveLength(1);

    mockedSettleMobileControllerOutcome.mockResolvedValueOnce({
      ...settlement,
      kind: 'replayed',
    });
    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
      options: runOptions,
    });

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(context.store.applyMobileControllerOutcome).toHaveBeenCalledTimes(2);
    expect(
      context
        .getCurrentConversation()
        .messages.filter(
          (message) => message.role === 'tool' && message.toolCallId === handoff.toolCallId,
        ),
    ).toHaveLength(1);
  });

  it('closes the foreground generation while a mobile handoff remains parked', async () => {
    const persisted = createPersistedMobileControllerHandoffFixture();
    const operation = buildAgentRunMobileControllerAsyncOperation({
      handoff: persisted.handoffRef,
      status: 'running',
      updatedAt: 40,
    });
    if (!operation) throw new Error('expected mobile controller async operation');
    const controlGraph = reduceAgentControlGraph(undefined, [
      { type: 'MODEL_TURN_STARTED', iteration: 1, timestamp: 20 },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 1,
        toolCalls: [{ id: persisted.handoffRef.toolCallId, name: 'mobile_ui_action' }],
        timestamp: 30,
      },
      {
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
        pendingOperations: [operation],
        timestamp: 40,
      },
    ]);
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
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onPendingAsyncOperationsChange?.([operation]);
      callbacks.onAgentControlGraphStateChange?.(controlGraph);
      return {
        terminalDisposition: 'waiting',
        graphSnapshot: controlGraph,
      };
    });

    await executeForegroundConversationRun({
      context,
      conversationId: conversation.id,
    });

    expect(context.durability.completeModelExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded' }),
    );
    expect(context.store.completeAgentRun).not.toHaveBeenCalled();
  });
});
