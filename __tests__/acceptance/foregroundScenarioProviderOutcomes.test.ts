import { resolveForegroundScenarioProviderOutcomes } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverTypes';

describe('foreground scenario provider outcome requirements', () => {
  it('supports one exact outcome or an evaluator-owned acceptable set', () => {
    expect(
      resolveForegroundScenarioProviderOutcomes({ turnIndex: 0, providerOutcome: 'valid' }),
    ).toEqual(['valid']);
    expect(
      resolveForegroundScenarioProviderOutcomes({
        turnIndex: 0,
        providerOutcomes: ['valid', 'empty_valid'],
      }),
    ).toEqual(['valid', 'empty_valid']);
  });
});
