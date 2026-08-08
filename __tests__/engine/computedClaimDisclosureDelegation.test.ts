import {
  checkComputedClaimDisclosure,
  runHasComputeEvidence,
} from '../../src/engine/tools/computedClaimDisclosure';
import { DELEGATED_WORKER_GOAL_OWNER } from '../../src/engine/goals/delegation';
import { createGoal } from '../../src/engine/goals/types';

// The guard refuses a write that states figures as computed when the run holds no
// `compute.execute` receipt. A delegated run never holds one: the worker's effects land
// on the worker's graph, so a supervisor writing up a worker's numbers was refused with
// no way to comply — it cannot produce evidence it was never handed.

const STUDY =
  'The Monte Carlo simulation over 200,000 trials yields a P50 NPV of $11.3M, with a mean of $12.1M.';

describe('a supervisor may write up a delegated computation', () => {
  it('yields when a delegation goal is carrying the work', () => {
    const delegated = createGoal({
      id: 'worker-1',
      title: 'Delegated workstream',
      status: 'active',
      completionPolicy: 'blocking',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      evidence: ['worker:P50 NPV $11.3M'],
    });

    expect(runHasComputeEvidence([delegated])).toBe(true);
    expect(
      checkComputedClaimDisclosure({
        path: 'artifacts/verdict.md',
        content: STUDY,
        goals: [delegated],
      }),
    ).toBeNull();
  });
});

describe('the guard still catches a run that computed nothing at all', () => {
  it('refuses when no goal delegated and no receipt exists', () => {
    const solo = createGoal({ id: 'study', title: 'Study', status: 'active' });

    expect(runHasComputeEvidence([solo])).toBe(false);
    expect(
      checkComputedClaimDisclosure({ path: 'artifacts/verdict.md', content: STUDY, goals: [solo] }),
    ).toContain('uncomputed_results');
  });

  it('still allows a document that says the computation did not run', () => {
    const solo = createGoal({ id: 'study', title: 'Study', status: 'active' });

    expect(
      checkComputedClaimDisclosure({
        path: 'artifacts/verdict.md',
        content: `${STUDY} These figures are illustrative; the simulation could not be run.`,
        goals: [solo],
      }),
    ).toBeNull();
  });
});
