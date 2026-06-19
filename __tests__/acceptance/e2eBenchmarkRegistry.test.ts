import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';
import {
  E2E_BENCHMARK_FAMILIES,
  E2E_SCENARIO_BENCHMARK_REGISTRY,
  listRegisteredE2EScenarioIds,
  lookupE2EScenarioBenchmarkMeta,
} from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import { E2E_ASSESSMENT_DIMENSIONS } from '../../src/acceptance/e2eAgent/e2eAssessmentDimensions';

describe('e2eBenchmarkRegistry', () => {
  it('registers every core and benchmark scenario id', () => {
    const scenarioIds = [
      ...E2E_AGENT_SCENARIOS.map((scenario) => scenario.id),
      ...DELEGATION_E2E_SCENARIOS.map((scenario) => scenario.id),
    ];
    const registered = new Set(listRegisteredE2EScenarioIds());

    for (const scenarioId of scenarioIds) {
      expect(registered.has(scenarioId)).toBe(true);
      const meta = lookupE2EScenarioBenchmarkMeta(scenarioId);
      expect(meta.benchmarkFamilies.length).toBeGreaterThan(0);
      expect(meta.assessmentDimensions.length).toBeGreaterThan(0);
    }
  });

  it('uses known benchmark families and assessment dimensions only', () => {
    const familySet = new Set(E2E_BENCHMARK_FAMILIES);
    const dimensionSet = new Set(E2E_ASSESSMENT_DIMENSIONS);

    for (const registration of Object.values(E2E_SCENARIO_BENCHMARK_REGISTRY)) {
      for (const family of registration.benchmarkFamilies) {
        expect(familySet.has(family)).toBe(true);
      }
      for (const dimension of registration.assessmentDimensions) {
        expect(dimensionSet.has(dimension)).toBe(true);
      }
    }
  });

  it('tags benchmark-adapted scenarios with external families', () => {
    const benchmarkScenarioIds = E2E_AGENT_SCENARIOS.filter((scenario) =>
      scenario.id.startsWith('bench-'),
    ).map((scenario) => scenario.id);

    expect(benchmarkScenarioIds.length).toBeGreaterThanOrEqual(12);

    for (const scenarioId of benchmarkScenarioIds) {
      const meta = lookupE2EScenarioBenchmarkMeta(scenarioId);
      expect(meta.benchmarkFamilies.some((family) => family !== 'kavi-core')).toBe(true);
    }
  });

  it('tags direct benchmark-port scenarios with direct families', () => {
    const directScenarioIds = E2E_AGENT_SCENARIOS.filter((scenario) =>
      scenario.id.startsWith('direct-'),
    ).map((scenario) => scenario.id);

    expect(directScenarioIds.length).toBeGreaterThanOrEqual(8);

    for (const scenarioId of directScenarioIds) {
      const meta = lookupE2EScenarioBenchmarkMeta(scenarioId);
      expect(meta.benchmarkFamilies.some((family) => family.endsWith('-direct'))).toBe(true);
      expect(meta.assessmentDimensions.length).toBeGreaterThan(0);
    }
  });
});
