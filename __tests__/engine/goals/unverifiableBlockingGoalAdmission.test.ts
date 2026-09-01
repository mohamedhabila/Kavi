import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { areBlockingGoalsStructurallyComplete } from '../../../src/engine/goals/completionEvidence';
import type { AgentGoalMutation } from '../../../src/engine/goals/types';

// Traced live on an Android emulator. The opening five-goal batch was rejected whole with
//
//   [verify] Blocking goals require at least one specific structural successCriteria
//
// leaving the run with no graph at all. A blocking goal is a gate the run cannot finalize
// through, and the gate is the criteria — so a blocking goal with nothing specific to
// verify is not a gate, it is an ongoing focus. Admitting it as one applies the remedy the
// rejection message already named, and keeps the four well-formed goals that the refusal
// threw away with it.

function addBatch(): AgentGoalMutation {
  return {
    action: 'add',
    goals: [
      {
        id: 'mc-npv',
        title: 'Run the Monte Carlo NPV',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.artifact:artifacts/npv.md'],
      },
      {
        id: 'verify',
        title: 'Verify the figures are self-consistent',
        status: 'pending',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.min:1'],
      },
    ],
  } as AgentGoalMutation;
}

describe('a batch is not thrown away for one unverifiable goal', () => {
  it('admits the batch', () => {
    expect(applyGoalMutation([], addBatch(), 1).errors).toEqual([]);
  });

  it('keeps every goal in the batch', () => {
    const { goals } = applyGoalMutation([], addBatch(), 1);
    expect(goals.map((goal) => goal.id)).toEqual(['mc-npv', 'verify']);
  });

  it('keeps the weakly-specified goal gating, as the model asked', () => {
    // evidence.min:1 is a weaker gate than evidence.artifact, but it is a gate, and how
    // strong to make it is the model's call.
    const { goals } = applyGoalMutation([], addBatch(), 1);
    expect(goals.find((goal) => goal.id === 'verify')?.completionPolicy).toBe('blocking');
  });

  it('leaves a goal that does name a deliverable blocking', () => {
    const { goals } = applyGoalMutation([], addBatch(), 1);
    expect(goals.find((goal) => goal.id === 'mc-npv')?.completionPolicy).toBe('blocking');
  });

  it('still refuses to call the run complete until the weak gate is met', () => {
    // The relaxation is safe because finalization reads the criteria, not the policy.
    const { goals } = applyGoalMutation([], addBatch(), 1);
    const verify = goals.find((goal) => goal.id === 'verify')!;

    expect(areBlockingGoalsStructurallyComplete([{ ...verify, status: 'completed' }])).toBe(false);
    expect(
      areBlockingGoalsStructurallyComplete([
        { ...verify, status: 'completed', evidence: ['python: cross-checked NPV against IRR'] },
      ]),
    ).toBe(true);
  });
});

describe('a gate with no condition is held as the focus it describes', () => {
  function single(overrides: Record<string, unknown>): AgentGoalMutation {
    return {
      action: 'add',
      goals: [
        {
          id: 'g1',
          title: 'A goal',
          completionPolicy: 'blocking',
          ...overrides,
        },
      ],
    } as AgentGoalMutation;
  }

  // areBlockingGoalsStructurallyComplete requires a non-empty criteria list, so a blocking
  // goal with nothing recognized is not a weak gate — it is one nothing can ever open.

  it('holds it as persistent whether the goal is pending or active', () => {
    for (const status of ['pending', 'active'] as const) {
      const { goals, errors } = applyGoalMutation([], single({ status, successCriteria: [] }), 1);
      expect(errors).toEqual([]);
      expect(goals[0]?.completionPolicy).toBe('persistent');
    }
  });

  it('holds it as persistent when every criterion was unparseable', () => {
    const unparseable = single({ status: 'pending', successCriteria: ['the team agrees'] });

    expect(applyGoalMutation([], unparseable, 1).goals[0]?.completionPolicy).toBe('persistent');
  });

  it('leaves a satisfiable weak gate alone', () => {
    const countOnly = single({ status: 'pending', successCriteria: ['evidence.count:2'] });

    expect(applyGoalMutation([], countOnly, 1).goals[0]?.completionPolicy).toBe('blocking');
  });

  it('keeps a goal blocking when a specific criterion sits among weak ones', () => {
    const mixed = single({
      status: 'pending',
      successCriteria: ['evidence.min:1', 'evidence.artifact:artifacts/out.md'],
    });

    expect(applyGoalMutation([], mixed, 1).goals[0]?.completionPolicy).toBe('blocking');
  });
});
