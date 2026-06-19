import { AGENT_BOOTSTRAP_FIXTURES } from '../../src/acceptance/acceptanceMetrics/agentBootstrapFixtures';
import { evaluateAgentBootstrapFixture } from '../../src/acceptance/acceptanceMetrics/evaluateAgentBootstrapFixture';

describe('agent goal materialization fixtures', () => {
  it('evaluates explicit graph-state outcomes without requiring a specific tool trace', () => {
    const missingGraphStateOutcome = evaluateAgentBootstrapFixture({
      id: 'bootstrap-missing-graph-state',
      turn1Goals: [],
      turn2Goals: [],
    });

    expect(missingGraphStateOutcome.passed).toBe(false);
    expect(missingGraphStateOutcome.detail).toContain('empty goals');
  });

  it('does not count completed-only history as a live bootstrapped goal', () => {
    const completedOnlyOutcome = evaluateAgentBootstrapFixture({
      id: 'bootstrap-completed-only',
      turn1Goals: [],
      turn2Goals: [
        {
          id: 'g-done',
          title: 'Completed history',
          status: 'completed',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(completedOnlyOutcome.passed).toBe(false);
    expect(completedOnlyOutcome.detail).toContain('no live goals');
  });

  it('passes fixtures whose expected graph state is materialized by turn 2', () => {
    const graphStateExpected = AGENT_BOOTSTRAP_FIXTURES.filter(
      (fixture) => fixture.turn1Goals.length === 0,
    );

    expect(graphStateExpected.length).toBeGreaterThan(0);
    for (const fixture of graphStateExpected) {
      expect(evaluateAgentBootstrapFixture(fixture).passed).toBe(true);
    }
  });
});
