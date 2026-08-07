import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { validateGoalMutation } from '../../../src/engine/goals/validation';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import type { AgentGoalMutation } from '../../../src/engine/goals/types';

// Traced live on `multi-turn-goal-passive-recall`. The user asked only for
// "Create an active goal `trip-plan` with title `trip-planning-scope`" — a goal with no
// verifiable deliverable. Of the three encodings available to the model, two were dead
// ends: omitting completionPolicy was rejected as missing, and the obvious retry
// ("a goal gets completed, so it is blocking") was rejected for missing structural
// criteria it had no basis to invent. Three rejected mutations tripped the
// goal-mutation stall threshold, loop detection killed the run, and the next user turn
// restarted the same dead end: 95 tool calls across four turns with none of the work done.
function addGoal(patch: Record<string, unknown>) {
  return applyGoalMutation(
    [],
    { action: 'add', goals: [{ id: 'trip-plan', title: 'trip-planning-scope', ...patch }] } as
      unknown as AgentGoalMutation,
    1,
  );
}

const STRUCTURAL = 'evidence.tool:write_file';

describe('completionPolicy is derived when the caller omits it', () => {
  it('creates the goal the user asked for instead of rejecting it', () => {
    const { goals, errors } = addGoal({ status: 'active' });

    expect(errors).toEqual([]);
    expect(goals[0]?.id).toBe('trip-plan');
    expect(goals[0]?.status).toBe('active');
  });

  it('derives persistent when there is nothing structural to verify', () => {
    // A goal with no structural criterion cannot legally be blocking — the validator
    // refuses it — so persistent is the only consistent value, not a guess.
    expect(addGoal({ status: 'active' }).goals[0]?.completionPolicy).toBe('persistent');
  });

  it('derives blocking when a structural criterion states the deliverable', () => {
    const { goals, errors } = addGoal({ status: 'active', successCriteria: [STRUCTURAL] });

    expect(errors).toEqual([]);
    expect(goals[0]?.completionPolicy).toBe('blocking');
    expect(goals[0]?.successCriteria).toEqual([STRUCTURAL]);
  });

  it('does not derive blocking from a count-only criterion', () => {
    // `evidence.min:N` is recognized but not specific, and the validator does not accept
    // it as a blocking deliverable. Deriving blocking here would recreate the dead end.
    expect(addGoal({ status: 'active', successCriteria: ['evidence.min:2'] }).goals[0]
      ?.completionPolicy).toBe('persistent');
  });

  it('never overrides a policy the caller stated explicitly', () => {
    expect(addGoal({ status: 'active', completionPolicy: 'persistent' }).goals[0]
      ?.completionPolicy).toBe('persistent');
    expect(
      addGoal({ status: 'active', completionPolicy: 'blocking', successCriteria: [STRUCTURAL] })
        .goals[0]?.completionPolicy,
    ).toBe('blocking');
  });

  it('still refuses an explicit blocking goal that declares no deliverable', () => {
    // Derivation must not silently downgrade a stated intent into a non-gating goal.
    const { errors, goals } = addGoal({ status: 'active', completionPolicy: 'blocking' });

    expect(goals).toHaveLength(0);
    expect(errors.join(' ')).toContain('persistent');
  });
});

describe('the blocking-without-criteria rejection is recoverable', () => {
  it('names both ways out rather than only restating the rule', () => {
    const { errors } = validateGoalMutation(
      {
        action: 'add',
        goals: [{ id: 'g', title: 'T', status: 'active', completionPolicy: 'blocking' }],
      } as unknown as AgentGoalMutation,
      [],
    );
    const message = errors.map((entry) => entry.message).join(' ');

    expect(message).toContain('structural criterion');
    expect(message).toContain('persistent');
    expect(message).toContain('rejected the same way');
  });
});

describe('the tool schema matches what the engine enforces', () => {
  it('does not describe completionPolicy as required for add', () => {
    // The schema never listed completionPolicy in `required`, so a schema-conformant call
    // omitted it and was rejected at runtime. The description must not claim otherwise.
    const property = (UPDATE_GOALS_TOOL.input_schema as Record<string, any>)?.properties
      ?.completionPolicy;

    expect(property?.description).not.toContain('Required for add');
    expect(String(property?.description)).toContain('derived');
  });
});
