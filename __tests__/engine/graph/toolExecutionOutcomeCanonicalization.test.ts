import { reduceAgentControlGraph } from '../../../src/engine/graph/agentControlGraph';
import type { AgentControlGraphEvent } from '../../../src/engine/graph/agentControlGraph';
import { canonicalizeToolExecutionOutcome } from '../../../src/engine/graph/toolExecutionOutcomeCanonicalization';
import {
  executeUpdatePlan,
  PLAN_UPDATED_RESULT,
} from '../../../src/engine/tools/toolPlanExecution';
import { parseToolArgumentsJson } from '../../../src/engine/toolExecution/toolArgumentJsonRecovery';
import { createInitialAgentRunControlGraphState } from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';
import type { Message } from '../../../src/types/message';

function toolOutcome(params: { toolName: string; argumentsJson: string; isError?: boolean }) {
  const toolCallId = 'tc-1';
  const toolMessage: Message = {
    id: 'msg-tool-result',
    role: 'tool',
    content: params.isError ? 'Error: bad plan' : PLAN_UPDATED_RESULT,
    timestamp: 1,
    attachments: [],
    toolCallId,
    ...(params.isError ? { isError: true } : {}),
  };
  return { index: 0, toolCallId, toolMessage };
}

function canonicalize(params: { toolName: string; argumentsJson: string; isError?: boolean }) {
  const graph: { current: AgentRunControlGraphState } = {
    current: createInitialAgentRunControlGraphState(),
  };
  const applied: AgentControlGraphEvent[] = [];
  const outcome = canonicalizeToolExecutionOutcome({
    outcome: toolOutcome(params),
    toolName: params.toolName,
    executableToolCalls: [{ name: params.toolName, arguments: params.argumentsJson }],
    applyGraphEvents: (events) => {
      applied.push(...events);
      graph.current = reduceAgentControlGraph(graph.current as never, events) as never;
    },
  });
  return { outcome, applied, graph: graph.current };
}

describe('canonicalizing an update_plan outcome', () => {
  it('records the plan the model stated on the graph', () => {
    const plan = [
      { step: 'Find flights', status: 'completed' },
      { step: 'Book the hotel', status: 'in_progress' },
    ];
    const { outcome, graph } = canonicalize({
      toolName: 'update_plan',
      argumentsJson: JSON.stringify({ plan }),
    });

    expect(outcome).toEqual(expect.objectContaining({ canonicalized: true, graphApplied: true }));
    expect(outcome.toolMessage.content).toBe(PLAN_UPDATED_RESULT);
    expect(graph.plan).toEqual(plan);
  });

  it('replaces the whole plan on each call, and clears it with an empty list', () => {
    const first = canonicalize({
      toolName: 'update_plan',
      argumentsJson: JSON.stringify({ plan: [{ step: 'One', status: 'pending' }] }),
    });
    const cleared = reduceAgentControlGraph(first.graph as never, [
      { type: 'PLAN_UPDATED', plan: [] },
    ]) as AgentRunControlGraphState;

    expect(first.graph.plan).toEqual([{ step: 'One', status: 'pending' }]);
    expect(cleared.plan).toBeUndefined();
  });

  it('stores exactly what the executor accepted, through the same argument recovery', () => {
    // The dropped-brace shape models emit for arrays of objects (see
    // toolArgumentJsonRecovery). Dispatch and canonicalization read it with the same
    // parser, so a call answered "Plan updated" is never left unrecorded.
    const argumentsJson = '{"plan":["step":"Find flights","status":"in_progress"]}';
    const executed = executeUpdatePlan(parseToolArgumentsJson(argumentsJson));
    const { graph } = canonicalize({ toolName: 'update_plan', argumentsJson });

    expect(executed).toEqual(expect.objectContaining({ content: PLAN_UPDATED_RESULT }));
    expect(graph.plan).toEqual([{ step: 'Find flights', status: 'in_progress' }]);
  });

  it('leaves the graph alone when the call failed', () => {
    const { outcome, applied } = canonicalize({
      toolName: 'update_plan',
      argumentsJson: JSON.stringify({ plan: [{ step: 'One', status: 'later' }] }),
      isError: true,
    });

    expect(outcome).toEqual(expect.objectContaining({ canonicalized: false, graphApplied: false }));
    expect(applied).toEqual([]);
  });

  it('passes every other tool through unchanged', () => {
    const { outcome, applied } = canonicalize({
      toolName: 'read_file',
      argumentsJson: JSON.stringify({ path: 'notes.txt' }),
    });

    expect(outcome).toEqual(expect.objectContaining({ canonicalized: false, graphApplied: false }));
    expect(applied).toEqual([]);
  });
});

describe('a persisted plan', () => {
  it('survives normalization of a stored run, malformed steps dropped', () => {
    const state = createInitialAgentRunControlGraphState({
      plan: [
        { step: 'Keep', status: 'completed' },
        { step: 'Drop', status: 'unknown' },
      ] as never,
    });
    expect(state.plan).toEqual([{ step: 'Keep', status: 'completed' }]);
  });

  it('is absent from a run that never made one', () => {
    expect(createInitialAgentRunControlGraphState().plan).toBeUndefined();
  });
});
