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

  // Completion is no longer refused at all — not for unmet evidence, not for a goal that
  // was never activated. The three cases that lived here asserted the wording of that
  // refusal, and there is no longer a refusal to word. The invariant they belonged to is
  // unchanged and still enforced across every refusal that remains; what completion now
  // returns is reported as information, covered by relaxedGoalCompletion.test.ts.
});
