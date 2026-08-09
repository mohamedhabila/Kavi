import { parseUpdateGoalsArgs } from '../../../src/engine/tools/toolGoalExecution';
import { applyGoalMutation } from '../../../src/engine/goals/graphState';

// Traced live on an Android emulator. The graph has always applied
// `AgentGoalMutation.goals` as an array, but these tool arguments were flat, so one call
// carried exactly one goal. Opening a two-goal plan cost three calls — add, activate,
// add — and closing it cost six more. None of that was the model being wasteful; the
// contract left no way to say it once.

const REPORT = 'artifacts/h2/report.md';

describe('a whole plan is declared in one call', () => {
  it('collapses the traced add / activate / add opening', () => {
    const parsed = parseUpdateGoalsArgs({
      action: 'add',
      goals: [
        {
          id: 'h2-feasibility',
          name: 'Hydrogen feasibility study',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: [`evidence.artifact:${REPORT}`],
        },
        {
          id: 'h2-feasibility-worker',
          name: 'Numerical analysis',
          completionPolicy: 'blocking',
          owner: 'delegated-worker',
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        },
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mutation.action).toBe('add');
    expect(parsed.mutation.goals).toHaveLength(2);

    const applied = applyGoalMutation([], parsed.mutation);
    expect(applied.errors).toEqual([]);
    expect(applied.goals.map((goal) => goal.id)).toEqual([
      'h2-feasibility',
      'h2-feasibility-worker',
    ]);
    // The active status is honoured on the add, so no follow-up activate is needed.
    expect(applied.goals[0]?.status).toBe('active');
  });

  it('closes a plan in one call', () => {
    const opened = applyGoalMutation(
      [],
      parseUpdateGoalsArgs({
        action: 'add',
        goals: [
          {
            id: 'a',
            name: 'A',
            status: 'active',
            completionPolicy: 'persistent',
          },
          { id: 'b', name: 'B', status: 'active', completionPolicy: 'persistent' },
        ],
      }).mutation,
    );

    const parsed = parseUpdateGoalsArgs({
      action: 'complete',
      goals: [{ id: 'a' }, { id: 'b' }],
    });
    expect(parsed.errors).toEqual([]);

    // One call carries both goals; how the graph then settles each status is its own
    // existing behaviour (a persistent goal is refocused rather than closed).
    expect(parsed.mutation.action).toBe('complete');
    expect(parsed.mutation.goals.map((goal) => goal.id)).toEqual(['a', 'b']);

    const closed = applyGoalMutation(opened.goals, parsed.mutation);
    expect(closed.errors).toEqual([]);
  });

  it('lets an entry carry its own action', () => {
    const parsed = parseUpdateGoalsArgs({
      goals: [{ action: 'add', id: 'solo', name: 'Solo', completionPolicy: 'persistent' }],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mutation.action).toBe('add');
  });
});

describe('batching validates exactly as a single call does', () => {
  it('reports an invalid entry instead of applying a partial batch', () => {
    const parsed = parseUpdateGoalsArgs({
      action: 'add',
      goals: [
        { id: 'ok', name: 'Fine', completionPolicy: 'persistent' },
        { id: 'bad', name: 'Bad', status: 'unknown' },
      ],
    });

    expect(parsed.errors.length).toBeGreaterThan(0);
    // Nothing is applied when any entry is rejected, so the graph never half-updates.
    expect(parsed.mutation.goals).toEqual([]);
  });

  it('still requires an id per goal', () => {
    const parsed = parseUpdateGoalsArgs({ action: 'complete', goals: [{ name: 'No id' }] });
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('leaves a single-goal call on its existing path', () => {
    const parsed = parseUpdateGoalsArgs({
      action: 'add',
      id: 'solo',
      name: 'Solo',
      completionPolicy: 'persistent',
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mutation.goals).toHaveLength(1);
  });

  it('ignores an empty batch rather than treating it as a batch', () => {
    const parsed = parseUpdateGoalsArgs({
      action: 'add',
      id: 'solo',
      name: 'Solo',
      completionPolicy: 'persistent',
      goals: [],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.mutation.goals).toHaveLength(1);
  });
});
