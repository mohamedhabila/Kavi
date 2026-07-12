import type { E2EPairedCausalMemoryContract, E2ERubric, E2EScenario } from './types';

const CAUSAL_RUBRIC_KINDS = new Set<E2ERubric['kind']>([
  'memory_fact',
  'turn_memory_selection',
  'turn_memory_answer',
  'turn_native_invocation_count',
  'native_fixture_state',
]);
const NEUTRAL_FORBIDDEN_RUBRIC_KINDS = new Set<E2ERubric['kind']>([
  'memory_fact',
  'turn_memory_selection',
  'turn_memory_answer',
]);

function requireExactKeys(value: object, expected: ReadonlyArray<string>): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error('pairedEvaluation has an unsupported schema.');
  }
}

function validateIndexes(values: ReadonlyArray<number>, rubricCount: number, label: string): void {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0 || value >= rubricCount) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`pairedEvaluation.${label} must contain unique in-range rubric indexes.`);
  }
}

export function validateE2EPairedCausalMemoryContract(
  scenario: E2EScenario,
): E2EPairedCausalMemoryContract | null {
  const contract = scenario.pairedEvaluation;
  if (contract === undefined) return null;
  validateE2EPairedCausalMemoryDefinition(contract, scenario.rubrics);
  return contract;
}

export function validateE2EPairedCausalMemoryDefinition(
  contract: E2EPairedCausalMemoryContract,
  rubrics: ReadonlyArray<E2ERubric>,
): void {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('pairedEvaluation must be an object.');
  }
  requireExactKeys(contract, [
    'kind',
    'referenceCondition',
    'candidateCondition',
    'neutralRubricIndexes',
    'causalRubricIndexes',
  ]);
  if (
    contract.kind !== 'causal_memory' ||
    contract.referenceCondition !== 'memory_off' ||
    contract.candidateCondition !== 'production_auto'
  ) {
    throw new Error('pairedEvaluation causal-memory conditions are unsupported.');
  }
  validateIndexes(contract.neutralRubricIndexes, rubrics.length, 'neutralRubricIndexes');
  validateIndexes(contract.causalRubricIndexes, rubrics.length, 'causalRubricIndexes');
  const allIndexes = [...contract.neutralRubricIndexes, ...contract.causalRubricIndexes];
  if (new Set(allIndexes).size !== allIndexes.length || allIndexes.length !== rubrics.length) {
    throw new Error('pairedEvaluation rubric roles must form an exact non-overlapping partition.');
  }
  const neutralRubrics = contract.neutralRubricIndexes.map((index) => rubrics[index]!);
  const causalRubrics = contract.causalRubricIndexes.map((index) => rubrics[index]!);
  if (neutralRubrics.some((rubric) => NEUTRAL_FORBIDDEN_RUBRIC_KINDS.has(rubric.kind))) {
    throw new Error('pairedEvaluation neutral guards must not contain positive memory claims.');
  }
  if (causalRubrics.some((rubric) => !CAUSAL_RUBRIC_KINDS.has(rubric.kind))) {
    throw new Error('pairedEvaluation causal roles contain a non-causal rubric kind.');
  }
  if (
    !neutralRubrics.some(
      (rubric) =>
        rubric.kind === 'turn_lifecycle_boundary' && rubric.boundary === 'new_conversation',
    )
  ) {
    throw new Error('pairedEvaluation neutral guards must prove a fresh-conversation boundary.');
  }
  if (!causalRubrics.some((rubric) => rubric.kind === 'turn_memory_selection')) {
    throw new Error('pairedEvaluation causal rubrics must require attributed memory retrieval.');
  }
  if (!causalRubrics.some(isCausalOutcomeRubric)) {
    throw new Error('pairedEvaluation causal rubrics must require an answer or native outcome.');
  }
}

function isCausalOutcomeRubric(rubric: E2ERubric): boolean {
  return rubric.kind === 'turn_memory_answer' || rubric.kind === 'native_fixture_state';
}
