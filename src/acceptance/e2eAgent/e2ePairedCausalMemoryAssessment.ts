import { validateE2EPairedCausalMemoryContract } from './e2ePairedCausalMemoryContract';
import {
  E2E_PAIRED_RUNTIME_SCHEMA_VERSION,
  type E2EPairedConditionExecution,
  type E2EPairedRuntimeResult,
} from './e2ePairedRuntime';
import { evaluateE2ERubric } from './rubricEvaluators';
import type { E2EScenario, E2EScenarioResult } from './types';

export type E2EPairedCausalMemoryAssessment = Readonly<{
  claimEligible: boolean;
  status:
    | 'eligible'
    | 'invalid_infrastructure'
    | 'neutral_regression'
    | 'product_causal_failure'
    | 'control_causal_success';
  neutral: Readonly<{
    referencePassed: number;
    candidatePassed: number;
    total: number;
  }>;
  causal: Readonly<{
    referencePassed: number;
    candidatePassed: number;
    total: number;
  }>;
}>;

type CompletedCondition = Extract<E2EPairedConditionExecution, { status: 'completed' }>;

function completedCondition(
  runtime: E2EPairedRuntimeResult,
  condition: CompletedCondition['condition'],
): CompletedCondition | null {
  const result = runtime.conditions.find((entry) => entry.condition === condition);
  return result?.status === 'completed' ? result : null;
}

function passedRubricCount(
  result: E2EScenarioResult,
  scenario: E2EScenario,
  indexes: ReadonlyArray<number>,
): number {
  return indexes.filter((index) => evaluateE2ERubric(result, scenario.rubrics[index]!).passed)
    .length;
}

export function evaluateE2EPairedCausalMemoryAssessment(input: {
  runtime: E2EPairedRuntimeResult;
  scenario: E2EScenario;
}): E2EPairedCausalMemoryAssessment | null {
  const contract = validateE2EPairedCausalMemoryContract(input.scenario);
  if (!contract) return null;
  const neutralTotal = contract.neutralRubricIndexes.length;
  const causalTotal = contract.causalRubricIndexes.length;
  const empty = {
    neutral: { referencePassed: 0, candidatePassed: 0, total: neutralTotal },
    causal: { referencePassed: 0, candidatePassed: 0, total: causalTotal },
  };
  if (
    input.runtime.schemaVersion !== E2E_PAIRED_RUNTIME_SCHEMA_VERSION ||
    !input.runtime.validForDeltaClaims ||
    input.runtime.cleanup.status !== 'completed' ||
    input.runtime.conditions.length !== 2 ||
    input.runtime.comparison.referenceCondition !== contract.referenceCondition ||
    input.runtime.comparison.candidateCondition !== contract.candidateCondition ||
    input.runtime.conditions[0]?.condition !== contract.referenceCondition ||
    input.runtime.conditions[1]?.condition !== contract.candidateCondition
  ) {
    return { claimEligible: false, status: 'invalid_infrastructure', ...empty };
  }
  const reference = completedCondition(input.runtime, contract.referenceCondition);
  const candidate = completedCondition(input.runtime, contract.candidateCondition);
  if (!reference || !candidate) {
    return { claimEligible: false, status: 'invalid_infrastructure', ...empty };
  }
  const neutral = {
    referencePassed: passedRubricCount(
      reference.result,
      input.scenario,
      contract.neutralRubricIndexes,
    ),
    candidatePassed: passedRubricCount(
      candidate.result,
      input.scenario,
      contract.neutralRubricIndexes,
    ),
    total: neutralTotal,
  };
  const causal = {
    referencePassed: passedRubricCount(
      reference.result,
      input.scenario,
      contract.causalRubricIndexes,
    ),
    candidatePassed: passedRubricCount(
      candidate.result,
      input.scenario,
      contract.causalRubricIndexes,
    ),
    total: causalTotal,
  };
  if (neutral.referencePassed !== neutralTotal || neutral.candidatePassed !== neutralTotal) {
    return { claimEligible: false, status: 'neutral_regression', neutral, causal };
  }
  if (causal.candidatePassed !== causalTotal) {
    return { claimEligible: false, status: 'product_causal_failure', neutral, causal };
  }
  if (causal.referencePassed !== 0) {
    return { claimEligible: false, status: 'control_causal_success', neutral, causal };
  }
  return { claimEligible: true, status: 'eligible', neutral, causal };
}
