import { evaluateE2ERubric } from '../../src/acceptance/e2eAgent/rubricEvaluators';
import type { E2ERubric, E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { buildRequestClarificationToolResult } from '../../src/services/agents/requestClarification';

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

type TurnTrace = E2EScenarioResult['turnTraces'][number];

function buildTurn(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnIndex: 1,
    lifecycleBefore: {
      boundary: 'app_relaunch',
      chatStore: 'rehydrated',
      memoryStore: 'reopened',
    },
    user: { messageId: 'user-1', text: 'Continue.', timestamp: 10 },
    route: { directive: 'forced_chitchat', mode: 'chitchat', personaId: 'default' },
    finalAssistant: {
      messageId: 'assistant-1',
      text: 'Done.',
      timestamp: 11,
      completionStatus: 'complete',
      finishReason: 'stop',
      terminalReason: null,
    },
    finalAssistantCandidateCount: 1,
    completion: {
      assistantStatus: 'complete',
      executionCompleted: true,
      finalResponseCompleted: true,
      runStatus: 'not_applicable',
      runCompleted: null,
      runCompletedAt: null,
      runTerminalReason: null,
      graphStatus: null,
      graphTerminalReason: null,
    },
    agentRun: null,
    memoryExtractionSettled: true,
    memoryExtractionWaitMs: 0,
    native: { stateBefore: {}, stateAfter: {}, invocations: [] } as TurnTrace['native'],
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    },
    completed: true,
    ...overrides,
  };
}

function buildResult(turn: TurnTrace = buildTurn()): E2EScenarioResult {
  return {
    contentClass: 'synthetic_public',
    fixtureId: 'stage-attribution',
    conversationId: 'conversation-1',
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    memoryItems: { capturedAt: 1, items: [], indexedTurnCount: 0 },
    turnTraces: [turn],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
    },
    errors: [],
    completed: true,
    durationMs: 2,
    userTurnCount: 1,
  };
}

describe('turn stage-attribution rubrics', () => {
  it('checks an exact opaque token in the attributed final response', () => {
    const result = buildResult(
      buildTurn({
        turnIndex: 2,
        finalAssistant: {
          messageId: 'assistant-2',
          text: 'The completed outcome was OUTCOME-CONTINUITY-E2E-42.',
          timestamp: 12,
          completionStatus: 'complete',
          finishReason: 'stop',
          terminalReason: null,
        },
      }),
    );

    expect(
      evaluateE2ERubric(result, {
        kind: 'turn_final_response_token',
        turnIndex: 2,
        token: 'OUTCOME-CONTINUITY-E2E-42',
      }),
    ).toEqual(
      expect.objectContaining({
        fixtureId: 'stage-attribution:turn-2:turn_final_response_token',
        passed: true,
      }),
    );
    expect(
      evaluateE2ERubric(result, {
        kind: 'turn_final_response_token',
        turnIndex: 2,
        token: 'WRONG-OUTCOME-E2E-42',
      }),
    ).toEqual(
      expect.objectContaining({
        passed: false,
        detail: 'turn 2 exact final response token missing',
      }),
    );
  });

  it('rejects invalid final response token expectations', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_final_response_token',
        turnIndex: 1,
        token: ' padded-token ',
      }),
    ).toEqual(
      expect.objectContaining({
        passed: false,
        detail: 'turn 1 final response token expectation is invalid',
      }),
    );
  });

  it('grades structured missing-field clarification independently of user-facing language', () => {
    const rubric = {
      kind: 'turn_clarification',
      turnIndex: 1,
      requiredMissingInformation: [{ semanticRole: 'time' }],
    } as const;
    const question = 'ما الوقت الجديد الذي تريده لبداية الموعد؟';
    const clarificationResult = JSON.stringify(
      buildRequestClarificationToolResult({
        fields: [
          {
            key: 'new_start_time',
            requiredFor: 'execution',
            semanticRole: 'time',
          },
        ],
        question,
      }),
    );
    const structured = buildResult(
      buildTurn({
        finalAssistant: {
          ...buildTurn().finalAssistant!,
          text: `I need one detail before acting.\n\n${question}`,
        },
        toolCalls: [
          {
            id: 'tc-clarify',
            name: 'request_clarification',
            arguments: JSON.stringify({
              missing_information: [
                {
                  key: 'new_start_time',
                  required_for: 'execution',
                  semantic_role: 'time',
                },
              ],
              question,
            }),
          },
        ],
        toolResults: [
          {
            toolCallId: 'tc-clarify',
            name: 'request_clarification',
            content: clarificationResult,
            isError: false,
          },
        ],
      }),
    );

    expect(evaluateE2ERubric(structured, rubric)).toMatchObject({
      fixtureId: 'stage-attribution:turn-1:turn_clarification',
      passed: true,
      detail: 'turn 1 clarification requested information: time:*',
    });
    expect(
      evaluateE2ERubric(
        buildResult(
          buildTurn({
            finalAssistant: {
              ...buildTurn().finalAssistant!,
              text: 'Please provide a new start time.',
            },
          }),
        ),
        rubric,
      ),
    ).toMatchObject({
      passed: false,
      detail: 'turn 1 did not record a valid structured clarification request',
    });
    expect(
      evaluateE2ERubric(
        buildResult(
          buildTurn({
            ...structured.turnTraces[0],
            finalAssistant: {
              ...structured.turnTraces[0]!.finalAssistant!,
              text: 'A different question.',
            },
          }),
        ),
        rubric,
      ),
    ).toMatchObject({
      passed: false,
      detail: 'turn 1 did not deliver the registered clarification question',
    });
  });

  it('grades the clarification a turn recorded after the tool refused an earlier call', () => {
    const rubric = {
      kind: 'turn_clarification',
      turnIndex: 1,
      requiredMissingInformation: [{ semanticRole: 'recipient' }],
    } as const;
    const question = 'Who should the message go to?';
    const refused = JSON.stringify({
      status: 'error',
      code: 'missing_required_argument',
      tool: 'request_clarification',
      missingRequiredArguments: ['missing_information'],
    });
    const recorded = JSON.stringify(
      buildRequestClarificationToolResult({
        fields: [{ key: 'recipient', requiredFor: 'execution', semanticRole: 'recipient' }],
        question,
      }),
    );
    const result = buildResult(
      buildTurn({
        finalAssistant: { ...buildTurn().finalAssistant!, text: question },
        toolCalls: [
          {
            id: 'tc-refused',
            name: 'request_clarification',
            arguments: JSON.stringify({ question }),
          },
          {
            id: 'tc-recorded',
            name: 'request_clarification',
            arguments: JSON.stringify({
              missing_information: [
                { key: 'recipient', required_for: 'execution', semantic_role: 'recipient' },
              ],
              question,
            }),
          },
        ],
        toolResults: [
          {
            toolCallId: 'tc-refused',
            name: 'request_clarification',
            content: refused,
            isError: true,
          },
          {
            toolCallId: 'tc-recorded',
            name: 'request_clarification',
            content: recorded,
            isError: false,
          },
        ],
      }),
    );

    expect(evaluateE2ERubric(result, rubric)).toMatchObject({
      passed: true,
      detail: 'turn 1 clarification requested information: recipient:*',
    });
  });

  it('proves exact per-turn native invocation absence and detects an attempted update', () => {
    const rubric = {
      kind: 'turn_native_invocation_count',
      turnIndex: 1,
      toolName: 'calendar_update_event',
      expectedCount: 0,
    } as const;
    expect(evaluateE2ERubric(buildResult(), rubric)).toMatchObject({
      fixtureId: 'stage-attribution:turn-1:calendar_update_event:turn_native_invocation_count',
      passed: true,
    });
    const attempted = buildTurn({
      native: {
        ...buildTurn().native,
        invocations: [{ toolName: 'calendar_update_event' }] as TurnTrace['native']['invocations'],
      },
    });
    expect(evaluateE2ERubric(buildResult(attempted), rubric)).toMatchObject({
      passed: false,
      detail: 'turn 1 native invocation count 1 (expected 0)',
    });
  });

  it('counts model-requested tools on the exact turn and classifies producer effects fail-closed', () => {
    const passiveTurn = buildTurn({
      turnIndex: 0,
      toolCalls: [{ id: 'read-1', name: 'read_file', arguments: '{"path":"notes.txt"}' }],
    });
    const result = {
      ...buildResult(),
      turnTraces: [passiveTurn, buildTurn({ turnIndex: 1 })],
    };

    expect(
      evaluateE2ERubric(result, {
        kind: 'turn_tool_call_count',
        turnIndex: 0,
        scope: 'all',
        expectedCount: 0,
      }),
    ).toMatchObject({
      fixtureId: 'stage-attribution:turn-0:all:turn_tool_call_count',
      passed: false,
      detail: 'turn 0 all tool call count 1 (expected 0)',
    });
    expect(
      evaluateE2ERubric(result, {
        kind: 'turn_tool_call_count',
        turnIndex: 0,
        scope: 'side_effectful',
        expectedCount: 0,
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateE2ERubric(result, {
        kind: 'turn_tool_call_count',
        turnIndex: 1,
        scope: 'all',
        expectedCount: 0,
      }),
    ).toMatchObject({ passed: true });

    for (const name of ['write_file', 'mcp__unclassified__mutate']) {
      const toolCallId = `effect-${name}`;
      const effectful = buildResult(
        buildTurn({
          toolCalls: [{ id: toolCallId, name, arguments: '{}' }],
          toolResults: [{ toolCallId, name, content: '{"status":"completed"}', isError: false }],
        }),
      );
      expect(
        evaluateE2ERubric(effectful, {
          kind: 'turn_tool_call_count',
          turnIndex: 1,
          scope: 'side_effectful',
          expectedCount: 0,
        }),
      ).toMatchObject({
        passed: false,
        detail: 'turn 1 side_effectful tool call count 1 (expected 0)',
      });
    }
  });

  it('rejects invalid turn tool-call expectations', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_tool_call_count',
        turnIndex: 1,
        scope: 'all',
        expectedCount: -1,
      }),
    ).toMatchObject({
      passed: false,
      detail: 'turn 1 tool call expectation is invalid',
    });
  });

  it('grades the actual route directive and resolved mode for the requested turn', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_route',
        turnIndex: 1,
        directive: 'forced_chitchat',
        mode: 'chitchat',
      }),
    ).toMatchObject({ passed: true });

    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_route',
        turnIndex: 1,
        directive: 'production_auto',
        mode: 'chitchat',
      }),
    ).toMatchObject({ passed: false });
  });

  it('grades execution, final response, and nullable agent-run completion independently', () => {
    expect([
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        field: 'execution',
        expected: true,
      }),
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        field: 'final_response',
        expected: true,
      }),
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        field: 'agent_run',
        expected: null,
      }),
    ]).toEqual([
      expect.objectContaining({
        fixtureId: 'stage-attribution:turn-1:turn_completion:execution',
        passed: true,
      }),
      expect.objectContaining({
        fixtureId: 'stage-attribution:turn-1:turn_completion:final_response',
        passed: true,
      }),
      expect.objectContaining({
        fixtureId: 'stage-attribution:turn-1:turn_completion:agent_run',
        passed: true,
      }),
    ]);

    const runTurn = buildTurn({
      completion: {
        ...buildTurn().completion,
        runStatus: 'completed',
        runCompleted: true,
        runCompletedAt: 12,
      },
    });
    expect(
      evaluateE2ERubric(buildResult(runTurn), {
        kind: 'turn_completion',
        turnIndex: 1,
        field: 'agent_run',
        expected: true,
      }),
    ).toMatchObject({
      fixtureId: 'stage-attribution:turn-1:turn_completion:agent_run',
      passed: true,
    });
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_completion',
        turnIndex: 1,
        field: 'final_response',
        expected: false,
      }),
    ).toMatchObject({
      fixtureId: 'stage-attribution:turn-1:turn_completion:final_response',
      passed: false,
    });
  });

  it('rejects null expectations for boolean-only completion fields', () => {
    const invalidRubric = {
      kind: 'turn_completion',
      turnIndex: 1,
      field: 'execution',
      expected: null,
    } as unknown as E2ERubric;

    expect(evaluateE2ERubric(buildResult(), invalidRubric)).toMatchObject({
      fixtureId: 'stage-attribution:turn-1:turn_completion:execution',
      passed: false,
      detail: 'turn completion field execution has an invalid expected value',
    });
  });

  it('requires an observed, fully reopened app-relaunch boundary on the exact turn', () => {
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: true });

    expect(
      evaluateE2ERubric(buildResult(buildTurn({ lifecycleBefore: null })), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: false });
    expect(
      evaluateE2ERubric(buildResult(), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 2,
        boundary: 'app_relaunch',
      }),
    ).toMatchObject({ passed: false });
  });

  it('requires code-owned proof that a new conversation began without raw history', () => {
    const freshTurn = buildTurn({
      lifecycleBefore: {
        boundary: 'new_conversation',
        chatStore: 'fresh_conversation',
        memoryStore: 'shared_global',
        previousConversationMessageCount: 4,
        newConversationInitialMessageCount: 0,
      },
    });
    expect(
      evaluateE2ERubric(buildResult(freshTurn), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'new_conversation',
      }),
    ).toMatchObject({ passed: true });

    const pollutedTurn = buildTurn({
      lifecycleBefore: {
        ...freshTurn.lifecycleBefore!,
        newConversationInitialMessageCount: 1,
      } as never,
    });
    expect(
      evaluateE2ERubric(buildResult(pollutedTurn), {
        kind: 'turn_lifecycle_boundary',
        turnIndex: 1,
        boundary: 'new_conversation',
      }),
    ).toMatchObject({ passed: false });
  });
});
