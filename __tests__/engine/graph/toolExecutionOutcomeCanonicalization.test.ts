import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { AgentControlGraphEvent } from '../../../src/engine/graph/agentControlGraph';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import type { ToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeResolution';

function makeUpdateGoalsOutcome(): ToolExecutionOutcome {
  const toolCallId = 'tc-update-goals';
  const toolMessage: Message = {
    id: 'msg-tool-result',
    role: 'tool',
    content: '{"status":"ok"}',
    timestamp: Date.now(),
    attachments: [],
    toolCallId,
    toolCalls: [
      {
        id: toolCallId,
        name: 'update_goals',
        arguments: '{}',
        status: 'completed',
      },
    ],
  };

  return {
    index: 0,
    toolCallId,
    toolMessage,
  };
}

function applyGraphEvents(
  snapshotRef: { current: AgentRunControlGraphState },
  events: ReadonlyArray<AgentControlGraphEvent>,
): void {
  for (const event of events) {
    if (event.type === 'GOALS_UPDATED') {
      snapshotRef.current = createInitialAgentRunControlGraphState({
        ...snapshotRef.current,
        goals: event.goals,
      });
    }
  }
}

describe('canonicalizeToolExecutionOutcome', () => {
  it('reconciles newly added blocking goals with prior observed tool evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [{ id: 'calendar-result-1', name: 'calendar_list' }],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1', 'evidence.tool:calendar_list'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(outcome.toolMessage.isError).toBeUndefined();
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: ['calendar_list:observed_result:calendar-result-1'],
    });
  });

  it('does not reconcile failed observed tool results into new goals', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [{ id: 'calendar-result-1', name: 'calendar_list', failed: true }],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1', 'evidence.tool:calendar_list'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'active',
      evidence: [],
    });
  });

  it('reconciles JSON-field criteria from prior observed tool evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        observedToolResults: [
          {
            id: 'calendar-result-1',
            name: 'calendar_list',
            evidence: ['calendar_list:{"allowsModifications":true}'],
          },
        ],
      }),
    };
    const args = {
      action: 'add',
      id: 'calendar-verify',
      name: 'Verify calendar state',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.json_field:allowsModifications:true'],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: ['calendar_list:{"allowsModifications":true}'],
    });
  });

  it('reconciles update criteria with prior tool history evidence', () => {
    const snapshotRef = {
      current: createInitialAgentRunControlGraphState({
        goals: [
          {
            id: 'calendar-verify',
            title: 'Verify calendar state',
            status: 'active',
            completionPolicy: 'blocking',
            dependencies: [],
            evidence: ['calendar_list returned allowsModifications'],
            successCriteria: ['evidence.tool:calendar_list'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    };
    const args = {
      action: 'update',
      id: 'calendar-verify',
      successCriteria: [
        'evidence.tool:calendar_list',
        'evidence.json_field:allowsModifications:true',
      ],
    };

    const outcome = canonicalizeToolExecutionOutcome({
      outcome: makeUpdateGoalsOutcome(),
      toolName: 'update_goals',
      executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
      toolCallHistory: [
        {
          id: 'tc-calendar-list',
          name: 'calendar_list',
          arguments: '{}',
          timestamp: 1,
          result: '[{"id":"default","allowsModifications":true}]',
        },
      ],
      getGraphSnapshot: () => snapshotRef.current,
      applyGraphEvents: (events) => applyGraphEvents(snapshotRef, events),
      conversationId: 'conv-test',
      warn: jest.fn(),
    });

    expect(outcome.graphApplied).toBe(true);
    expect(snapshotRef.current.goals?.[0]).toMatchObject({
      id: 'calendar-verify',
      status: 'completed',
      evidence: expect.arrayContaining([
        'calendar_list returned allowsModifications',
        'calendar_list:[{"id":"default","allowsModifications":true}]',
      ]),
    });
  });
});
