import { executeAgentControlGraphToolBatch } from '../../src/engine/graph/toolTurnBatchExecution';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { MOBILE_UI_ACTION_TOOL_DEFINITION } from '../../src/engine/mobileController/toolDefinition';
import { POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';
import { buildToolResultMessage } from '../../src/engine/toolExecution/toolExecutionMessages';
import { createGoal } from '../../src/engine/goals/types';

jest.mock('../../src/engine/toolExecution/toolCallLifecycle', () => ({
  executeToolCallLifecycle: jest.fn(),
  isDeferredToolExecutionLifecycleResult: (result: unknown) =>
    Boolean(result && typeof result === 'object' && 'deferredHandoff' in result),
}));

const mockedExecuteToolCallLifecycle = jest.mocked(executeToolCallLifecycle);

function params(
  executableToolCalls: ReadonlyArray<{ id: string; name: string; arguments: string }>,
) {
  return {
    executableToolCalls,
    memoryPolicyBinding: POLICY_INDEPENDENT_MODEL_TURN_MEMORY_BINDING,
    iteration: 1,
    conversationId: 'conversation-mobile-1',
    activeProvider: {
      id: 'provider-1',
      name: 'Provider',
      apiKey: 'test-key',
      baseUrl: 'https://provider.invalid',
      enabled: true,
    },
    activeModel: 'model-1',
    memoryConversationId: 'conversation-mobile-1',
    availableToolNames: new Set(['mobile_ui_action', 'read_file']),
    runtimeToolAvailability: {
      hasWorkspaceTargets: false,
      hasBrowserControllableWorkspaceTargets: false,
      hasDelegableWorkspaceTargets: false,
      hasMobileController: true,
    },
    toolCallHistory: [],
    trackedAsyncOperations: new Map(),
    callbacks: {
      onToolCallStart: jest.fn(),
      onToolCallComplete: jest.fn(),
    },
    pendingAsyncMonitorToolNames: new Set<string>(),
    groundedRequestScopedTools: [
      MOBILE_UI_ACTION_TOOL_DEFINITION,
      {
        name: 'read_file',
        description: 'Read a file.',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ],
    completedWorkflowToolNames: new Set<string>(),
    recordPerformanceMetrics: jest.fn(),
    controlGraphGoals: [
      createGoal({
        id: 'mobile-goal',
        title: 'Complete the requested device task',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:mobile_ui_action'],
        userConstraints: [
          {
            text: 'Update the device according to my request.',
            sourceMessageId: 'user-message-1',
          },
        ],
        now: 100,
      }),
    ],
    agentRunId: 'agent-run-mobile-1',
    executionRunId: 'execution-run-mobile-1',
    onBatchCommitted: jest.fn(),
  };
}

describe('mobile controller tool batch execution', () => {
  beforeEach(() => {
    mockedExecuteToolCallLifecycle.mockReset();
  });

  it('suspends a single-action turn at its deferred boundary', async () => {
    const deferredHandoff = createPersistedMobileControllerHandoffFixture();
    mockedExecuteToolCallLifecycle.mockResolvedValueOnce({
      toolCallId: deferredHandoff.handoffRef.toolCallId,
      effectiveToolName: 'mobile_ui_action',
      deferredHandoff,
      effectDispatchObservation: {
        kind: 'deferred',
        handoff: deferredHandoff.handoffRef,
      },
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      params([
        {
          id: deferredHandoff.handoffRef.toolCallId,
          name: 'mobile_ui_action',
          arguments: JSON.stringify(deferredHandoff.handoff.action),
        },
      ]),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([
      {
        index: 0,
        toolCallId: deferredHandoff.handoffRef.toolCallId,
        deferredHandoff,
        effectDispatchObservation: {
          kind: 'deferred',
          handoff: deferredHandoff.handoffRef,
        },
      },
    ]);
  });

  it('blocks a mixed turn before any action can cross the observation boundary', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (lifecycle) => {
      const blocker = lifecycle.workflowToolCallBlocker?.(
        lifecycle.tc.name,
        lifecycle.tc.arguments,
      );
      expect(blocker).toContain('must be the only tool call');
      return {
        toolCallId: lifecycle.tc.id,
        effectiveToolName: lifecycle.tc.name,
        result: blocker,
        toolMessage: buildToolResultMessage({
          idPrefix: 'blocked',
          toolCallId: lifecycle.tc.id,
          content: blocker ?? 'blocked',
          toolCall: { ...lifecycle.tc, status: 'failed', error: blocker },
          isError: true,
        }),
      };
    });

    const outcomes = await executeAgentControlGraphToolBatch(
      params([
        { id: 'tc-mobile', name: 'mobile_ui_action', arguments: '{"kind":"back"}' },
        { id: 'tc-read', name: 'read_file', arguments: '{"path":"later"}' },
      ]),
    );

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(2);
    expect(outcomes).toHaveLength(2);
    expect(
      outcomes.every((outcome) => 'toolMessage' in outcome && outcome.toolMessage.isError),
    ).toBe(true);
  });

  it('blocks an unanchored raw action before the tool lifecycle can claim it', async () => {
    mockedExecuteToolCallLifecycle.mockImplementation(async (lifecycle) => {
      const blocker = lifecycle.workflowToolCallBlocker?.(
        lifecycle.tc.name,
        lifecycle.tc.arguments,
      );
      expect(JSON.parse(blocker ?? '{}')).toMatchObject({
        status: 'error',
        code: 'mobile_controller_goal_required',
        repair: { tool: 'update_goals' },
      });
      return {
        toolCallId: lifecycle.tc.id,
        effectiveToolName: lifecycle.tc.name,
        result: blocker,
        toolMessage: buildToolResultMessage({
          idPrefix: 'blocked',
          toolCallId: lifecycle.tc.id,
          content: blocker ?? 'blocked',
          toolCall: { ...lifecycle.tc, status: 'failed', error: blocker },
          isError: true,
        }),
      };
    });

    const input = params([
      { id: 'tc-mobile', name: 'mobile_ui_action', arguments: '{"kind":"back"}' },
    ]);
    input.controlGraphGoals = [];

    const outcomes = await executeAgentControlGraphToolBatch(input);

    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect('toolMessage' in outcomes[0] && outcomes[0].toolMessage.isError).toBe(true);
  });
});
