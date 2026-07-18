import { GOAL_BOOTSTRAP_TOOL_NAME } from '../../src/engine/goals/bootstrap';
import { resolveAgentControlGraphNoToolTurn } from '../../src/engine/graph/noToolTurnResolution';
import type { AgentGoal } from '../../src/types/agentRun';
import type { ToolDefinition } from '../../src/types/tool';
import { buildBaseParams, createControlGraphWithGoals } from './helpers/noToolTurnResolution';

describe('agent control graph no-tool finalization', () => {
  it('delivers exhausted recovery text without marking the task successful', async () => {
    const params = buildBaseParams();
    params.effectiveForceTextThisTurn = true;
    params.recoveryDirectives = {
      ...params.recoveryDirectives,
      forceFinalText: true,
      forcedTextReason: 'execution_loop_recovery',
      automaticRecoveryAttemptCount: 1,
    };
    params.turnAssistantContent = 'I could not verify the requested mobile changes.';
    params.modelTurnAssistantContent = params.turnAssistantContent;

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: { type: 'BLOCKED', reason: 'execution_loop_recovery' },
        content: params.turnAssistantContent,
        assistantMetadata: expect.objectContaining({ completionStatus: 'incomplete' }),
        sessionEndReason: 'execution_loop_recovery',
      }),
    );
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
  });

  it('finalizes passive no-goal turns even when goal mutation is available', async () => {
    const params = buildBaseParams();
    params.selectedToolNames = new Set(['write_file', GOAL_BOOTSTRAP_TOOL_NAME]);
    params.selectedToolCount = params.selectedToolNames.size;
    params.turnAssistantContent = 'No problem.';
    params.modelTurnAssistantContent = 'No problem.';

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

  it('finalizes after successful read-only evidence when no goal is required', async () => {
    const params = buildBaseParams();
    params.selectedToolNames = new Set([
      GOAL_BOOTSTRAP_TOOL_NAME,
      'calendar_list',
      'memory_recall',
    ]);
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
        name: 'memory_recall',
        arguments: '{"query":"calendar preferences"}',
        timestamp: 2,
        result: JSON.stringify({ facts: [] }),
      },
    ];

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledTimes(1);
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('does not infer an unrequested downstream action from tool compatibility alone', async () => {
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

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).toHaveBeenCalledTimes(1);
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('continues incomplete final text in the graph layer', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = 'partial final answer';
    params.modelTurnAssistantContent = 'partial final answer';
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
