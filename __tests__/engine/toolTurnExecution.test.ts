jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { executeAgentControlGraphToolTurn } from '../../src/engine/graph/toolTurnExecution';
import { detectLoops } from '../../src/engine/loopDetection';
import { executeToolExecutionBatch } from '../../src/engine/toolExecution/toolExecutionBatch';
import { executeToolCallLifecycle } from '../../src/engine/toolExecution/toolCallLifecycle';
import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildModelTurnMemoryPolicyBinding } from '../../src/engine/authority/modelTurnMemoryPolicyBinding';
import { initializeMemoryPolicyObservation } from '../../src/services/memory/policy';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { captureCurrentModelTurnMemoryFence } from '../helpers/modelTurnMemoryAuthority';
import { MOBILE_UI_ACTION_TOOL_DEFINITION } from '../../src/engine/mobileController/toolDefinition';
import { createMobileControllerCapabilityFixture } from '../helpers/mobileControllerHandoffFixture';
import { resolveMobileControllerRecoveryPreflight } from '../../src/engine/graph/mobileControllerRecoveryPolicy';
import { createGoal } from '../../src/engine/goals/types';
import {
  createPendingToolCall,
  createToolMessage,
  createToolTurnExecutionParams as createParams,
  toolTurnExecutionTools,
} from '../helpers/toolTurnExecutionFixtures';

jest.mock('../../src/engine/loopDetection', () => {
  const actual = jest.requireActual('../../src/engine/loopDetection');
  return {
    ...actual,
    detectLoops: jest.fn(),
  };
});

jest.mock('../../src/engine/toolExecution/toolExecutionBatch', () => ({
  executeToolExecutionBatch: jest.fn(),
}));

jest.mock('../../src/engine/toolExecution/toolCallLifecycle', () => {
  const actual = jest.requireActual('../../src/engine/toolExecution/toolCallLifecycle');
  return {
    ...actual,
    executeToolCallLifecycle: jest.fn(),
  };
});

jest.mock('../../src/engine/graph/toolExecutionOutcomeResolution', () => ({
  resolveAgentControlGraphToolExecutionOutcomes: jest.fn(),
}));

const mockedDetectLoops = jest.mocked(detectLoops);
const mockedExecuteToolExecutionBatch = jest.mocked(executeToolExecutionBatch);
const mockedExecuteToolCallLifecycle = jest.mocked(executeToolCallLifecycle);
const mockedResolveToolExecutionOutcomes = jest.mocked(
  resolveAgentControlGraphToolExecutionOutcomes,
);

describe('toolTurnExecution', () => {
  beforeEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    initializeMemoryPolicyObservation();
    mockedDetectLoops.mockReset();
    mockedExecuteToolExecutionBatch.mockReset();
    mockedExecuteToolCallLifecycle.mockReset();
    mockedResolveToolExecutionOutcomes.mockReset();
    mockedResolveToolExecutionOutcomes.mockImplementation(async (params: any) => ({
      status: 'continued',
      lastPendingAsyncSignature: 'next-signature',
      workingMessages: params.workingMessages,
    }));
  });

  afterEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  it('does not persist or dispatch a tool plan invalidated during async batch planning', async () => {
    const memoryFence = captureCurrentModelTurnMemoryFence();
    let releasePlan!: () => void;
    let markPlanStarted!: () => void;
    const planStarted = new Promise<void>((resolve) => {
      markPlanStarted = resolve;
    });
    const verifiedProcedureSession = {
      observePlannedBatch: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releasePlan = resolve;
            markPlanStarted();
          }),
      ),
    };
    mockedDetectLoops.mockReturnValue({ loopDetected: false, level: 'none' } as never);
    const params = createParams({
      memoryPolicyBinding: buildModelTurnMemoryPolicyBinding(memoryFence),
      verifiedProcedureSession: verifiedProcedureSession as never,
    });

    const execution = executeAgentControlGraphToolTurn(params);
    await planStarted;
    useSettingsStore.setState({ disableLongTermMemory: true });
    releasePlan();

    await expect(execution).rejects.toThrow('memory_prompt_epoch_expired');
    expect(params.callbacks.onAssistantMessage).not.toHaveBeenCalled();
    expect(mockedExecuteToolExecutionBatch).not.toHaveBeenCalled();
    const graphEvents = (params.applyGraphEvents as jest.Mock).mock.calls.flatMap(
      ([events]) => events,
    );
    expect(graphEvents.some((event) => event.type === 'GOALS_UPDATED')).toBe(false);
    expect(graphEvents.some((event) => event.type === 'MODEL_TURN_COMPLETED')).toBe(false);
  });

  it('blocks the run when a critical loop is detected before tool execution', async () => {
    mockedDetectLoops.mockReturnValue({
      loopDetected: true,
      level: 'critical',
      type: 'generic_repeat',
      details: 'CRITICAL: 3 consecutive update_goals calls without goal state change',
    });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);

    const params = createParams();
    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'loop_detected',
        },
        sessionEndReason: 'loop_detected',
      }),
    );
    expect(mockedExecuteToolExecutionBatch).not.toHaveBeenCalled();

    const blockedEvents = (params.applyGraphEvents as jest.Mock).mock.calls.flatMap(
      ([events]) => events,
    );
    expect(blockedEvents).toContainEqual({ type: 'BLOCKED', reason: 'loop_detected' });
    // The diagnostic belongs on the observability channel, not in the conversation.
    expect(
      blockedEvents.some(
        (event: { type: string; detail?: string }) =>
          event.type === 'GRAPH_OBSERVABILITY_RECORDED' &&
          event.detail ===
            'CRITICAL: 3 consecutive update_goals calls without goal state change',
      ),
    ).toBe(true);
  });

  it('gives the user a plain terminal message instead of the loop diagnostic', async () => {
    // The loop detail is written for the run journal. Passing it through as the
    // assistant's final response leaked internal vocabulary into the chat and told
    // the user nothing about their own request.
    mockedDetectLoops.mockReturnValue({
      loopDetected: true,
      level: 'critical',
      type: 'goal_mutation_stall',
      details: 'CRITICAL: 3 consecutive update_goals calls without goal state change',
    });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);

    const params = createParams();
    await executeAgentControlGraphToolTurn(params);

    const [terminalCall] = (params.finishWithGraphTerminalEvent as jest.Mock).mock.calls;
    const content = terminalCall[0].content as string;
    expect(content).not.toContain('CRITICAL');
    expect(content).not.toContain('update_goals');
    expect(content).toContain('repeating the same step without making progress');
  });

  it('trims queued tool calls after sessions_yield before assistant staging and execution', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);
    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-1', name: 'write_file' }),
        createPendingToolCall({
          id: 'tc-2',
          name: 'sessions_yield',
          arguments: '{"status":"completed"}',
        }),
        createPendingToolCall({
          id: 'tc-3',
          name: 'read_file',
          arguments: '{"path":"after.txt"}',
        }),
      ],
    });

    await executeAgentControlGraphToolTurn(params);

    expect(params.callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Working on it',
      [
        expect.objectContaining({ id: 'tc-1', name: 'write_file' }),
        expect.objectContaining({ id: 'tc-2', name: 'sessions_yield' }),
      ],
      undefined,
      expect.any(Object),
    );
    expect(mockedExecuteToolExecutionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        executableToolCalls: [
          expect.objectContaining({ id: 'tc-1', name: 'write_file' }),
          expect.objectContaining({ id: 'tc-2', name: 'sessions_yield' }),
        ],
      }),
    );
  });

  it('makes structured clarification exclusive before assistant staging or tool execution', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([]);
    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-write', name: 'write_file' }),
        createPendingToolCall({
          id: 'tc-clarify',
          name: 'request_clarification',
          arguments: JSON.stringify({
            missing_information: [
              {
                key: 'recipient',
                required_for: 'execution',
                semantic_role: 'recipient',
              },
              {
                key: 'message_body',
                required_for: 'execution',
                semantic_role: 'content',
              },
            ],
            question: 'Who should receive the message, and what should it say?',
          }),
        }),
        createPendingToolCall({
          id: 'tc-sms',
          name: 'sms_compose',
          arguments: '{"recipients":["+15550000001"],"message":"guess"}',
        }),
      ],
    });

    await executeAgentControlGraphToolTurn(params);

    expect(params.callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Working on it',
      [
        expect.objectContaining({
          id: 'tc-clarify',
          name: 'request_clarification',
        }),
      ],
      undefined,
      expect.any(Object),
    );
    expect(mockedExecuteToolExecutionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        executableToolCalls: [
          expect.objectContaining({
            id: 'tc-clarify',
            name: 'request_clarification',
          }),
        ],
      }),
    );
  });

  it('commits code-owned effect completion goals before the tool batch begins', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolCallLifecycle.mockImplementation(async (lifecycle: any) => {
      expect(lifecycle.controlGraphGoals).toEqual([
        expect.objectContaining({
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [expect.stringMatching(/^evidence\.effect:/u)],
        }),
      ]);
      expect(
        lifecycle.workflowToolCallBlocker(lifecycle.tc.name, lifecycle.tc.arguments),
      ).toBeUndefined();
      return {
        toolCallId: lifecycle.tc.id,
        effectiveToolName: lifecycle.tc.name,
        result: '{}',
        toolMessage: createToolMessage(),
      };
    });
    mockedExecuteToolExecutionBatch.mockImplementation(async (batch: any) => [
      await batch.executePendingToolCall(batch.executableToolCalls[0], 0, {
        previewCompletedToolNames: new Set(),
      }),
    ]);
    let snapshot = { goals: [] as any[] };
    const applyGraphEvents = jest.fn((events: any[]) => {
      const goalsUpdated = events.find((event) => event.type === 'GOALS_UPDATED');
      if (goalsUpdated) snapshot = { goals: goalsUpdated.goals };
    });
    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({
          arguments: JSON.stringify({ path: 'draft.txt', content: 'done' }),
        }),
      ],
      getGraphSnapshot: () => snapshot as any,
      applyGraphEvents,
    });

    await executeAgentControlGraphToolTurn(params);

    const materialization = applyGraphEvents.mock.calls
      .flatMap(([events]) => events)
      .find((event) => event.type === 'GOALS_UPDATED');
    expect(materialization).toEqual(
      expect.objectContaining({
        reason: 'effect_completion_contract:add',
        projectToMemoryTasks: false,
        goals: [
          expect.objectContaining({
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: [expect.stringMatching(/^evidence\.effect:/u)],
          }),
        ],
      }),
    );
    expect(applyGraphEvents.mock.invocationCallOrder[0]).toBeLessThan(
      mockedExecuteToolExecutionBatch.mock.invocationCallOrder[0]!,
    );
  });

  it('projects the three-stall recovery guard into tool preflight before dispatch', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolCallLifecycle.mockImplementation(async (lifecycle: any) => {
      const blocker = lifecycle.workflowToolCallBlocker(lifecycle.tc.name, lifecycle.tc.arguments);
      expect(blocker).toContain('equivalent_strategy_stalled');
      return {
        toolCallId: lifecycle.tc.id,
        effectiveToolName: lifecycle.tc.name,
        result: blocker,
        toolMessage: {
          id: 'blocked-mobile-result',
          role: 'tool',
          content: blocker,
          toolCallId: lifecycle.tc.id,
          timestamp: 1001,
          isError: true,
        },
      };
    });
    mockedExecuteToolExecutionBatch.mockImplementation(async (batch: any) => [
      await batch.executePendingToolCall(batch.executableToolCalls[0], 0, {
        previewCompletedToolNames: new Set(),
      }),
    ]);
    const action = {
      kind: 'activate',
      target: {
        kind: 'coordinate',
        observationId: 'observation-1',
        x: 120,
        y: 220,
      },
    };
    const capability = createMobileControllerCapabilityFixture();
    const currentObservation = {
      observationId: 'observation-1',
      digest: `sha256:${'a'.repeat(64)}` as const,
      appId: 'com.example.app',
      windowId: 'main',
    };
    const initial = resolveMobileControllerRecoveryPreflight({
      toolCall: { id: 'seed', name: 'mobile_ui_action', arguments: JSON.stringify(action) },
      binding: { capability, currentObservation },
      directives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
      },
    });
    if (initial.kind !== 'allow' || !initial.directives.mobileControllerRecovery) {
      throw new Error('expected mobile strategy fingerprint');
    }
    const strategyFingerprint = initial.directives.mobileControllerRecovery.strategyFingerprint;
    const snapshot = {
      goals: [
        createGoal({
          id: 'mobile-recovery-goal',
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
      turnDirectives: {
        forceFinalText: false,
        requireWorkflowTool: false,
        incompleteFinalTextRecoveryCount: 0,
        mobileControllerRecovery: {
          version: 1,
          phase: 'tracking',
          strategyFingerprint,
          consecutiveStallCount: 3,
        },
      },
    } as any;
    const recordTurnDirectives = jest.fn();
    const params = createParams({
      availableToolNames: new Set(['mobile_ui_action']),
      runtimeToolAvailability: {
        hasWorkspaceTargets: false,
        hasBrowserControllableWorkspaceTargets: false,
        hasDelegableWorkspaceTargets: false,
        hasMobileController: true,
      },
      groundedRequestScopedTools: [MOBILE_UI_ACTION_TOOL_DEFINITION],
      pendingToolCalls: [
        { id: 'mobile-call-4', name: 'mobile_ui_action', arguments: JSON.stringify(action) },
      ],
      getGraphSnapshot: () => snapshot,
      recordTurnDirectives,
      mobileController: { capability, currentObservation },
    });
    await executeAgentControlGraphToolTurn(params);

    expect(recordTurnDirectives).toHaveBeenCalledWith(
      expect.objectContaining({
        automaticRecoveryAttemptCount: 1,
        mobileControllerRecovery: expect.objectContaining({
          phase: 'strategy_change_required',
        }),
      }),
      'mobile_controller_strategy_change_required',
    );
    expect(mockedExecuteToolCallLifecycle).toHaveBeenCalledTimes(1);
  });

  it('does not arm controller recovery when graph admission rejects the action', async () => {
    // A mobile_ui_action call sharing a turn with another tool call is always
    // rejected (an isolated-turn boundary), independent of goal state: since
    // materializeMobileControllerGoal auto-admits the first-ever call by opening
    // its own bookkeeping goal (see mobileController/goalAdmission.ts), a bare
    // missing-goal scenario no longer represents a rejected admission on its own.
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-write',
        toolMessage: createToolMessage(),
      },
      {
        index: 1,
        toolCallId: 'mobile-before-goal',
        toolMessage: {
          id: 'blocked-mobile-isolated-turn',
          role: 'tool',
          content: '{"code":"mobile_controller_isolated_turn_required"}',
          toolCallId: 'mobile-before-goal',
          timestamp: 1001,
          isError: true,
        },
      },
    ]);
    const capability = createMobileControllerCapabilityFixture();
    const currentObservation = {
      observationId: 'observation-1',
      digest: `sha256:${'a'.repeat(64)}` as const,
    };
    const params = createParams({
      availableToolNames: new Set(['write_file', 'sessions_yield', 'mobile_ui_action']),
      groundedRequestScopedTools: [...toolTurnExecutionTools, MOBILE_UI_ACTION_TOOL_DEFINITION],
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-write', name: 'write_file' }),
        {
          id: 'mobile-before-goal',
          name: 'mobile_ui_action',
          arguments: JSON.stringify({ kind: 'back' }),
        },
      ],
      getGraphSnapshot: () =>
        ({
          goals: [],
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 0,
          },
        }) as any,
      mobileController: { capability, currentObservation },
    });

    await executeAgentControlGraphToolTurn(params);

    expect(params.recordTurnDirectives).not.toHaveBeenCalledWith(
      expect.objectContaining({ mobileControllerRecovery: expect.anything() }),
      expect.any(String),
    );
  });

  it('records stagnation signatures after successful tool execution', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const stagnationSignatures: Array<{
      toolMultisetKey: string;
      goalProgressFingerprint: string;
    }> = [];
    const params = createParams({
      stagnationSignatures,
      getGraphSnapshot: () =>
        ({
          goals: [
            {
              id: 'gate-followup',
              status: 'active',
              evidence: ['write_file:artifacts/e2e.txt'],
            },
          ],
        }) as any,
    });

    await executeAgentControlGraphToolTurn(params);

    expect(stagnationSignatures).toHaveLength(1);
    expect(stagnationSignatures[0]?.toolMultisetKey).toBe('write_file');
    expect(stagnationSignatures[0]?.goalProgressFingerprint).toContain('gate-followup:active:1:');
  });

  it('blocks the run when batch settles fewer outcomes than executable tool calls', async () => {
    mockedDetectLoops.mockReturnValue({ loopDetected: false });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const params = createParams({
      pendingToolCalls: [
        createPendingToolCall({ id: 'tc-1', name: 'calendar_list' }),
        createPendingToolCall({ id: 'tc-2', name: 'calendar_events' }),
      ],
    });

    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('finalized');
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'tool_batch_incomplete',
        },
        sessionEndReason: 'tool_batch_incomplete',
      }),
    );
    expect(mockedResolveToolExecutionOutcomes).not.toHaveBeenCalled();
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GRAPH_OBSERVABILITY_RECORDED',
        observabilityType: 'TOOL_BATCH_INCOMPLETE',
        detail: 'expected:2,settled:1,unsettled:tc-2',
      }),
      {
        type: 'BLOCKED',
        reason: 'tool_batch_incomplete',
      },
    ]);
  });

  it('keeps loop-recovery as prompt guidance instead of recording workflow-tool directives', async () => {
    mockedDetectLoops.mockReturnValue({
      loopDetected: true,
      level: 'warning',
      type: 'generic_repeat',
      details: 'Repeated identical tool call',
    });
    mockedExecuteToolExecutionBatch.mockResolvedValue([
      {
        index: 0,
        toolCallId: 'tc-1',
        toolMessage: createToolMessage(),
      },
    ]);

    const params = createParams({
      warningInjectedThisRound: true,
    });
    const result = await executeAgentControlGraphToolTurn(params);

    expect(result.status).toBe('continued');
    expect(params.recordTurnDirectives).not.toHaveBeenCalled();
    expect(result.warningInjectedThisRound).toBe(true);
    expect(result.workingMessages.some((message) => message.role === 'system')).toBe(true);
  });
});
jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});
