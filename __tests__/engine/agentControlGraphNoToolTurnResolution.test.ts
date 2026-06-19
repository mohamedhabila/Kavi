import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
  type AgentControlTurnDirectives,
} from '../../src/engine/graph/agentControlGraph';
import { applyGraphScenarioEvents, buildGraphScenarioSnapshot } from './helpers/graphScenario';
import { resolveAgentControlGraphNoToolTurn } from '../../src/engine/graph/noToolTurnResolution';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import type { AgentGoal } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';
import type { ToolDefinition } from '../../src/types/tool';

const baseTurnDirectives: AgentControlTurnDirectives = {
  forceFinalText: false,
  requireWorkflowTool: false,
  incompleteFinalTextRecoveryCount: 0,
};

const tools: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Create or update files in the active workspace.',
    input_schema: { type: 'object', properties: {} },
  },
];

function createControlGraphWithGoals(goals: AgentGoal[]) {
  return reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
    { type: 'GOALS_UPDATED', goals, timestamp: Date.now() },
  ]);
}

function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
    ...overrides,
  };
}

function buildBaseParams() {
  const workingMessages: Message[] = [];
  return {
    iteration: 3,
    trackedAsyncOperations: new Map<string, TrackedAsyncOperation>(),
    consecutivePendingAsyncNoToolTurns: 0,
    turnAssistantContent: 'final answer',
    reasoning: '',
    providerReplay: undefined,
    completion: {
      completionStatus: 'complete' as const,
      finishReason: 'stop',
    },
    controlGraph: createInitialAgentControlGraphSnapshot(),
    toolingEnabledForProvider: true,
    selectedToolCount: tools.length,
    selectedToolNames: new Set(tools.map((tool) => tool.name)),
    selectedTools: tools,
    effectiveForceTextThisTurn: false,
    recoveryDirectives: baseTurnDirectives,
    nextFinalizationMaxTokens: 4096,
    workingMessages,
    applyGraphEvents: jest.fn(),
    resetIncompleteFinalTextRecovery: jest.fn(),
    recordTurnDirectives: jest.fn(),
    finishWithGraphFinalCandidateEvent: jest.fn().mockResolvedValue(undefined),
    onContinueThinking: jest.fn().mockResolvedValue(undefined),
    onFinalizationHeld: jest.fn(),
  };
}

describe('agent control graph no-tool turn resolution', () => {
  it('holds when pending async work still needs monitoring', async () => {
    const pendingOperation = createPendingOperation({ displayName: 'Build session' });
    const params = buildBaseParams();
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.consecutivePendingAsyncNoToolTurns = 1;
    params.turnAssistantContent = 'draft answer';

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 2,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'ASYNC_WAITING',
        pendingAsyncCount: 1,
      }),
    ]);
    expect(params.resetIncompleteFinalTextRecovery).toHaveBeenCalledWith(
      'async_waiting_finalization_hold',
    );
    expect(params.recordTurnDirectives).not.toHaveBeenCalled();
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('async_waiting_finalization_hold');
    expect(params.workingMessages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[SYSTEM ASYNC HOLD]'),
        expect.stringContaining('[SYSTEM ASYNC MONITOR REQUIRED]'),
        expect.stringContaining('[SYSTEM WORKFLOW JOIN REQUIRED]'),
      ]),
    );
  });

  it('keeps thinking when pending async work still blocks finalization, even with a draft reply', async () => {
    const pendingOperation = createPendingOperation({ displayName: 'Build session' });
    const params = buildBaseParams();
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.turnAssistantContent = 'STARTED_BGSTATE0607';

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('async_waiting_finalization_hold');
    expect(
      params.workingMessages.some((message) => message.content.includes('[SYSTEM ASYNC HOLD]')),
    ).toBe(true);
  });

  it('continues without finalizing when tool results are still unsettled', async () => {
    const params = buildBaseParams();
    params.controlGraph = applyGraphScenarioEvents(buildGraphScenarioSnapshot(), [
      { type: 'MODEL_TURN_STARTED', iteration: 2, toolNames: ['calendar_list', 'calendar_events'] },
      {
        type: 'MODEL_TURN_COMPLETED',
        iteration: 2,
        toolCalls: [
          { id: 'tc-calendar-list', name: 'calendar_list' },
          { id: 'tc-calendar-events', name: 'calendar_events' },
        ],
      },
      {
        type: 'TOOL_RESULT_RECORDED',
        result: { id: 'tc-calendar-list', name: 'calendar_list' },
      },
    ]);

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('unsettled_tool_results');
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GRAPH_OBSERVABILITY_RECORDED',
        observabilityType: 'TOOL_BATCH_INCOMPLETE',
        detail: 'unsettled_tool_results:tc-calendar-events',
      }),
    ]);
  });

  it('retries provider malformed function-call completions when tools are selected', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.selectedToolNames = new Set(['update_goals']);
    params.selectedToolCount = 1;
    params.completion = {
      completionStatus: 'complete',
      finishReason: 'MALFORMED_FUNCTION_CALL',
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'malformed_tool_call_retry',
      },
    ]);
    expect(params.onFinalizationHeld).toHaveBeenCalledWith({
      iteration: 3,
      holdReason: 'malformed_tool_call_retry',
      missingRequiredEvidenceLabels: [],
    });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('malformed_tool_call_retry');
    expect(params.workingMessages.at(-1)?.content).toContain('[SYSTEM TOOL CALL RETRY]');
    expect(params.workingMessages.at(-1)?.content).toContain('update_goals');
    expect(params.recordTurnDirectives).not.toHaveBeenCalled();
  });

  it('retries empty selected-tool turns after token-budget exhaustion', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.selectedToolNames = new Set(['update_goals']);
    params.selectedToolCount = 1;
    params.nextFinalizationMaxTokens = 8192;
    params.completion = {
      completionStatus: 'complete',
      finishReason: 'MAX_TOKENS',
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'empty_tool_call_retry',
      },
    ]);
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      { maxTokensOverride: 8192 },
      'empty_tool_call_retry',
    );
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('empty_tool_call_retry');
    expect(params.workingMessages.at(-1)?.content).toContain('max_tokens');
  });

  it('does not retry malformed function-call completions on passive no-tool turns', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.selectedToolNames = new Set<string>();
    params.selectedToolCount = 0;
    params.completion = {
      completionStatus: 'complete',
      finishReason: 'MALFORMED_FUNCTION_CALL',
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'FINAL_CANDIDATE_READY',
          reason: 'MALFORMED_FUNCTION_CALL',
        },
      }),
    );
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('finalizes passive no-goal turns even when goal mutation is available', async () => {
    const params = buildBaseParams();
    params.selectedToolNames = new Set(['write_file', GOAL_BOOTSTRAP_TOOL_NAME]);
    params.selectedToolCount = params.selectedToolNames.size;
    params.turnAssistantContent = 'No problem.';

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'No problem.',
        graphEvent: {
          type: 'FINAL_CANDIDATE_READY',
          reason: 'stop',
        },
      }),
    );
    expect(params.onFinalizationHeld).not.toHaveBeenCalled();
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('auto-completes goals and finalizes when update_goals is not on the turn surface', async () => {
    const goals: AgentGoal[] = [
      {
        id: 'g1',
        title: 'Build feature',
        status: 'active',
        dependencies: [],
        evidence: ['write_file:artifacts/e2e.txt'],
        successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const params = buildBaseParams();
    params.controlGraph = createControlGraphWithGoals(goals);
    params.selectedToolNames = new Set(['write_file']);

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'completion_gate:auto_complete',
      }),
    ]);
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalled();
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('auto-completes and finalizes when active goal evidence is satisfied', async () => {
    const goals: AgentGoal[] = [
      {
        id: 'g1',
        title: 'Build feature',
        status: 'active',
        dependencies: [],
        evidence: ['write_file:artifacts/e2e.txt'],
        successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const params = buildBaseParams();
    params.controlGraph = createControlGraphWithGoals(goals);
    params.selectedToolNames = new Set(['write_file', GOAL_BOOTSTRAP_TOOL_NAME]);
    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'completion_gate:auto_complete',
      }),
    ]);
    expect(params.recordTurnDirectives).not.toHaveBeenCalled();
    expect(params.onFinalizationHeld).not.toHaveBeenCalled();
    expect(params.onContinueThinking).not.toHaveBeenCalled();
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalled();
  });

  it('finalizes with default persistent pending goals when no blocking goal is active', async () => {
    const goals: AgentGoal[] = [
      {
        id: 'g1',
        title: 'Build feature',
        status: 'pending',
        dependencies: [],
        evidence: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const params = buildBaseParams();
    params.controlGraph = createControlGraphWithGoals(goals);

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.applyGraphEvents).not.toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'goals_incomplete',
      },
    ]);
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalled();
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('holds on incomplete blocking goals when no goal is active', async () => {
    const goals: AgentGoal[] = [
      {
        id: 'g1',
        title: 'Build feature',
        status: 'pending',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const params = buildBaseParams();
    params.controlGraph = createControlGraphWithGoals(goals);

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'goals_incomplete',
      },
    ]);
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('goals_incomplete');
  });

  it('holds for graph-state reconciliation after successful external tool evidence without goals', async () => {
    const params = buildBaseParams();
    params.selectedToolNames = new Set([GOAL_BOOTSTRAP_TOOL_NAME, 'calendar_list', 'memory_remember']);
    params.selectedToolCount = params.selectedToolNames.size;
    params.toolCallHistory = [
      {
        id: 'tc-calendar',
        name: 'calendar_list',
        arguments: '{}',
        timestamp: 1,
        result: JSON.stringify([{ id: 'default', allowsModifications: true }]),
      },
      {
        id: 'tc-memory',
        name: 'memory_remember',
        arguments: '{"predicate":"calendar_modifiable"}',
        timestamp: 2,
        result: JSON.stringify({ status: 'remembered' }),
      },
    ];

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'graph_state_reconciliation',
      },
    ]);
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('graph_state_reconciliation');
    expect(params.workingMessages.at(-1)?.content).toContain(
      'control graph has no recorded goal state',
    );
  });

  it('holds once when successful tool output can feed an unrun downstream tool', async () => {
    const workflowTools: ToolDefinition[] = [
      {
        name: 'calendar_create_event',
        description: 'Create a new calendar event.',
        input_schema: { type: 'object', properties: {} },
        contract: {
          produces: [{ kind: 'calendar_event' }],
        },
      },
      {
        name: 'calendar_update_event',
        description: 'Update an existing calendar event.',
        input_schema: { type: 'object', properties: {} },
        contract: {
          consumes: [{ kind: 'calendar_event' }],
        },
      },
    ];
    const params = buildBaseParams();
    params.selectedTools = workflowTools;
    params.selectedToolNames = new Set(workflowTools.map((tool) => tool.name));
    params.selectedToolCount = workflowTools.length;
    params.toolCallHistory = [
      {
        id: 'tc-calendar-create',
        name: 'calendar_create_event',
        arguments: '{"title":"Review"}',
        timestamp: 1,
        result: JSON.stringify({ status: 'created', eventId: 'evt-1' }),
      },
    ];

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'workflow_continuation',
      },
    ]);
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('workflow_continuation');
    expect(params.workingMessages.at(-1)?.content).toContain('calendar_update_event');
  });

  it('continues incomplete final text in the graph layer', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = 'partial final answer';
    params.completion = {
      completionStatus: 'incomplete',
      finishReason: 'length',
    };
    params.nextFinalizationMaxTokens = 8192;

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.applyGraphEvents).toHaveBeenCalledWith([
      {
        type: 'FINALIZATION_HELD',
        reason: 'incomplete_delivery_continuation',
      },
    ]);
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      expect.objectContaining({
        forceFinalText: true,
        forcedTextReason: 'incomplete_delivery_continuation',
        maxTokensOverride: 8192,
        incompleteFinalTextRecoveryCount: 1,
        incompleteFinalTextContinuationPrefix: 'partial final answer',
      }),
      'incomplete_delivery_continuation',
    );
    expect(params.workingMessages.at(-2)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'partial final answer',
      }),
    );
    expect(params.workingMessages.at(-1)?.content).toContain('[SYSTEM FINAL ANSWER CONTINUE]');
    expect(params.onContinueThinking).toHaveBeenCalledWith('incomplete_delivery_continuation');
  });

  it('finalizes the run when no graph-side recovery is needed', async () => {
    const params = buildBaseParams();

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.resetIncompleteFinalTextRecovery).toHaveBeenCalledWith('finalization_complete');
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'FINAL_CANDIDATE_READY',
          reason: 'stop',
        },
        content: 'final answer',
        sessionEndReason: 'final_candidate_ready',
      }),
    );
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });
});
