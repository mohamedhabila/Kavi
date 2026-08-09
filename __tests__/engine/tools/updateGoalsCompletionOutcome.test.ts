import { executeUpdateGoals } from '../../../src/engine/tools/toolGoalExecution';
import type { AgentGoal } from '../../../src/engine/goals/types';

// Traced live on an Android emulator. `complete` reported {"status":"ok"} regardless of
// whether the goal closed, so a goal held open by unmet success criteria looked completed
// to the model. It read "ok", saw the goal still active in the next graph snapshot, and
// repeated the call — six completes and two activates in one run — until the loop
// detector ended the run for "update_goals calls without goal state change".

function goal(overrides: Partial<AgentGoal> & { id: string }): AgentGoal {
  return {
    title: overrides.id,
    status: 'active',
    dependencies: [],
    evidence: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AgentGoal;
}

function completeGoal(id: string, goals: ReadonlyArray<AgentGoal>) {
  const outcome = executeUpdateGoals({ action: 'complete', id }, goals);
  return JSON.parse(outcome.content ?? '{}');
}

describe('completing a goal reports what actually happens', () => {
  it('says the goal stays open and names the outstanding criterion', () => {
    const goals = [
      goal({
        id: 'geo-feasibility',
        successCriteria: ['evidence.artifact:artifacts/tl3/report.md'],
        evidence: [],
      }),
    ];

    const result = completeGoal('geo-feasibility', goals);
    const entry = result.goals[0];

    expect(entry.closes).toBe(false);
    expect(entry.unmetCriteria).toEqual([
      expect.objectContaining({ criterion: 'evidence.artifact:artifacts/tl3/report.md' }),
    ]);
    expect(entry.nextStep).toContain('Repeating this complete call changes nothing');
  });

  it('confirms closure once the criteria are satisfied', () => {
    const goals = [
      goal({
        id: 'geo-feasibility',
        successCriteria: ['evidence.min:1'],
        evidence: ['python: computed the Monte Carlo percentiles'],
      }),
    ];

    const result = completeGoal('geo-feasibility', goals);
    expect(result.goals[0].closes).toBe(true);
    expect(result.goals[0].unmetCriteria).toBeUndefined();
  });

  it('explains a goal that recorded no evidence at all', () => {
    const goals = [goal({ id: 'geo-risks-worker', evidence: [] })];

    const result = completeGoal('geo-risks-worker', goals);
    expect(result.goals[0].closes).toBe(false);
    expect(result.goals[0].reason).toContain('no evidence');
  });

  it('still answers ok, because the mutation is accepted rather than refused', () => {
    const goals = [goal({ id: 'g', successCriteria: ['evidence.artifact:a.md'] })];
    expect(completeGoal('g', goals).status).toBe('ok');
  });
});

describe('the report is only added where it is meaningful', () => {
  it('leaves other actions untouched', () => {
    const goals = [goal({ id: 'g', successCriteria: ['evidence.artifact:a.md'] })];
    const result = JSON.parse(
      executeUpdateGoals({ action: 'activate', id: 'g' }, goals).content ?? '{}',
    );

    expect(result.goals[0].closes).toBeUndefined();
  });

  it('omits the report for a goal the graph does not know', () => {
    const result = completeGoal('missing', [goal({ id: 'other' })]);
    expect(result.goals[0].closes).toBeUndefined();
    expect(result.status).toBe('ok');
  });

  it('behaves exactly as before when no graph is supplied', () => {
    const result = JSON.parse(
      executeUpdateGoals({ action: 'complete', id: 'g' }).content ?? '{}',
    );

    expect(result.status).toBe('ok');
    expect(result.goals[0].closes).toBeUndefined();
  });
});
