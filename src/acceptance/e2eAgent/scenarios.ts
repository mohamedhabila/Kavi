// ---------------------------------------------------------------------------
// Kavi — E2E agent scenarios (structural rubrics, graph-owned flow)
// ---------------------------------------------------------------------------
import { E2E_BENCHMARK_SCENARIOS } from './benchmarkScenarios';
import { E2E_DIRECT_BENCHMARK_SCENARIOS } from './directBenchmarkScenarios';
import { E2E_CORE_MEMORY_SCENARIOS } from './scenariosCoreMemory';
import { E2E_CORE_MULTI_TURN_SCENARIOS } from './scenariosCoreMultiTurn';
import { E2E_CORE_WORKSPACE_SCENARIOS } from './scenariosCoreWorkspace';
import type { E2EScenario } from './types';

export const E2E_AGENT_SCENARIOS: ReadonlyArray<E2EScenario> = [
  ...E2E_CORE_WORKSPACE_SCENARIOS,
  ...E2E_CORE_MEMORY_SCENARIOS,
  ...E2E_CORE_MULTI_TURN_SCENARIOS,
  ...E2E_BENCHMARK_SCENARIOS,
  ...E2E_DIRECT_BENCHMARK_SCENARIOS,
];

export {
  DELEGATION_CHAIN_E2E_SCENARIO,
  DELEGATION_E2E_SCENARIO,
  DELEGATION_E2E_SCENARIOS,
} from './scenariosDelegation';
