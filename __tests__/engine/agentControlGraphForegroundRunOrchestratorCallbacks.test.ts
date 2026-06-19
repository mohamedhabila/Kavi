import { createForegroundRunOrchestratorCallbacks } from '../../src/engine/graph/foregroundRun/orchestratorCallbacks';
import * as conversationUsage from '../../src/services/usage/conversationUsage';
import type { AgentRunAsyncOperation } from '../../src/types/agentRun';
import type { ToolCall } from '../../src/types/message';

function buildToolCall(id: string, name: string): ToolCall {
  return {
    id,
    name,
    arguments: '{}',
    status: 'pending',
  };
}

function createHarness(overrides?: {
  guardRunCallback?: () => boolean;
  isSurfacedWorkerOutputLocked?: () => boolean;
  trackedAgentRunId?: string;
}) {
  const actions = {
    appendConversationLog: jest.fn(),
    applyConversationCompaction: jest.fn(),
    setLatestPendingAsyncOperations: jest.fn(),
    updateMessageEnrichedContent: jest.fn(),
  };
  const controllers = {
    assistantMessage: {
      applyAssistantMessage: jest.fn(),
    },
    assistantStream: {
      appendReasoningToken: jest.fn(),
      appendToken: jest.fn(),
      resetCurrentTurn: jest.fn(),
    },
    commandResult: {
      handleCommandResult: jest.fn().mockResolvedValue(undefined),
    },
    terminalLifecycle: {
      handleDone: jest.fn(),
      handleError: jest.fn(),
    },
    toolCallLifecycle: {
      completeToolCall: jest.fn(),
      publishToolMessage: jest.fn(),
      queueToolCall: jest.fn(),
      startToolCall: jest.fn(),
    },
    trackedRunStore: {
      applyGraphStateSyncEffect: jest.fn(),
      applyOrchestratorStateEffect: jest.fn(),
      applyPendingAsyncSyncEffect: jest.fn(),
    },
  };

  const callbacks = createForegroundRunOrchestratorCallbacks({
    actions,
    controllers,
    conversationId: 'conv-1',
    guardRunCallback: overrides?.guardRunCallback ?? (() => true),
    isSurfacedWorkerOutputLocked: overrides?.isSurfacedWorkerOutputLocked ?? (() => false),
    model: 'gemini-3.5-flash',
    providerId: 'provider-1',
    trackedAgentRunId: overrides?.trackedAgentRunId ?? 'run-1',
  });

  return {
    actions,
    callbacks,
    controllers,
  };
}

describe('foreground run orchestrator callbacks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs distinct non-error orchestrator states once', () => {
    const harness = createHarness();

    harness.callbacks.onStateChange?.('thinking');
    harness.callbacks.onStateChange?.('thinking');
    harness.callbacks.onStateChange?.('error');

    expect(harness.controllers.trackedRunStore.applyOrchestratorStateEffect).toHaveBeenCalledTimes(
      1,
    );
    expect(harness.actions.appendConversationLog).toHaveBeenCalledTimes(1);
    expect(harness.actions.appendConversationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'state',
        level: 'info',
        title: 'State: Thinking',
      }),
    );
  });

  it('tracks pending async operations and only syncs tracked runs into store', () => {
    const operation: AgentRunAsyncOperation = {
      key: 'session:1',
      kind: 'session',
      resourceId: 'sub-1',
      displayName: 'Worker',
      status: 'running',
      lastUpdatedByTool: 'sessions_spawn',
      updatedAt: 123,
      monitorToolNames: ['sessions_wait'],
    };
    const activeHarness = createHarness({ trackedAgentRunId: 'run-1' });
    const detachedHarness = createHarness({ trackedAgentRunId: '' });

    activeHarness.callbacks.onPendingAsyncOperationsChange?.([operation]);
    detachedHarness.callbacks.onPendingAsyncOperationsChange?.([operation]);

    expect(activeHarness.actions.setLatestPendingAsyncOperations).toHaveBeenCalledWith([operation]);
    expect(
      activeHarness.controllers.trackedRunStore.applyPendingAsyncSyncEffect,
    ).toHaveBeenCalledTimes(1);
    expect(detachedHarness.actions.setLatestPendingAsyncOperations).toHaveBeenCalledWith([
      operation,
    ]);
    expect(
      detachedHarness.controllers.trackedRunStore.applyPendingAsyncSyncEffect,
    ).not.toHaveBeenCalled();
  });

  it('records primary usage with provider and run context', () => {
    const usageSpy = jest
      .spyOn(conversationUsage, 'recordConversationUsageEvent')
      .mockImplementation(() => undefined);
    const harness = createHarness();

    harness.callbacks.onUsage?.({
      model: '',
      inputTokens: 11,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 18,
    });

    expect(usageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        providerId: 'provider-1',
        source: 'primary',
        agentRunId: 'run-1',
        emitLog: true,
        usage: expect.objectContaining({
          model: 'gemini-3.5-flash',
          totalTokens: 18,
        }),
      }),
    );
  });

  it('suppresses streamed tokens while surfaced worker output is locked', () => {
    const harness = createHarness({ isSurfacedWorkerOutputLocked: () => true });

    harness.callbacks.onToken?.('hello');
    harness.callbacks.onReasoning?.('reason');
    harness.callbacks.onToolCallQueued?.(buildToolCall('tc-1', 'write_file'));

    expect(harness.controllers.assistantStream.appendToken).not.toHaveBeenCalled();
    expect(harness.controllers.assistantStream.appendReasoningToken).not.toHaveBeenCalled();
    expect(harness.controllers.toolCallLifecycle.queueToolCall).toHaveBeenCalledTimes(1);
  });
});
