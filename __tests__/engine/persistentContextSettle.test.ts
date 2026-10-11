import { resolveAgentControlGraphToolExecutionOutcomes } from '../../src/engine/graph/toolExecutionOutcomeResolution';
import { buildAgentControlGraphPostToolFinalTextDirectiveEvent } from '../../src/engine/graph/turnDirectives';
import type { AgentPlanStep } from '../../src/types/agentRun';
import { buildBaseParams, createToolMessage } from '../helpers/toolExecutionOutcomeHarness';

// Traced on the GLM 5.3 Flash suite (organic-mobile-assistant-continuity). Asked to create a
// calendar event, the model looked up the calendar tools and stated its plan in one batch.
// A rule read the plan-keeping call as the request being settled: the next turn was offered
// no tools and the run finalized with no event created. Keeping a plan decides nothing; the
// model ends a request by answering, as in any agent loop.

const TRACED_PLAN = JSON.stringify({
  plan: [
    {
      step: 'Create the Organic design review event on 2026-07-16 at 14:00Z',
      status: 'in_progress',
    },
    { step: 'Read the calendar back to confirm it', status: 'pending' },
  ],
});

async function resolveBatch(
  calls: ReadonlyArray<{ name: string; arguments: string; content: string }>,
) {
  const params = buildBaseParams();
  let plan: AgentPlanStep[] | undefined;
  params.getGraphSnapshot = jest.fn(() => ({ ...(plan ? { plan } : {}) }));
  params.applyGraphEvents = jest.fn((events) => {
    for (const event of events) {
      if (event.type === 'PLAN_UPDATED') plan = event.plan;
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
  return { forcedText, plan };
}

describe('a plan stated alongside a tool lookup', () => {
  it('leaves the model its tools to do the work it just looked up', async () => {
    const { forcedText, plan } = await resolveBatch([
      {
        name: 'tool_catalog',
        arguments: '{"category":"calendar"}',
        content: '{"mode":"category","category":"calendar","tools":[]}',
      },
      { name: 'update_plan', arguments: TRACED_PLAN, content: 'Plan updated' },
    ]);

    expect(plan?.[0]?.status).toBe('in_progress');
    expect(forcedText).toEqual([]);
  });
});
