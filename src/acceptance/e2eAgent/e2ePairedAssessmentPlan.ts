import type { LlmProviderConfig } from '../../types/provider';
import {
  buildE2EPairedConditionPlan,
  buildE2EPairedExecutionPlan,
  E2E_PAIRED_CONDITIONS,
  type E2EPairedCondition,
  type E2EPairedExecutionPlan,
} from './e2ePairedConditions';
import {
  buildE2EPairedInvariantConfig,
  resolveDefaultE2EPairedToolSurface,
} from './e2ePairedInvariant';
import { resolveE2EScenarioSystemPrompt } from './scenarioRunner';
import { resolveE2EScenarioTimeoutMs } from './scenarioTimeout';
import {
  E2E_DEFAULT_MAX_TOKENS,
  E2E_DEFAULT_MEMORY_TIMEOUT_MS,
  E2E_PER_USER_TURN_TIMEOUT_MS,
} from './thresholds';
import type { E2EScenario } from './types';

const EXECUTABLE_PAIRED_CONDITIONS = new Set<string>(
  E2E_PAIRED_CONDITIONS.filter((condition) => condition !== 'oracle_evidence'),
);

function requireExecutableCondition(value: string, label: string): E2EPairedCondition {
  if (!EXECUTABLE_PAIRED_CONDITIONS.has(value)) {
    throw new Error(`${label} is not an executable paired assessment condition.`);
  }
  return value as E2EPairedCondition;
}

function scenarioTurnCount(scenario: E2EScenario): number {
  return scenario.userTurns && scenario.userTurns.length > 0 ? scenario.userTurns.length : 1;
}

export function buildE2EPairedAssessmentPlan(input: {
  pairId: string;
  provider: LlmProviderConfig;
  scenario: E2EScenario;
  referenceCondition: string;
  candidateCondition: string;
  seed: number;
}): E2EPairedExecutionPlan {
  const referenceCondition = requireExecutableCondition(
    input.referenceCondition,
    'referenceCondition',
  );
  const candidateCondition = requireExecutableCondition(
    input.candidateCondition,
    'candidateCondition',
  );
  const scenarioTimeoutMs = resolveE2EScenarioTimeoutMs(input.scenario);
  const invariantConfig = buildE2EPairedInvariantConfig({
    provider: input.provider,
    scenario: input.scenario,
    systemPrompt: resolveE2EScenarioSystemPrompt(input.scenario),
    toolSurface: resolveDefaultE2EPairedToolSurface(),
    maxTokens: input.scenario.maxTokens ?? E2E_DEFAULT_MAX_TOKENS,
    scenarioTimeoutMs,
    perTurnTimeoutMs: Math.min(
      E2E_PER_USER_TURN_TIMEOUT_MS,
      Math.max(1, Math.floor(scenarioTimeoutMs / scenarioTurnCount(input.scenario))),
    ),
    memoryTimeoutMs: E2E_DEFAULT_MEMORY_TIMEOUT_MS,
    seed: input.seed,
  });

  return buildE2EPairedExecutionPlan({
    pairId: input.pairId,
    comparison: { referenceCondition, candidateCondition },
    conditions: [
      buildE2EPairedConditionPlan({ condition: referenceCondition, invariantConfig }),
      buildE2EPairedConditionPlan({ condition: candidateCondition, invariantConfig }),
    ],
  });
}
