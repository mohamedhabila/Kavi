import { buildGraphDelegatedWorkerContract } from '../../../src/engine/graph/delegatedWorkerContract';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  isSupervisorOnlySuccessCriterion,
  resolveWorkerVisibleSuccessCriteria,
} from '../../../src/engine/goals/delegation';
import type { AgentGoal } from '../../../src/engine/goals/types';

// Traced live on an Android emulator. The supervisor's delegated-worker goal carries
// evidence.prefix:worker — correct there, because it asserts a worker produced the
// result. Those criteria were passed verbatim into the worker prompt, the worker copied
// them onto its own goal, and then could never close it: inside the worker there is no
// worker-result evidence, because the worker is the worker.
//
// The worker wrote its deliverable (risks.md, 2673 chars), read it back, called
// update_goals complete, and was answered "Unmet criteria: evidence.prefix:worker. To
// record it: produce a worker result" — the thing it had just done. It stalled, was
// terminalized six minutes later, and the parent run ended at step four of five.

function delegatingGoal(successCriteria: string[]): AgentGoal {
  return {
    id: 'risks-worker',
    title: 'Worker writes risks.md',
    status: 'active',
    dependencies: [],
    evidence: [],
    successCriteria,
    completionPolicy: 'blocking',
    requiredCapabilities: ['coordinate'],
    createdAt: 0,
    updatedAt: 0,
  } as AgentGoal;
}

describe('criteria only the supervisor can satisfy', () => {
  it('recognises the delegation evidence criterion', () => {
    expect(isSupervisorOnlySuccessCriterion(DELEGATED_WORKER_EVIDENCE_CRITERION)).toBe(true);
    expect(isSupervisorOnlySuccessCriterion('  evidence.prefix:worker  ')).toBe(true);
  });

  it('leaves criteria a worker can satisfy alone', () => {
    expect(isSupervisorOnlySuccessCriterion('evidence.artifact:artifacts/tl3/risks.md')).toBe(
      false,
    );
    expect(isSupervisorOnlySuccessCriterion('evidence.min:1')).toBe(false);
    expect(isSupervisorOnlySuccessCriterion('evidence.prefix:python')).toBe(false);
  });

  it('filters the delegation criterion out of a mixed set', () => {
    expect(
      resolveWorkerVisibleSuccessCriteria([
        'evidence.prefix:worker',
        'evidence.artifact:artifacts/tl3/risks.md',
      ]),
    ).toEqual(['evidence.artifact:artifacts/tl3/risks.md']);
  });

  it('reports nothing rather than an empty gate when only supervisor criteria remain', () => {
    // An empty successCriteria list would read as "no criteria" downstream; undefined
    // says the worker was given none, which is what actually happened.
    expect(resolveWorkerVisibleSuccessCriteria(['evidence.prefix:worker'])).toBeUndefined();
    expect(resolveWorkerVisibleSuccessCriteria([])).toBeUndefined();
    expect(resolveWorkerVisibleSuccessCriteria(undefined)).toBeUndefined();
  });
});

describe('the prompt handed to a delegated worker', () => {
  it('does not ask the worker to prove a worker produced the result', () => {
    const contract = buildGraphDelegatedWorkerContract({
      normalizedPrompt: 'Write artifacts/tl3/risks.md covering resource and permitting risk.',
      goalId: 'risks-worker',
      goals: [
        delegatingGoal(['evidence.prefix:worker', 'evidence.min:1']),
      ],
    } as Parameters<typeof buildGraphDelegatedWorkerContract>[0]);

    expect(contract.prompt).not.toContain('evidence.prefix:worker');
  });

  it('still passes on a criterion the worker can actually satisfy', () => {
    const contract = buildGraphDelegatedWorkerContract({
      normalizedPrompt: 'Write artifacts/tl3/risks.md.',
      goalId: 'risks-worker',
      goals: [
        delegatingGoal(['evidence.prefix:worker', 'evidence.artifact:artifacts/tl3/risks.md']),
      ],
    } as Parameters<typeof buildGraphDelegatedWorkerContract>[0]);

    expect(contract.prompt).toContain('evidence.artifact:artifacts/tl3/risks.md');
    expect(contract.prompt).not.toContain('evidence.prefix:worker');
  });
});
