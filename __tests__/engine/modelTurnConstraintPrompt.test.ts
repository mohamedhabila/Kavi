import { buildPreparedModelTurnPrompt } from '../../src/engine/graph/modelTurn/buildPreparedPromptTurn';
import { createGoal } from '../../src/engine/goals/types';
import {
  projectRequestUnderstanding,
  renderRequestUnderstandingPromptSection,
} from '../../src/services/agents/requestUnderstandingProjection';

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function buildPrompt(params: {
  actionable: boolean;
  forceReason?: 'loop_recovery' | 'request_clarification';
  goals: ReturnType<typeof createGoal>[];
}) {
  const requestUnderstandingPrompt = renderRequestUnderstandingPromptSection(
    projectRequestUnderstanding({ goals: params.goals }),
  );
  return buildPreparedModelTurnPrompt({
    actionablePromptTurn: params.actionable,
    allowSessionCoordinationTools: false,
    effectiveForceTextReasonThisTurn: params.forceReason,
    effectiveForceTextThisTurn: !params.actionable,
    groundedRequestScopedTools: [],
    iteration: 3,
    pinnedToolNames: [],
    promptContextSupport: {
      graphGoals: params.goals,
      maxToolIterations: 12,
      resolvedPrompt: 'Base assistant prompt.',
      runtimeContext: requestUnderstandingPrompt,
      skillPrompts: '',
    },
    toolingEnabledForProvider: false,
  }).enrichedSystemPrompt;
}

describe('model-turn retained statement prompt', () => {
  it.each(['request_clarification', 'loop_recovery'] as const)(
    'keeps an active exact statement on forced %s turns without duplication',
    (forceReason) => {
      const statement = 'Do not notify anyone before I review the draft.';
      const goal = createGoal({
        id: 'draft',
        title: 'Prepare draft',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:write_file'],
        userConstraints: [{ text: statement, sourceMessageId: 'user-1' }],
        now: 1,
      });

      const prompt = buildPrompt({ actionable: false, forceReason, goals: [goal] });

      expect(prompt).toContain(statement);
      expect(occurrenceCount(prompt, statement)).toBe(1);
      expect(prompt).toContain('status=known; count=1; omitted=0');
    },
  );

  it('renders each maximum-bound statement exactly once on actionable turns', () => {
    const statements = Array.from({ length: 8 }, (_, index) => `S${index}${'界'.repeat(510)}`);
    const goal = createGoal({
      id: 'bounded',
      title: 'Bounded prompt',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      userConstraints: statements.map((text, index) => ({
        text,
        sourceMessageId: `user-${index}`,
      })),
      now: 1,
    });

    const prompt = buildPrompt({ actionable: true, goals: [goal] });

    for (const statement of statements) expect(occurrenceCount(prompt, statement)).toBe(1);
    expect(prompt.length).toBeLessThan(15_000);
  });

  it('omits acknowledged completed goals from later forced-turn constraint context', () => {
    const settledHistorical = createGoal({
      id: 'historical',
      title: 'Historical completed goal',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      now: 1,
    });
    const settledConstraint = createGoal({
      id: 'acknowledged',
      title: 'Acknowledged completed goal',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      now: 1,
    });

    const prompt = buildPrompt({
      actionable: false,
      forceReason: 'loop_recovery',
      goals: [settledHistorical, settledConstraint],
    });

    expect(prompt).not.toContain('Historical completed goal');
    expect(prompt).not.toContain('Constraint state is malformed');
    expect(prompt).not.toContain('Acknowledged completed goal');
  });
});
