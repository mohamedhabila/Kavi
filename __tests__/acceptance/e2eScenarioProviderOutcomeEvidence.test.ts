import { resolveScenarioProviderOutcomeEvidenceRequirements } from '../../src/acceptance/e2eAgent/scenarioProviderOutcomeEvidence';

describe('provider outcome evidence requirements', () => {
  it('derives waits only from rubrics with an explicit provider outcome', () => {
    expect(
      resolveScenarioProviderOutcomeEvidenceRequirements({
        rubrics: [
          { kind: 'turn_memory_receipt', turnIndex: 0 },
          { kind: 'turn_memory_receipt', turnIndex: 1, providerOutcome: 'valid' },
          { kind: 'turn_completion', turnIndex: 1, field: 'execution', expected: true },
          { kind: 'turn_memory_receipt', turnIndex: 1, providerOutcome: 'valid' },
          { kind: 'turn_memory_receipt', turnIndex: 2, providerOutcome: 'provider_error' },
        ],
      }),
    ).toEqual([
      { turnIndex: 1, providerOutcome: 'valid' },
      { turnIndex: 2, providerOutcome: 'provider_error' },
    ]);
  });
});
