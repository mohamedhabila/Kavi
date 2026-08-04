// ---------------------------------------------------------------------------
// Kavi — Goal refusal actionability invariant
// ---------------------------------------------------------------------------
// A validation refusal is a prompt the model reads. A refusal that states only
// what is wrong leaves the model to guess the next step, and guessing surfaces as
// repeated update_goals calls until loop detection ends the run. Every refusal
// must therefore name an action, a required value, or an alternative.
//
// This pins the invariant across the whole surface so a future refusal cannot
// reintroduce the dead end that the completion path had.
// ---------------------------------------------------------------------------

import { validateGoalMutation } from '../../src/engine/goals/validation';
import { createGoal } from '../../src/engine/goals/types';
import type { AgentGoal, AgentGoalMutation } from '../../src/engine/goals/types';

/** Verbs and phrasings that give the model something to do next. */
const ACTIONABLE_MARKERS = [
  'use ',
  'add ',
  'call ',
  'write ',
  'record ',
  'create ',
  'remove ',
  'activate',
  'complete it',
  'to record it',
  'instead',
  'first',
  'before',
  'requir',
  'must ',
  'try ',
];

function isActionable(message: string): boolean {
  const lower = message.toLowerCase();
  return ACTIONABLE_MARKERS.some((marker) => lower.includes(marker));
}

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return createGoal({
    id: 'goal-1',
    title: 'Produce the brief',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:brief.md'],
    evidence: [],
    ...overrides,
  });
}

/** Mutations chosen to exercise each distinct refusal branch. */
const REFUSAL_CASES: ReadonlyArray<{
  name: string;
  mutation: AgentGoalMutation;
  existing: AgentGoal[];
}> = [
  {
    name: 'complete without evidence',
    mutation: { action: 'complete', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
    existing: [goal()],
  },
  {
    name: 'complete a pending goal',
    mutation: { action: 'complete', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
    existing: [goal({ status: 'pending' })],
  },
  {
    name: 'block a pending goal',
    mutation: { action: 'block', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
    existing: [goal({ status: 'pending' })],
  },
  {
    name: 'block without exhausting alternatives',
    mutation: { action: 'block', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
    existing: [goal()],
  },
  {
    name: 'add without title',
    mutation: {
      action: 'add',
      goals: [{ id: 'new-1', completionPolicy: 'blocking' }],
    } as AgentGoalMutation,
    existing: [],
  },
  {
    name: 'add directly as blocked',
    mutation: {
      action: 'add',
      goals: [{ id: 'new-1', name: 'x', completionPolicy: 'blocking', status: 'blocked' }],
    } as unknown as AgentGoalMutation,
    existing: [],
  },
  {
    name: 'remove an active goal',
    mutation: { action: 'remove', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
    existing: [goal()],
  },
  {
    name: 'reference a goal that does not exist',
    mutation: { action: 'complete', goals: [{ id: 'missing' }] } as AgentGoalMutation,
    existing: [goal()],
  },
];

describe('goal refusal actionability', () => {
  for (const testCase of REFUSAL_CASES) {
    it(`gives the model a next step when refusing: ${testCase.name}`, () => {
      const result = validateGoalMutation(testCase.mutation, testCase.existing);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      for (const error of result.errors) {
        expect(isActionable(error.message)).toBe(true);
      }
    });
  }

  it('names the unmet criterion and its recording action when completion is refused', () => {
    const result = validateGoalMutation(
      { action: 'complete', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
      [goal()],
    );

    const message = result.errors.map((error) => error.message).join(' ');
    expect(message).toContain('evidence.artifact:brief.md');
    expect(message).toContain('write brief.md with write_file');
  });

  it('states that goal bookkeeping is not evidence when completion is refused', () => {
    const result = validateGoalMutation(
      { action: 'complete', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
      [goal()],
    );

    expect(result.errors.map((error) => error.message).join(' ')).toContain(
      'Repeating update_goals does not record evidence',
    );
  });

  it('guides a goal that has no criteria and no evidence', () => {
    const result = validateGoalMutation(
      { action: 'complete', goals: [{ id: 'goal-1' }] } as AgentGoalMutation,
      [goal({ successCriteria: [] })],
    );

    const message = result.errors.map((error) => error.message).join(' ');
    expect(isActionable(message)).toBe(true);
    expect(message).toContain('successCriteria');
  });
});
