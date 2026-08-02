import { applyGoalMutation } from '../../../src/engine/goals/graphState';
import { createGoal } from '../../../src/engine/goals/types';
import { validateGoalMutation } from '../../../src/engine/goals/validation';

const SUCCESS_CRITERIA = ['evidence.tool:read_file'];

function blockingGoal(
  id: string,
  userConstraints: Array<{ text: string; sourceMessageId: string }> = [],
) {
  return createGoal({
    id,
    title: id,
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: SUCCESS_CRITERIA,
    ...(userConstraints.length ? { userConstraints } : {}),
    now: 1,
  });
}

describe('goal user constraint application', () => {
  it('automatically retains the initial blocking task contract', () => {
    const text = [
      'Create and verify the release pack. Use exactly one worker and keep all results local.',
      ...Array.from(
        { length: 48 },
        (_, index) => `Requirement ${index + 1}: preserve this exact acceptance condition.`,
      ),
    ].join('\n');
    expect(Array.from(text).length).toBeGreaterThan(512);
    const result = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'release-pack',
            title: 'Create release pack',
            status: 'active',
            completionPolicy: 'blocking',
            successCriteria: SUCCESS_CRITERIA,
          },
        ],
      },
      2,
      { currentUserMessage: { id: 'user-current', text } },
    );

    expect(result.errors).toEqual([]);
    expect(result.goals[0]?.userConstraints).toEqual([{ text, sourceMessageId: 'user-current' }]);
  });

  it('grounds an add to the code-owned current message without granting evidence or authority', () => {
    const result = applyGoalMutation(
      [],
      {
        action: 'add',
        goals: [
          {
            id: 'local-report',
            title: 'Create local report',
            completionPolicy: 'blocking',
            successCriteria: SUCCESS_CRITERIA,
            retainCurrentUserConstraint: true,
          },
        ],
      },
      2,
      {
        currentUserMessage: {
          id: 'user-current',
          text: 'Create the report. No external uploads.',
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.goals[0]).toMatchObject({
      id: 'local-report',
      completionPolicy: 'blocking',
      evidence: [],
      successCriteria: SUCCESS_CRITERIA,
      userConstraints: [
        {
          text: 'Create the report. No external uploads.',
          sourceMessageId: 'user-current',
        },
      ],
    });
  });

  it('appends grounded update constraints and preserves their source lineage', () => {
    const existing = blockingGoal('local-report', [
      { text: 'Use Dutch', sourceMessageId: 'user-earlier' },
    ]);
    const result = applyGoalMutation(
      [existing],
      {
        action: 'update',
        goals: [{ id: existing.id, retainCurrentUserConstraint: true }],
      },
      3,
      {
        currentUserMessage: {
          id: 'user-current',
          text: 'No external uploads. Keep the draft local.',
        },
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.goals[0].userConstraints).toEqual([
      { text: 'Use Dutch', sourceMessageId: 'user-earlier' },
      {
        text: 'No external uploads. Keep the draft local.',
        sourceMessageId: 'user-current',
      },
    ]);
  });

  it.each([
    {
      label: 'missing current message',
      currentUserMessage: undefined,
    },
    {
      label: 'invalid current message',
      currentUserMessage: { id: 'user-current', text: 'Keep\u200b local.' },
    },
  ])('rejects $label without mutating the graph', ({ currentUserMessage }) => {
    const existing = blockingGoal('local-report');
    const result = applyGoalMutation(
      [existing],
      {
        action: 'update',
        goals: [{ id: existing.id, retainCurrentUserConstraint: true }],
      },
      3,
      { currentUserMessage },
    );

    expect(result.errors.join(' ')).toContain('Unable to retain the entire code-owned');
    expect(result.goals).toEqual([existing]);
  });

  it('rejects duplicate-existing and over-limit appends without mutating the graph', () => {
    const duplicateGoal = blockingGoal('duplicate', [
      { text: 'Keep local.', sourceMessageId: 'user-earlier' },
    ]);
    const duplicateMutation = {
      action: 'update' as const,
      goals: [{ id: duplicateGoal.id, retainCurrentUserConstraint: true }],
    };
    expect(
      validateGoalMutation(duplicateMutation, [duplicateGoal], {
        currentUserMessage: { id: 'user-current', text: 'Keep local.' },
      }).errors,
    ).toContainEqual(expect.objectContaining({ code: 'duplicate_user_constraints' }));
    expect(
      applyGoalMutation([duplicateGoal], duplicateMutation, 3, {
        currentUserMessage: { id: 'user-current', text: 'Keep local.' },
      }).goals,
    ).toEqual([duplicateGoal]);

    const fullGoal = blockingGoal(
      'full',
      Array.from({ length: 8 }, (_, index) => ({
        text: `Existing constraint ${index + 1}`,
        sourceMessageId: `user-${index + 1}`,
      })),
    );
    const overLimitMutation = {
      action: 'update' as const,
      goals: [
        {
          id: fullGoal.id,
          retainCurrentUserConstraint: true,
        },
      ],
    };
    expect(
      validateGoalMutation(overLimitMutation, [fullGoal], {
        currentUserMessage: {
          id: 'user-current',
          text: 'New constraint 1. New constraint 2.',
        },
      }).errors,
    ).toContainEqual(expect.objectContaining({ code: 'invalid_user_constraints' }));
    expect(
      applyGoalMutation([fullGoal], overLimitMutation, 3, {
        currentUserMessage: {
          id: 'user-current',
          text: 'New constraint 1. New constraint 2.',
        },
      }).goals,
    ).toEqual([fullGoal]);
  });

  it('rejects constraints on persistent or completed goals', () => {
    const persistent = createGoal({
      id: 'ongoing',
      title: 'Ongoing focus',
      completionPolicy: 'persistent',
      now: 1,
    });
    const completed = createGoal({
      id: 'done',
      title: 'Done',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: SUCCESS_CRITERIA,
      now: 1,
    });
    const context = { currentUserMessage: { id: 'user-current', text: 'Keep local.' } };

    for (const goal of [persistent, completed]) {
      const result = validateGoalMutation(
        {
          action: 'update',
          goals: [{ id: goal.id, retainCurrentUserConstraint: true }],
        },
        [goal],
        context,
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'unsupported_user_constraints' }),
      );
    }
  });

  it('requires a specific structural contract when a constrained update becomes blocking', () => {
    const persistent = createGoal({
      id: 'ongoing',
      title: 'Ongoing focus',
      completionPolicy: 'persistent',
      now: 1,
    });
    const context = { currentUserMessage: { id: 'user-current', text: 'Keep local.' } };
    const mutation = {
      action: 'update' as const,
      goals: [
        {
          id: persistent.id,
          completionPolicy: 'blocking' as const,
          retainCurrentUserConstraint: true,
        },
      ],
    };

    expect(validateGoalMutation(mutation, [persistent], context).errors).toContainEqual(
      expect.objectContaining({ code: 'missing_success_criteria' }),
    );
    expect(applyGoalMutation([persistent], mutation, 3, context).goals).toEqual([persistent]);

    const countOnlyMutation = {
      ...mutation,
      goals: [{ ...mutation.goals[0], successCriteria: ['evidence.min:1'] }],
    };
    expect(validateGoalMutation(countOnlyMutation, [persistent], context).errors).toContainEqual(
      expect.objectContaining({ code: 'weak_success_criteria' }),
    );
    expect(applyGoalMutation([persistent], countOnlyMutation, 3, context).goals).toEqual([
      persistent,
    ]);
  });

  it('validates run-global retention capacity atomically across a multi-patch mutation', () => {
    const first = blockingGoal(
      'first',
      Array.from({ length: 7 }, (_, index) => ({
        text: `Existing statement ${index}`,
        sourceMessageId: `user-${index}`,
      })),
    );
    const second = { ...blockingGoal('second'), status: 'pending' as const };
    const mutation = {
      action: 'update' as const,
      goals: [
        { id: first.id, retainCurrentUserConstraint: true as const },
        { id: second.id, retainCurrentUserConstraint: true as const },
      ],
    };

    expect(
      validateGoalMutation(mutation, [first, second], {
        currentUserMessage: { id: 'user-current', text: 'Keep everything local.' },
      }).errors,
    ).toContainEqual(expect.objectContaining({ code: 'invalid_user_constraints' }));
    expect(
      applyGoalMutation([first, second], mutation, 3, {
        currentUserMessage: { id: 'user-current', text: 'Keep everything local.' },
      }).goals,
    ).toEqual([first, second]);
  });

  it('combines retention with dependency-safe activation and demotes the prior active goal', () => {
    const active = blockingGoal('active');
    const prerequisite = createGoal({
      id: 'prerequisite',
      title: 'Completed prerequisite',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: SUCCESS_CRITERIA,
      evidence: ['read_file:observed'],
      now: 1,
    });
    const pending = createGoal({
      id: 'pending',
      title: 'Pending constrained work',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: SUCCESS_CRITERIA,
      dependencies: [prerequisite.id],
      now: 1,
    });
    const result = applyGoalMutation(
      [prerequisite, active, pending],
      {
        action: 'update',
        goals: [
          {
            id: pending.id,
            status: 'active',
            retainCurrentUserConstraint: true,
          },
        ],
      },
      3,
      { currentUserMessage: { id: 'user-current', text: 'Keep the result local.' } },
    );

    expect(result.errors).toEqual([]);
    expect(result.goals.find((goal) => goal.id === active.id)?.status).toBe('pending');
    expect(result.goals.find((goal) => goal.id === pending.id)).toMatchObject({
      status: 'active',
      userConstraints: [{ text: 'Keep the result local.', sourceMessageId: 'user-current' }],
    });
  });

  it('prevents blocking updates from clearing or weakening structural criteria', () => {
    const existing = blockingGoal('local-report');

    for (const [successCriteria, code] of [
      [[], 'missing_success_criteria'],
      [['evidence.min:1'], 'weak_success_criteria'],
    ] as const) {
      const mutation = {
        action: 'update' as const,
        goals: [{ id: existing.id, successCriteria: [...successCriteria] }],
      };
      expect(validateGoalMutation(mutation, [existing]).errors).toContainEqual(
        expect.objectContaining({ code }),
      );
      expect(applyGoalMutation([existing], mutation, 3).goals).toEqual([existing]);
    }
  });

  it('keeps blocking criteria monotonic and forbids conversion to persistent', () => {
    const existing = createGoal({
      id: 'local-report',
      title: 'Create local report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:write_file'],
      evidence: ['read_file:observed'],
      now: 1,
    });
    const replacement = {
      action: 'update' as const,
      goals: [
        {
          id: existing.id,
          successCriteria: ['evidence.tool:read_file'],
        },
      ],
    };
    expect(validateGoalMutation(replacement, [existing]).errors).toContainEqual(
      expect.objectContaining({ code: 'invalid_success_criteria' }),
    );
    expect(applyGoalMutation([existing], replacement, 3).goals).toEqual([existing]);

    const persistentConversion = {
      action: 'update' as const,
      goals: [{ id: existing.id, completionPolicy: 'persistent' as const }],
    };
    expect(validateGoalMutation(persistentConversion, [existing]).errors).toContainEqual(
      expect.objectContaining({ code: 'invalid_lifecycle' }),
    );
    expect(applyGoalMutation([existing], persistentConversion, 3).goals).toEqual([existing]);
  });

  it('marks explicitly completed constrained goals until final delivery', () => {
    const existing = createGoal({
      id: 'local-report',
      title: 'Create local report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: SUCCESS_CRITERIA,
      evidence: ['read_file:observed'],
      userConstraints: [{ text: 'Reply in Dutch', sourceMessageId: 'user-1' }],
      now: 1,
    });
    const result = applyGoalMutation(
      [existing],
      { action: 'complete', goals: [{ id: existing.id }] },
      3,
    );

    expect(result.errors).toEqual([]);
    expect(result.goals[0]).toMatchObject({
      status: 'completed',
      userConstraintDeliveryPending: true,
      userConstraints: [{ text: 'Reply in Dutch', sourceMessageId: 'user-1' }],
    });
  });

  it('rejects direct and cascading removal of constrained goals', () => {
    const constrained = createGoal({
      id: 'constrained',
      title: 'Constrained work',
      status: 'pending',
      completionPolicy: 'blocking',
      successCriteria: SUCCESS_CRITERIA,
      userConstraints: [{ text: 'Keep local', sourceMessageId: 'user-1' }],
      now: 1,
    });
    const direct = { action: 'remove' as const, goals: [{ id: constrained.id }] };
    expect(validateGoalMutation(direct, [constrained]).errors).toContainEqual(
      expect.objectContaining({
        goalId: constrained.id,
        code: 'unsupported_user_constraints',
      }),
    );
    expect(applyGoalMutation([constrained], direct, 3).goals).toEqual([constrained]);

    const ancestor = createGoal({
      id: 'ancestor',
      title: 'Ancestor',
      status: 'pending',
      completionPolicy: 'persistent',
      now: 1,
    });
    const dependent = { ...constrained, id: 'dependent', dependencies: [ancestor.id] };
    const cascade = { action: 'remove' as const, goals: [{ id: ancestor.id }] };
    expect(validateGoalMutation(cascade, [ancestor, dependent]).errors).toContainEqual(
      expect.objectContaining({
        goalId: dependent.id,
        code: 'unsupported_user_constraints',
      }),
    );
    expect(applyGoalMutation([ancestor, dependent], cascade, 3).goals).toEqual([
      ancestor,
      dependent,
    ]);

    const settled = {
      ...constrained,
      status: 'completed' as const,
      completedAt: 2,
    };
    const cleanup = { action: 'remove' as const, goals: [{ id: settled.id }] };
    expect(validateGoalMutation(cleanup, [settled]).errors).toEqual([]);
    expect(applyGoalMutation([settled], cleanup, 3).goals).toEqual([]);
    expect(
      validateGoalMutation({ action: 'activate', goals: [{ id: settled.id }] }, [settled]).errors,
    ).toContainEqual(expect.objectContaining({ code: 'invalid_lifecycle' }));
  });
});
