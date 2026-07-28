import { resolveForegroundScenarioAllowedToolNames } from '../../src/acceptance/e2eAgent/foregroundScenarioDriverTypes';

describe('foreground scenario turn tool surfaces', () => {
  it('uses the turn surface when present and otherwise inherits the scenario surface', () => {
    const scenarioTools = ['memory_recall'];
    const turnTools = ['memory_search'];

    expect(resolveForegroundScenarioAllowedToolNames(scenarioTools, turnTools)).toBe(turnTools);
    expect(resolveForegroundScenarioAllowedToolNames(scenarioTools, undefined)).toBe(scenarioTools);
    expect(resolveForegroundScenarioAllowedToolNames(undefined, undefined)).toBeUndefined();
  });
});
