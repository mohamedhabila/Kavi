import {
  createInitialAgentRunControlGraphState,
  normalizeAgentRunControlGraphGoals,
  normalizeAgentRunControlGraphToolResultRefs,
  prepareAgentRunControlGraphForResume,
} from '../../../src/services/agents/agentControlGraphState';

describe('normalizeAgentRunControlGraphGoals', () => {
  it('preserves success criteria and blocked reason on graph-owned goals', () => {
    const goals = normalizeAgentRunControlGraphGoals([
      {
        id: 'g1',
        title: 'Verify calendar',
        status: 'active',
        dependencies: [],
        evidence: ['calendar_list:[{"allowsModifications":true}]'],
        successCriteria: ['evidence.json_field:allowsModifications:true'],
        blockedReason: 'gate:g1:evidence.min:1',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(goals).toEqual([
      expect.objectContaining({
        id: 'g1',
        successCriteria: ['evidence.json_field:allowsModifications:true'],
        blockedReason: 'gate:g1:evidence.min:1',
      }),
    ]);
  });

  it('hydrates only exact canonical constraints on blocking goals', () => {
    const baseGoal = {
      title: 'Create local report',
      status: 'active' as const,
      dependencies: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const goals = normalizeAgentRunControlGraphGoals([
      {
        ...baseGoal,
        id: 'canonical',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: 'Keep local', sourceMessageId: 'user-1' }],
      },
      {
        ...baseGoal,
        id: 'malformed',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: ' Keep  local ', sourceMessageId: 'user-1' }],
      } as never,
      {
        ...baseGoal,
        id: 'persistent',
        completionPolicy: 'persistent',
        userConstraints: [{ text: 'Keep local', sourceMessageId: 'user-1' }],
      } as never,
    ]);

    expect(goals.find((goal) => goal.id === 'canonical')?.userConstraints).toEqual([
      { text: 'Keep local', sourceMessageId: 'user-1' },
    ]);
    expect(goals.find((goal) => goal.id === 'malformed')).toMatchObject({
      userConstraintIntegrity: 'conflict',
    });
    expect(goals.find((goal) => goal.id === 'persistent')).toMatchObject({
      userConstraintIntegrity: 'conflict',
    });

    const rehydrated = normalizeAgentRunControlGraphGoals(goals);
    expect(rehydrated.find((goal) => goal.id === 'malformed')).toMatchObject({
      userConstraintIntegrity: 'conflict',
    });
  });

  it('preserves delivery-pending markers across hydration', () => {
    const goals = normalizeAgentRunControlGraphGoals([
      {
        id: 'done',
        title: 'Completed constrained goal',
        status: 'completed',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
        userConstraintDeliveryPending: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(goals[0]?.userConstraintDeliveryPending).toBe(true);
    expect(normalizeAgentRunControlGraphGoals(goals)[0]?.userConstraintDeliveryPending).toBe(true);
  });

  it('fails closed without retaining raw text when a completed constraint lacks its marker', () => {
    const goals = normalizeAgentRunControlGraphGoals([
      {
        id: 'invalid-completed',
        title: 'Completed constrained goal',
        status: 'completed',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: ['verified'],
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      },
    ]);

    expect(goals[0]).toMatchObject({
      userConstraintIntegrity: 'conflict',
      userConstraintDeliveryPending: true,
    });
    expect(goals[0]).not.toHaveProperty('userConstraints');
  });

  it('fails closed on run-global capacity and source-lineage conflicts', () => {
    const base = {
      title: 'Constrained goal',
      status: 'active' as const,
      completionPolicy: 'blocking' as const,
      dependencies: [],
      evidence: [],
      successCriteria: ['evidence.tool:read_file'],
      createdAt: 1,
      updatedAt: 1,
    };
    const overBound = normalizeAgentRunControlGraphGoals([
      {
        ...base,
        id: 'first',
        userConstraints: Array.from({ length: 4 }, (_, index) => ({
          text: `First statement ${index}`,
          sourceMessageId: `first-${index}`,
        })),
      },
      {
        ...base,
        id: 'second',
        userConstraints: Array.from({ length: 5 }, (_, index) => ({
          text: `Second statement ${index}`,
          sourceMessageId: `second-${index}`,
        })),
      },
    ]);
    expect(overBound).toEqual([
      expect.objectContaining({ id: 'first', userConstraintIntegrity: 'conflict' }),
      expect.objectContaining({ id: 'second', userConstraintIntegrity: 'conflict' }),
    ]);
    expect(overBound.every((goal) => goal.userConstraints === undefined)).toBe(true);

    const lineage = normalizeAgentRunControlGraphGoals([
      {
        ...base,
        id: 'completed-a',
        status: 'completed',
        userConstraints: [{ text: 'Statement A', sourceMessageId: 'same-source' }],
      },
      {
        ...base,
        id: 'completed-b',
        status: 'completed',
        userConstraints: [{ text: 'Statement B', sourceMessageId: 'same-source' }],
      },
      {
        ...base,
        id: 'active-a',
        userConstraints: [{ text: 'Statement A', sourceMessageId: 'same-source' }],
      },
    ]);
    expect(lineage.map((goal) => goal.userConstraintIntegrity)).toEqual([
      'conflict',
      'conflict',
      'conflict',
    ]);
  });
});

describe('prepareAgentRunControlGraphForResume constraint delivery', () => {
  const deliveryGoal = {
    id: 'done',
    title: 'Completed constrained goal',
    status: 'completed' as const,
    completionPolicy: 'blocking' as const,
    dependencies: [],
    evidence: [],
    successCriteria: ['evidence.tool:read_file'],
    userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
    userConstraintDeliveryPending: true as const,
    createdAt: 1,
    updatedAt: 1,
  };

  it.each(['failed', 'blocked', 'yielded', 'finalized', 'awaiting_review'] as const)(
    'preserves pending delivery when resuming %s state without an acknowledgement',
    (status) => {
      const resumed = prepareAgentRunControlGraphForResume(
        createInitialAgentRunControlGraphState({ status, goals: [deliveryGoal] }),
        { updatedAt: 2 },
      );
      expect(resumed?.status).toBe('ready');
      expect(resumed?.goals?.[0]?.userConstraintDeliveryPending).toBe(true);
    },
  );

  it('clears pending delivery when cancelled work is intentionally abandoned', () => {
    const conflictedGoal = {
      ...deliveryGoal,
      id: 'conflicted',
      userConstraints: undefined,
      userConstraintIntegrity: 'conflict' as const,
    };
    const resumed = prepareAgentRunControlGraphForResume(
      createInitialAgentRunControlGraphState({
        status: 'cancelled',
        goals: [deliveryGoal, conflictedGoal],
      }),
      { updatedAt: 2 },
    );
    for (const goal of resumed?.goals ?? []) {
      expect(goal).not.toHaveProperty('userConstraintDeliveryPending');
      expect(goal).not.toHaveProperty('userConstraints');
      expect(goal).not.toHaveProperty('userConstraintIntegrity');
    }
  });
});

describe('normalizeAgentRunControlGraphToolResultRefs', () => {
  it('preserves canonicalization trace flags on observed tool results', () => {
    const results = normalizeAgentRunControlGraphToolResultRefs([
      {
        id: 'tc-goals',
        name: 'update_goals',
        canonicalized: true,
        graphApplied: true,
      },
      {
        id: 'tc-raw',
        name: 'read_file',
        canonicalized: false,
        graphApplied: false,
      },
    ]);

    expect(results).toEqual([
      {
        id: 'tc-goals',
        name: 'update_goals',
        canonicalized: true,
        graphApplied: true,
      },
      {
        id: 'tc-raw',
        name: 'read_file',
      },
    ]);
  });
});
