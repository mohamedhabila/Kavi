import { applyGraphScenarioEvents, buildGraphScenarioSnapshot } from './helpers/graphScenario';
import { resolveAgentControlGraphNoToolTurn } from '../../src/engine/graph/noToolTurnResolution';
import {
  baseTurnDirectives,
  buildBaseParams,
  createPendingOperation,
} from './helpers/noToolTurnResolution';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import {
  projectRequestUnderstanding,
  summarizeRequestUnderstanding,
} from '../../src/services/agents/requestUnderstandingProjection';

describe('agent control graph no-tool turn resolution', () => {
  it('gives an actionable agentic request one language-neutral recovery pass', async () => {
    const params = buildBaseParams();
    const requestFrame = buildGraphEntryRequestFrame({
      text: 'Disable the named scheduled task.',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'new',
    });
    params.controlGraph = buildGraphScenarioSnapshot({
      requestUnderstanding: summarizeRequestUnderstanding(
        projectRequestUnderstanding({ requestFrame, goals: [] }),
      ),
    });
    params.selectedToolNames = new Set(['request_clarification', 'cron']);
    params.selectedToolCount = params.selectedToolNames.size;
    params.turnAssistantContent = 'I need the internal task identifier.';
    params.modelTurnAssistantContent = params.turnAssistantContent;

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('no_tool_progress_retry');
    expect(params.workingMessages.at(-1)?.content).toContain(
      'do not ask the user for an internal identifier',
    );
    expect(params.workingMessages.at(-1)?.content).toContain(
      'Do not manufacture an external action, consent need, or required user detail',
    );
    expect(params.workingMessages.at(-1)?.content).toContain(
      'preserve its substance and return it directly',
    );
  });

  it('holds when pending async work still needs monitoring', async () => {
    const pendingOperation = createPendingOperation({ displayName: 'Build session' });
    const params = buildBaseParams();
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.consecutivePendingAsyncNoToolTurns = 1;
    params.turnAssistantContent = 'draft answer';
    params.modelTurnAssistantContent = 'draft answer';

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
    params.modelTurnAssistantContent = 'STARTED_BGSTATE0607';

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

  it('does not block an empty recovery turn while tracked async work is still pending', async () => {
    const pendingOperation = createPendingOperation({ displayName: 'Background lookup' });
    const params = buildBaseParams();
    params.trackedAsyncOperations = new Map([[pendingOperation.key, pendingOperation]]);
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
    params.recoveryDirectives = {
      ...baseTurnDirectives,
      incompleteFinalTextRecoveryCount: 1,
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 1,
    });
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('async_waiting_finalization_hold');
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
    params.modelTurnAssistantContent = '';
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
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      { incompleteFinalTextRecoveryCount: 1 },
      'malformed_tool_call_retry',
    );
  });

  it('retries empty selected-tool turns after token-budget exhaustion', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
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
      {
        maxTokensOverride: 8192,
        incompleteFinalTextRecoveryCount: 1,
      },
      'empty_tool_call_retry',
    );
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.onContinueThinking).toHaveBeenCalledWith('empty_tool_call_retry');
    expect(params.workingMessages.at(-1)?.content).toContain('max_tokens');
  });

  it('retries an empty passive turn with tools kept disabled', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
    params.selectedToolNames = new Set<string>();
    params.selectedToolCount = 0;
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
        reason: 'empty_response_retry',
      },
    ]);
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        incompleteFinalTextRecoveryCount: 1,
      },
      'empty_response_retry',
    );
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.workingMessages.at(-1)?.content).toContain('[SYSTEM EMPTY RESPONSE RETRY]');
    expect(params.workingMessages.at(-1)?.content).toContain('Tools are unavailable');
    expect(params.onContinueThinking).toHaveBeenCalledWith('empty_response_retry');
  });

  it('grounds an empty-response recovery in completed tool results without repeating failed tools', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
    params.effectiveForceTextThisTurn = true;
    params.selectedToolNames = new Set<string>();
    params.selectedToolCount = 0;
    params.toolCallHistory = [
      {
        id: 'contacts-1',
        name: 'contacts_search',
        arguments: '{"query":"Avery"}',
        timestamp: 1,
        status: 'completed',
        result: '{"contacts":[{"name":"Avery"}]}',
      },
      {
        id: 'calendar-1',
        name: 'calendar_create',
        arguments: '{}',
        timestamp: 2,
        status: 'failed',
        result: '{"error":"permission_denied"}',
      },
      {
        id: 'sms-1',
        name: 'sms_compose',
        arguments: '{"recipients":["+15550000001"],"message":"Running late"}',
        timestamp: 3,
        status: 'completed',
        result: '{"status":"sms_composer_opened"}',
      },
    ];

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    const recoveryPrompt = params.workingMessages.at(-1)?.content ?? '';
    expect(recoveryPrompt).toContain(
      'Code-owned execution already recorded these tools as completed: contacts_search, sms_compose.',
    );
    expect(recoveryPrompt).toContain('Treat their tool-result messages as the source of truth');
    expect(recoveryPrompt).not.toContain('calendar_create');
  });

  it('retries provider tool-call markup emitted during a forced final delivery', async () => {
    const params = buildBaseParams();
    const rawToolMarkup = [
      '<tool_call>',
      '<function=read_file>',
      '<parameter=path>',
      'artifacts/week-plan.txt',
      '</parameter>',
      '</function>',
      '</tool_call>',
    ].join('\n');
    params.turnAssistantContent = rawToolMarkup;
    params.modelTurnAssistantContent = rawToolMarkup;
    params.effectiveForceTextThisTurn = true;
    params.selectedToolNames = new Set<string>();
    params.selectedToolCount = 0;

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
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        incompleteFinalTextRecoveryCount: 1,
      },
      'malformed_tool_call_retry',
    );
    expect(params.workingMessages.at(-1)?.content).toContain(
      '[SYSTEM INVALID FINAL RESPONSE RETRY]',
    );
    expect(params.workingMessages.at(-1)?.content).toContain('verified tool results');
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
  });

  it('blocks raw tool markup after one final-delivery recovery', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '<tool_call><function=calendar_events></function></tool_call>';
    params.modelTurnAssistantContent = params.turnAssistantContent;
    params.effectiveForceTextThisTurn = true;
    params.selectedToolNames = new Set<string>();
    params.selectedToolCount = 0;
    params.recoveryDirectives = {
      ...baseTurnDirectives,
      forceFinalText: true,
      forcedTextReason: 'empty_delivery_recovery',
      incompleteFinalTextRecoveryCount: 1,
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'empty_final_text_after_recovery',
        },
        content: expect.stringContaining('no usable response'),
      }),
    );
  });

  it('escalates the token budget for an empty forced-text exhaustion recovery', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
    params.effectiveForceTextThisTurn = true;
    params.nextFinalizationMaxTokens = 8192;
    params.completion = {
      completionStatus: 'incomplete',
      finishReason: 'MAX_TOKENS',
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      {
        forceFinalText: true,
        forcedTextReason: 'empty_delivery_recovery',
        maxTokensOverride: 8192,
        incompleteFinalTextRecoveryCount: 1,
      },
      'empty_response_retry',
    );
  });

  it('retries one ordinary empty stop with selected tools still available', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '   ';
    params.modelTurnAssistantContent = '   ';
    params.selectedToolNames = new Set(['contacts_search']);
    params.selectedToolCount = 1;

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({
      status: 'continued',
      nextConsecutivePendingAsyncNoToolTurns: 0,
    });
    expect(params.recordTurnDirectives).toHaveBeenCalledWith(
      { incompleteFinalTextRecoveryCount: 1 },
      'empty_response_retry',
    );
    expect(params.workingMessages.at(-1)?.content).toContain('contacts_search');
    expect(params.workingMessages.at(-1)?.content).toContain('Continue the current request');
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).not.toHaveBeenCalled();
  });

  it('blocks visibly after one empty-response recovery instead of finalizing empty', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = '';
    params.modelTurnAssistantContent = '';
    params.recoveryDirectives = {
      ...baseTurnDirectives,
      incompleteFinalTextRecoveryCount: 1,
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'empty_final_text_after_recovery',
        },
        content: expect.stringContaining('no usable response'),
        assistantMetadata: expect.objectContaining({
          completionStatus: 'incomplete',
          finishReason: 'empty_final_text_after_recovery',
        }),
        sessionEndReason: 'empty_final_text_after_recovery',
      }),
    );
    expect(params.onContinueThinking).not.toHaveBeenCalled();
  });

  it('does not let a prior continuation prefix mask an empty recovery response', async () => {
    const params = buildBaseParams();
    params.turnAssistantContent = 'partial final answer';
    params.modelTurnAssistantContent = '';
    params.recoveryDirectives = {
      ...baseTurnDirectives,
      forceFinalText: true,
      forcedTextReason: 'incomplete_delivery_continuation',
      incompleteFinalTextRecoveryCount: 1,
      incompleteFinalTextContinuationPrefix: 'partial final answer',
    };

    const result = await resolveAgentControlGraphNoToolTurn(params);

    expect(result).toEqual({ status: 'finalized' });
    expect(params.finishWithGraphFinalCandidateEvent).not.toHaveBeenCalled();
    expect(params.finishWithGraphTerminalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        graphEvent: {
          type: 'BLOCKED',
          reason: 'empty_final_text_after_recovery',
        },
      }),
    );
  });
});
