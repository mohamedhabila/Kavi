import { evaluateAcceptanceFixture } from '../../src/acceptance/evaluateFixture';
import { ACCEPTANCE_TASK_FIXTURES } from '../../src/acceptance/taskFixtures';

describe('acceptance task fixtures', () => {
  it.each(ACCEPTANCE_TASK_FIXTURES.map((fixture) => [fixture.id, fixture]))(
    'meets token and tool-call ceilings for %s',
    (_id, fixture) => {
      const evaluation = evaluateAcceptanceFixture(fixture);
      expect(evaluation.violations).toEqual([]);
      expect(evaluation.passed).toBe(true);
    },
  );

  it('meets the web research acceptance bar on the research fixture', () => {
    const evaluation = evaluateAcceptanceFixture(
      ACCEPTANCE_TASK_FIXTURES.find((fixture) => fixture.id === 'research')!,
    );

    expect(evaluation.totalToolCalls).toBeLessThanOrEqual(5);
    expect(evaluation.totalTokens).toBeLessThanOrEqual(35_000);
    expect(evaluation.passed).toBe(true);
  });
});