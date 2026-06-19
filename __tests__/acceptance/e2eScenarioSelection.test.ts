import {
  filterE2EScenarioSuiteEntries,
  parseE2EScenarioIdFilter,
} from '../../src/acceptance/e2eAgent/scenarioSelection';
import type { E2EScenario } from '../../src/acceptance/e2eAgent/types';

function scenario(id: string): E2EScenario {
  return {
    id,
    conversationId: `conv-${id}`,
    prompt: `Prompt ${id}`,
    rubrics: [],
  };
}

describe('e2e scenario selection', () => {
  const entries = [
    { suite: 'core', scenario: scenario('scenario-a') },
    { suite: 'core', scenario: scenario('scenario-b') },
    { suite: 'delegation', scenario: scenario('scenario-c') },
  ];

  it('parses comma and whitespace separated scenario ids', () => {
    expect([...(parseE2EScenarioIdFilter('scenario-a, scenario-b\nscenario-c') ?? [])]).toEqual([
      'scenario-a',
      'scenario-b',
      'scenario-c',
    ]);
    expect(parseE2EScenarioIdFilter('   ')).toBeNull();
  });

  it('filters scenario suite entries by id without changing default full-suite behavior', () => {
    expect(filterE2EScenarioSuiteEntries(entries).map((entry) => entry.scenario.id)).toEqual([
      'scenario-a',
      'scenario-b',
      'scenario-c',
    ]);
    expect(
      filterE2EScenarioSuiteEntries(entries, 'scenario-c,scenario-a').map(
        (entry) => entry.scenario.id,
      ),
    ).toEqual(['scenario-a', 'scenario-c']);
  });

  it('rejects unknown scenario ids', () => {
    expect(() => filterE2EScenarioSuiteEntries(entries, 'scenario-a,missing')).toThrow(
      'Unknown E2E scenario ids: missing',
    );
  });
});
