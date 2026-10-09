import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentGoal, AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';
import type { AgentControlGraphEvent } from '../../../src/engine/graph/agentControlGraph';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import type { ToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeResolution';
import {
  executeUpdateGoals,
  isGoallessUpdateGoalsCall,
  parseUpdateGoalsArgs,
} from '../../../src/engine/tools/toolGoalExecution';

const ACTIVE_GOAL: AgentGoal = {
  id: 'write-release',
  title: 'Write the release file',
  status: 'active',
  completionPolicy: 'blocking',
  successCriteria: ['evidence.artifact:artifacts/release.txt'],
  dependencies: [],
  evidence: [],
  createdAt: 1,
  updatedAt: 1,
};

function outcomeFor(argumentsJson: string, content: string, isError = false): ToolExecutionOutcome {
  const toolCallId = 'tc-update-goals';
  const toolMessage: Message = {
    id: 'msg-tool-result',
    role: 'tool',
    content,
    timestamp: Date.now(),
    attachments: [],
    toolCallId,
    ...(isError ? { isError: true } : {}),
    toolCalls: [
      { id: toolCallId, name: 'update_goals', arguments: argumentsJson, status: 'completed' },
    ],
  } as Message;
  return { index: 0, toolCallId, toolMessage };
}

function canonicalize(args: Record<string, unknown>, goals: AgentGoal[] = []) {
  const snapshotRef: { current: AgentRunControlGraphState } = {
    current: createInitialAgentRunControlGraphState({ goals }),
  };
  const events: AgentControlGraphEvent[] = [];
  const executed = executeUpdateGoals(args, goals);
  const outcome = canonicalizeToolExecutionOutcome({
    outcome: outcomeFor(
      JSON.stringify(args),
      executed.toolMessage?.content ?? '{"status":"ok"}',
      executed.status === 'failed',
    ),
    toolName: 'update_goals',
    executableToolCalls: [{ name: 'update_goals', arguments: JSON.stringify(args) }],
    getGraphSnapshot: () => snapshotRef.current,
    applyGraphEvents: (applied) => events.push(...applied),
    conversationId: 'conv-test',
    warn: jest.fn(),
  });
  return { executed, outcome, events };
}

describe('update_goals call that names no goal', () => {
  it.each([
    [{ action: 'add' }],
    [{ action: 'add', goals: [] }],
    [{ action: 'add', retainCurrentUserConstraint: true }],
    [{ action: 'complete', goals: null }],
  ])('is goal-less: %j', (args) => {
    expect(isGoallessUpdateGoalsCall(args)).toBe(true);
    expect(parseUpdateGoalsArgs(args)).toEqual({
      mutation: { action: args.action, goals: [] },
      errors: [],
    });
  });

  it.each([
    [{ action: 'add', name: 'Ship it' }],
    [{ action: 'add', goals: [{ id: 'a' }] }],
    [{ action: 'complete', id: 'a' }],
  ])('still parses as a goal mutation when it names one: %j', (args) => {
    expect(isGoallessUpdateGoalsCall(args)).toBe(false);
  });

  it('keeps rejecting an unknown action, which no goal content can rescue', () => {
    expect(parseUpdateGoalsArgs({ action: 'bogus' }).errors[0]?.code).toBe('invalid_action');
  });

  it('answers with the current goals and changes nothing, instead of a repair the model cannot use', () => {
    // Regression: 21 of 23 rejected update_goals calls in a measured live run were a bare
    // {"action":"add"}; each rejection repeated a repair template until loop detection
    // blocked the run before the requested file was ever written.
    const { executed, outcome, events } = canonicalize({ action: 'add' }, [ACTIVE_GOAL]);

    expect(executed.status).toBe('completed');
    const content = JSON.parse(outcome.toolMessage.content);
    expect(content).toMatchObject({
      status: 'ok',
      action: 'add',
      goals: [expect.objectContaining({ id: 'write-release' })],
      note: expect.stringContaining('named no goal'),
    });
    expect(content).not.toHaveProperty('repair');
    expect(outcome.graphApplied).toBe(false);
    expect(events).toEqual([]);
  });

  it('still rejects a goal that is missing its id', () => {
    const { outcome } = canonicalize({
      action: 'add',
      name: 'Ship it',
      completionPolicy: 'blocking',
    });

    expect(JSON.parse(outcome.toolMessage.content)).toMatchObject({
      status: 'error',
      structuredErrors: [expect.objectContaining({ code: 'missing_id' })],
    });
  });
});
