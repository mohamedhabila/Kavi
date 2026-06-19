import { DELEGATION_E2E_SCENARIOS, E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import {
  E2E_ASSESSMENT_DIMENSIONS,
  type E2EAssessmentDimension,
} from '../../src/acceptance/e2eAgent/e2eAssessmentDimensions';
import {
  E2E_BENCHMARK_FAMILIES,
  E2E_SCENARIO_BENCHMARK_REGISTRY,
  lookupE2EScenarioBenchmarkMeta,
} from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';

const MIN_SCENARIOS_PER_DIMENSION = 2;

describe('e2eAssessmentCoverage', () => {
  const allScenarioIds = [
    ...E2E_AGENT_SCENARIOS.map((scenario) => scenario.id),
    ...DELEGATION_E2E_SCENARIOS.map((scenario) => scenario.id),
  ];

  it('registers every live scenario in the benchmark registry', () => {
    for (const scenarioId of allScenarioIds) {
      expect(E2E_SCENARIO_BENCHMARK_REGISTRY[scenarioId]).toBeDefined();
      const meta = lookupE2EScenarioBenchmarkMeta(scenarioId);
      expect(meta.benchmarkFamilies.length).toBeGreaterThan(0);
      expect(meta.assessmentDimensions.length).toBeGreaterThan(0);
    }
  });

  it('maps every assessment dimension to at least two scenarios', () => {
    const dimensionScenarioIds = new Map<E2EAssessmentDimension, string[]>();

    for (const scenarioId of allScenarioIds) {
      const { assessmentDimensions } = lookupE2EScenarioBenchmarkMeta(scenarioId);
      for (const dimension of assessmentDimensions) {
        const existing = dimensionScenarioIds.get(dimension) ?? [];
        existing.push(scenarioId);
        dimensionScenarioIds.set(dimension, existing);
      }
    }

    for (const dimension of E2E_ASSESSMENT_DIMENSIONS) {
      const scenarioIds = dimensionScenarioIds.get(dimension) ?? [];
      expect(scenarioIds.length).toBeGreaterThanOrEqual(MIN_SCENARIOS_PER_DIMENSION);
    }
  });

  it('maps every benchmark family to at least one scenario', () => {
    const familyScenarioIds = new Map<string, string[]>();

    for (const scenarioId of allScenarioIds) {
      const { benchmarkFamilies } = lookupE2EScenarioBenchmarkMeta(scenarioId);
      for (const family of benchmarkFamilies) {
        const existing = familyScenarioIds.get(family) ?? [];
        existing.push(scenarioId);
        familyScenarioIds.set(family, existing);
      }
    }

    for (const family of E2E_BENCHMARK_FAMILIES) {
      expect(familyScenarioIds.get(family)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});