import { readPendingGoalUserConstraintDelivery } from '../../../src/engine/goals/userConstraintFinalDelivery';
import type { AgentGoal } from '../../../src/types/agentRun';

function goal(overrides: Partial<AgentGoal>): AgentGoal {
  return {
    id: 'goal-1',
    title: 'Deliver result',
    status: 'completed',
    dependencies: [],
    evidence: ['verified'],
    successCriteria: ['Deliver the verified result.'],
    completionPolicy: 'blocking',
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    ...overrides,
  };
}

describe('pending goal user constraint delivery', () => {
  it('preserves goal scope and within-goal chronology without exposing source ids', () => {
    const result = readPendingGoalUserConstraintDelivery([
      goal({
        id: 'language',
        userConstraintDeliveryPending: true,
        userConstraints: [
          { text: 'Answer in Dutch.', sourceMessageId: 'user-1' },
          { text: 'Use formal Dutch.', sourceMessageId: 'user-2' },
        ],
      }),
      goal({
        id: 'format',
        userConstraintDeliveryPending: true,
        userConstraints: [{ text: 'Return exactly three bullets.', sourceMessageId: 'user-3' }],
      }),
    ]);

    expect(result).toEqual({
      state: 'canonical',
      entries: [
        { goalId: 'language', text: 'Answer in Dutch.' },
        { goalId: 'language', text: 'Use formal Dutch.' },
        { goalId: 'format', text: 'Return exactly three bullets.' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('user-1');
  });

  it('ignores a settled historical conflict when no delivery obligation remains', () => {
    expect(
      readPendingGoalUserConstraintDelivery([
        goal({ id: 'settled-history', userConstraintIntegrity: 'conflict' }),
        goal({ id: 'current-unconstrained', evidence: ['Current verified answer'] }),
      ]),
    ).toEqual({ state: 'absent' });
  });

  it('fails closed for a conflicted pending obligation', () => {
    expect(
      readPendingGoalUserConstraintDelivery([
        goal({
          userConstraintDeliveryPending: true,
          userConstraintIntegrity: 'conflict',
        }),
      ]),
    ).toEqual({ state: 'conflict' });
  });

  it('fails closed for run-global capacity and source-lineage conflicts', () => {
    const overCapacity = readPendingGoalUserConstraintDelivery([
      goal({
        id: 'first',
        userConstraintDeliveryPending: true,
        userConstraints: Array.from({ length: 4 }, (_, index) => ({
          text: `First delivery constraint ${index}`,
          sourceMessageId: `first-${index}`,
        })),
      }),
      goal({
        id: 'second',
        userConstraintDeliveryPending: true,
        userConstraints: Array.from({ length: 5 }, (_, index) => ({
          text: `Second delivery constraint ${index}`,
          sourceMessageId: `second-${index}`,
        })),
      }),
    ]);
    expect(overCapacity).toEqual({ state: 'conflict' });

    const conflictingLineage = readPendingGoalUserConstraintDelivery([
      goal({
        id: 'first',
        userConstraintDeliveryPending: true,
        userConstraints: [{ text: 'Answer in Dutch.', sourceMessageId: 'same-source' }],
      }),
      goal({
        id: 'second',
        userConstraintDeliveryPending: true,
        userConstraints: [{ text: 'Answer in English.', sourceMessageId: 'same-source' }],
      }),
    ]);
    expect(conflictingLineage).toEqual({ state: 'conflict' });
  });

  it('rejects a delivery marker on a non-completed or non-blocking goal', () => {
    const constraint = [{ text: 'Answer in Dutch.', sourceMessageId: 'user-1' }];

    expect(
      readPendingGoalUserConstraintDelivery([
        goal({
          status: 'active',
          completedAt: undefined,
          userConstraintDeliveryPending: true,
          userConstraints: constraint,
        }),
      ]),
    ).toEqual({ state: 'conflict' });
    expect(
      readPendingGoalUserConstraintDelivery([
        goal({
          completionPolicy: 'persistent',
          userConstraintDeliveryPending: true,
          userConstraints: constraint,
        }),
      ]),
    ).toEqual({ state: 'conflict' });
  });
});
