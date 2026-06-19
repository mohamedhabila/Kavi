import {
  parseGoalMutationToolResultCodes,
  serializeGoalMutationToolErrors,
} from '../../../src/engine/goals/mutationErrors';

describe('goal mutation errors', () => {
  it('serializes validation errors with structural codes', () => {
    expect(
      serializeGoalMutationToolErrors([
        {
          goalId: 'scope-b',
          code: 'goal_not_found',
          message: 'Goal ID "scope-b" does not exist.',
        },
      ]),
    ).toEqual([
      {
        goalId: 'scope-b',
        code: 'goal_not_found',
        message: 'Goal ID "scope-b" does not exist.',
      },
    ]);
  });

  it('parses structured validation codes from update_goals tool results', () => {
    const codes = parseGoalMutationToolResultCodes(
      JSON.stringify({
        status: 'error',
        action: 'activate',
        structuredErrors: [
          { code: 'goal_not_found', message: 'missing' },
          { code: 'missing_title', message: 'title required' },
        ],
      }),
    );

    expect(codes).toEqual(['goal_not_found', 'missing_title']);
  });
});