import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../../src/engine/goals/delegation';
import { createGoal } from '../../../src/engine/goals/types';

// Traced live on an Android emulator. The `sessions_spawn` gate refuses a delegation goal
// that lacks both worker criteria and hands back a repair payload telling the model to
// send `evidence.prefix:worker` plus `evidence.min:1` — but appending a count to an
// existing blocking goal was rejected here, unconditionally. A model that followed the
// gate's own instruction exactly had its `update_goals` call refused, retried, and was
// refused again, which is what the repeated failing goal updates around a stalled spawn
// actually were: two code-owned rules contradicting each other.

const delegationGoal = () =>
  createGoal({
    id: 'worker-1',
    title: 'Delegated workstream',
    status: 'pending',
    completionPolicy: 'blocking',
    owner: DELEGATED_WORKER_GOAL_OWNER,
    requiredCapabilities: ['coordinate'],
    successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION],
  });

function update(goals: ReturnType<typeof createGoal>[], successCriteria: string[]) {
  return applyGoalMutation(goals, {
    action: 'update',
    goals: [{ id: 'worker-1', successCriteria }],
  } as never);
}

describe('a count may join a goal that keeps a specific criterion', () => {
  it('accepts the exact repair the spawn gate asks for', () => {
    const result = update(
      [delegationGoal()],
      [DELEGATED_WORKER_EVIDENCE_CRITERION, DELEGATED_WORKER_MIN_EVIDENCE_CRITERION],
    );

    expect(result.errors).toEqual([]);
    expect(result.goals[0]?.successCriteria).toEqual([
      DELEGATED_WORKER_EVIDENCE_CRITERION,
      DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
    ]);
  });

  it('accepts a count beside any other specific criterion', () => {
    const goal = createGoal({
      id: 'worker-1',
      title: 'Study',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:artifacts/verdict.md'],
    });
    const result = update([goal], ['evidence.artifact:artifacts/verdict.md', 'evidence.min:3']);

    expect(result.errors).toEqual([]);
  });
});

describe('a count still may not become the gate', () => {
  it('refuses an added count that would be the only criterion left', () => {
    const goal = createGoal({
      id: 'worker-1',
      title: 'Study',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.artifact:artifacts/verdict.md'],
    });
    // Dropping the artifact criterion and leaving only a count is the shape that makes a
    // goal unwinnable, and it is refused for that reason and for dropping a deliverable.
    const result = update([goal], ['evidence.min:3']);

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('still refuses an unrecognized criterion form', () => {
    const result = update(
      [delegationGoal()],
      [DELEGATED_WORKER_EVIDENCE_CRITERION, 'the worker said it was fine'],
    );

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('still refuses dropping a criterion that names a deliverable', () => {
    const result = update([delegationGoal()], [DELEGATED_WORKER_MIN_EVIDENCE_CRITERION]);

    expect(result.errors.length).toBeGreaterThan(0);
  });
});
