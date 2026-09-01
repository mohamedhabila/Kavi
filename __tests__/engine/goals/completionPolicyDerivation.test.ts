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
    // Derivation stays conservative when the caller said nothing: a count is a thin basis
    // on which to infer an intent to gate. A caller that states `blocking` is believed.
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

  it('admits an explicit blocking goal that declares no deliverable, as a focus', () => {
    // This once refused the call to protect the stated intent to gate. It protected
    // nothing: areBlockingGoalsStructurallyComplete requires a non-empty criteria list, so
    // a blocking goal with no criteria is a gate nothing can open, and refusing it threw
    // away every other goal in the batch. Holding it as the focus it describes is the
    // remedy the rejection message itself named.
    const { errors, goals } = addGoal({ status: 'active', completionPolicy: 'blocking' });

    expect(errors).toEqual([]);
    expect(goals[0]?.id).toBe('trip-plan');
    expect(goals[0]?.completionPolicy).toBe('persistent');
  });

  it('believes a stated blocking intent wherever a criterion can carry it', () => {
    const { errors, goals } = addGoal({
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.min:1'],
    });

    expect(errors).toEqual([]);
    expect(goals[0]?.completionPolicy).toBe('blocking');
  });
});

describe('the blocking-without-criteria rejection is recoverable', () => {
  // Normalization admits this shape before the validator sees it, so the message is now
  // reached only by a caller that validates without normalizing. It must still name both
  // ways out, because a rule stated without a legal move is what stalled the run.
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
