// ---------------------------------------------------------------------------
// Kavi — Goal evidence hold actionability
// ---------------------------------------------------------------------------
// The evidence hold names which criteria are unmet. Naming the criterion without
// the action that records it leaves the model to infer the next step, which shows
// up as repeated goal bookkeeping instead of progress.
// ---------------------------------------------------------------------------

import { evaluateGoalEvidenceIncompleteHold } from '../../src/engine/graph/completionGateHolds';
import type { AgentGoal } from '../../src/types/agentRun';

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'goal-1',
    name: 'Produce the brief',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:europe-transport-brief.md'],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as AgentGoal;
}

function holdPromptFor(goals: AgentGoal[]): string {
  const decision = evaluateGoalEvidenceIncompleteHold({
    goals,
    toolingEnabledForProvider: true,
    selectedToolCount: 5,
    forceTextThisTurn: false,
  });
  if (!decision || decision.type !== 'hold') {
    throw new Error(`expected hold, got ${decision?.type ?? 'null'}`);
  }
  return decision.systemPrompts?.join('\n') ?? '';
}

describe('goal evidence hold', () => {
  it('names the action that records the missing artifact evidence', () => {
    const prompt = holdPromptFor([goal()]);

    expect(prompt).toContain('To record it:');
    expect(prompt).toContain('write europe-transport-brief.md with write_file');
  });

  it('still reports which criteria are missing', () => {
    const prompt = holdPromptFor([goal()]);

    expect(prompt).toContain('Missing evidence criteria:');
  });

  it('names a tool-evidence action when the criterion names a tool', () => {
    const prompt = holdPromptFor([goal({ successCriteria: ['evidence.tool:web_search'] })]);

    expect(prompt).toContain('call web_search');
  });

  it('omits the action line for count-only criteria rather than inventing one', () => {
    const prompt = holdPromptFor([goal({ successCriteria: ['evidence.min:2'] })]);

    expect(prompt).not.toContain('To record it:');
  });

  it('keeps the prohibition against finalizing on missing evidence', () => {
    const prompt = holdPromptFor([goal()]);

    expect(prompt).toContain('Do not finalize');
  });
});
