import { isFactContributionSupersessionAuthorized } from '../../../src/services/memory/factContributionOperation';

describe('fact contribution operation supersession authorization', () => {
  it.each([
    { supersedePrior: false, predecessors: [], authorized: true },
    { supersedePrior: false, predecessors: ['fact-old'], authorized: false },
    { supersedePrior: true, predecessors: [], authorized: true },
    { supersedePrior: true, predecessors: ['fact-old', 'fact-older'], authorized: true },
  ])(
    'authorizes record supersedePrior=$supersedePrior with $predecessors.length predecessors',
    ({ supersedePrior, predecessors, authorized }) => {
      expect(
        isFactContributionSupersessionAuthorized({
          operation: { kind: 'record' },
          supersedePrior,
          contributedFactId: 'fact-new',
          predecessorFactIds: predecessors,
        }),
      ).toBe(authorized);
    },
  );

  it.each([
    { contributedFactId: 'fact-current', predecessors: [], authorized: true },
    { contributedFactId: 'fact-new', predecessors: [], authorized: false },
    { contributedFactId: 'fact-new', predecessors: ['fact-current'], authorized: true },
    { contributedFactId: 'fact-new', predecessors: ['fact-other'], authorized: false },
    {
      contributedFactId: 'fact-new',
      predecessors: ['fact-current', 'fact-other'],
      authorized: false,
    },
  ])(
    'authorizes exact replacement for contributed=$contributedFactId and predecessors=$predecessors',
    ({ contributedFactId, predecessors, authorized }) => {
      expect(
        isFactContributionSupersessionAuthorized({
          operation: { kind: 'exact_replacement', expectedCurrentFactId: 'fact-current' },
          supersedePrior: false,
          contributedFactId,
          predecessorFactIds: predecessors,
        }),
      ).toBe(authorized);
    },
  );

  it('rejects exact replacement when record-style supersession is requested', () => {
    expect(
      isFactContributionSupersessionAuthorized({
        operation: { kind: 'exact_replacement', expectedCurrentFactId: 'fact-current' },
        supersedePrior: true,
        contributedFactId: 'fact-new',
        predecessorFactIds: ['fact-current'],
      }),
    ).toBe(false);
  });
});
