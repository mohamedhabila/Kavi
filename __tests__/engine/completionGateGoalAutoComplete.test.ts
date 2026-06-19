import {
  buildDelegationEvidenceAutoCompleteEvent,
  DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION,
  findDelegationEvidenceSatisfiedGoals,
} from '../../src/engine/graph/completionGateGoalAutoComplete';
import { createGoal } from '../../src/engine/goals/types';

describe('completionGateGoalAutoComplete', () => {
  it('finds active delegation goals with satisfied worker evidence criteria', () => {
    const goals = [
      createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'active',
        successCriteria: [DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION, 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
      }),
    ];

    expect(findDelegationEvidenceSatisfiedGoals(goals).map((goal) => goal.id)).toEqual([
      'worker-chain',
    ]);
  });

  it('finds blocked delegation goals with satisfied worker evidence criteria', () => {
    const goals = [
      createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'blocked',
        successCriteria: [DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION, 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
        blockedReason: 'gate:worker-chain:evidence.min:1',
      }),
    ];

    expect(findDelegationEvidenceSatisfiedGoals(goals).map((goal) => goal.id)).toEqual([
      'worker-chain',
    ]);
  });

  it('builds auto-complete graph events for delegation goals', () => {
    const goals = [
      createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'active',
        successCriteria: [DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION, 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
      }),
    ];

    const event = buildDelegationEvidenceAutoCompleteEvent({ goals, now: 42 });
    expect(event).toEqual(
      expect.objectContaining({
        type: 'GOALS_UPDATED',
        reason: 'completion_gate:auto_complete',
        goals: [
          expect.objectContaining({
            id: 'worker-chain',
            status: 'completed',
          }),
        ],
        timestamp: 42,
      }),
    );
  });
});