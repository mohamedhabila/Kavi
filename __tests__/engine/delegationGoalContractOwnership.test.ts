import { materializeToolEffectCompletionGoals } from '../../src/engine/graph/toolEffectGoalMaterialization';
import { isDelegationOwnedGoal } from '../../src/engine/goals/delegation';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../src/engine/goals/delegation';
import { createGoal } from '../../src/engine/goals/types';

// Traced live on `delegation-worker-evidence-chain`. Effect-completion materialization
// grafted its criterion onto whichever goal was active and blocking, which in a
// delegation run is always the delegation goal. Blocking criteria are monotonic, so the
// grafted criterion could never be removed and the goal could never complete: its
// criteria ended as the two the supervisor declared plus a 319-character code-owned
// effect criterion, every evidence entry an effect receipt and none from the worker,
// scoring 0/4 in every recorded run. Evidence routing already refused to treat a
// delegation goal as a container for this run's tool output; materialization did not.
const WRITE_ARGS = JSON.stringify({ path: 'reports/final.md', content: 'done' });

function delegationGoal() {
  return createGoal({
    id: 'worker-chain',
    title: 'Delegate the chain',
    status: 'active',
    completionPolicy: 'blocking',
    owner: DELEGATED_WORKER_GOAL_OWNER,
    requiredCapabilities: ['coordinate'],
    successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION, DELEGATED_WORKER_MIN_EVIDENCE_CRITERION],
    now: 10,
  });
}

describe('a delegation goal is not a container for the supervisor own side effects', () => {
  it('leaves the delegation contract exactly as the supervisor declared it', async () => {
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: WRITE_ARGS }],
      goals: [delegationGoal()],
      now: 100,
    });

    const delegation = result.goals.find((goal) => goal.id === 'worker-chain');
    expect(delegation?.successCriteria).toEqual([
      DELEGATED_WORKER_EVIDENCE_CRITERION,
      DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
    ]);
  });

  it('still records the effect, on a separate code-owned goal', async () => {
    // Skipping the delegation goal must not drop the verification contract — the effect
    // still has to be proven, just not by the worker's goal.
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: WRITE_ARGS }],
      goals: [delegationGoal()],
      now: 100,
    });

    expect(result.status).toBe('materialized');
    const owned = result.goals.filter((goal) => goal.id !== 'worker-chain');
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.some((goal) => (goal.successCriteria ?? []).length > 0)).toBe(true);
  });

  it('still attaches the criterion to an ordinary active blocking deliverable', async () => {
    // The pinned behaviour for a goal this run actually owns is unchanged: a deliverable
    // goal should own proof of the effect that produces it.
    const deliverable = createGoal({
      id: 'deliverable',
      title: 'Prepare report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      now: 10,
    });

    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: WRITE_ARGS }],
      goals: [deliverable],
      now: 100,
    });

    const updated = result.goals.find((goal) => goal.id === 'deliverable');
    expect(updated?.successCriteria?.length).toBeGreaterThan(1);
    expect(result.goals).toHaveLength(1);
  });

  it('prefers this run own deliverable when both kinds of goal are active', async () => {
    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: WRITE_ARGS }],
      goals: [
        delegationGoal(),
        createGoal({
          id: 'deliverable',
          title: 'Prepare report',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:read_file'],
          now: 10,
        }),
      ],
      now: 100,
    });

    expect(result.goals.find((goal) => goal.id === 'worker-chain')?.successCriteria).toEqual([
      DELEGATED_WORKER_EVIDENCE_CRITERION,
      DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
    ]);
    expect(
      result.goals.find((goal) => goal.id === 'deliverable')?.successCriteria?.length,
    ).toBeGreaterThan(1);
  });
});

describe('delegation ownership is decided one way everywhere', () => {
  it('recognises a delegation-owned goal', () => {
    expect(isDelegationOwnedGoal({ owner: DELEGATED_WORKER_GOAL_OWNER })).toBe(true);
    expect(isDelegationOwnedGoal({ owner: `  ${DELEGATED_WORKER_GOAL_OWNER}  ` })).toBe(true);
  });

  it('does not mistake an ordinary or unowned goal for one', () => {
    expect(isDelegationOwnedGoal({})).toBe(false);
    expect(isDelegationOwnedGoal({ owner: 'supervisor' })).toBe(false);
    expect(isDelegationOwnedGoal({ owner: '' })).toBe(false);
  });
});
