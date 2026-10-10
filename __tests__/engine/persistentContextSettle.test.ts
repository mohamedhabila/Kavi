import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildAgentControlGraphPostToolFinalTextDirectiveEvent } from '../../src/engine/graph/turnDirectives';
import type { AgentGoal } from '../../src/engine/goals/types';
import { buildBaseParams, createToolMessage } from '../helpers/toolExecutionOutcomeHarness';

// Traced on the GLM 5.3 Flash suite (organic-mobile-assistant-continuity). Asked to create a
// calendar event, the model looked up the calendar tools and declared its goal in one
// batch. The goal was held as persistent focus, and a rule read "an active persistent goal
// and no open blocking one" as the request being done: the next turn was offered no tools
// and the run finalized with no event created. The rule is gone; the model ends a request
// by answering, as in any agent loop.

const TRACED_GOAL_ADD = JSON.stringify({
  action: 'add',
  goals: [
    {
      id: 'design-review-event',
      name: 'Create Organic design review event',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [
        "exactly one event titled 'Organic design review' on 2026-07-16 starting 14:00Z, 45-minute duration",
        'verified via calendar_events read',
      ],
    },
  ],
});

async function resolveBatch(
  calls: ReadonlyArray<{ name: string; arguments: string; content: string }>,
) {
  const params = buildBaseParams();
  let goals: AgentGoal[] = [];
  params.getGraphSnapshot = jest.fn(() => ({ goals }));
  params.applyGraphEvents = jest.fn((events) => {
    for (const event of events) {
      if (event.type === 'GOALS_UPDATED') goals = event.goals;
    }
  });
  const forcedText: string[] = [];
  params.recordPostToolFinalTextDirective = jest.fn((args) => {
    const event = buildAgentControlGraphPostToolFinalTextDirectiveEvent(args);
    if (event) forcedText.push(event.reason);
    return Boolean(event);
  });
  params.executableToolCalls = calls.map(({ name, arguments: args }) => ({
    name,
    arguments: args,
  }));
  params.toolExecutionOutcomes = calls.map((call, index) => ({
    index,
    toolCallId: `tc-${index}`,
    toolMessage: createToolMessage({
      id: `tc-${index}`,
      name: call.name,
      arguments: call.arguments,
      content: call.content,
    }),
  }));
  await resolveAgentControlGraphToolExecutionOutcomes(params);
  return { forcedText, goals };
}

describe('a persistent goal after a tool batch', () => {
  it('leaves the model its tools to do the work it just looked up', async () => {
    const { forcedText, goals } = await resolveBatch([
      {
        name: 'tool_catalog',
        arguments: '{"category":"calendar"}',
        content: '{"mode":"category","category":"calendar","tools":[]}',
      },
      { name: 'update_goals', arguments: TRACED_GOAL_ADD, content: '{"status":"ok"}' },
    ]);

    expect(goals.find((goal) => goal.id === 'design-review-event')?.completionPolicy).toBe(
      'persistent',
    );
    expect(forcedText).toEqual([]);
  });
});
