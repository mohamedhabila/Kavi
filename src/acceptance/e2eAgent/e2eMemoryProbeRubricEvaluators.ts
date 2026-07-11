import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type {
  E2EMemoryFactExpectation,
  E2ERubric,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
} from './types';

type E2EMemoryProbeRubric = Extract<
  E2ERubric,
  { kind: 'turn_memory_answer' | 'turn_memory_selection' }
>;

const MAX_EXPECTED_VALUE_CHARS = 256;
const MAX_EXPECTED_FACTS = 32;

function fixtureIdForRubric(
  result: E2EScenarioResult,
  rubric: E2EMemoryProbeRubric,
): string {
  return `${result.fixtureId}:turn-${rubric.turnIndex}:${rubric.kind}`;
}

function invalidOutcome(fixtureId: string, detail: string): AcceptanceFixtureOutcome {
  return { fixtureId, passed: false, detail };
}

function findTurnTrace(
  result: E2EScenarioResult,
  turnIndex: number,
): E2EScenarioTurnTrace | undefined {
  return result.turnTraces.find((turn) => turn.turnIndex === turnIndex);
}

function isCanonicalValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= MAX_EXPECTED_VALUE_CHARS
  );
}

function hasUniqueCanonicalValues(values: unknown): values is ReadonlyArray<string> {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= MAX_EXPECTED_FACTS &&
    values.every(isCanonicalValue) &&
    new Set(values).size === values.length
  );
}

function canonicalFactKey(fact: E2EMemoryFactExpectation): string {
  return `${fact.predicate}\u0000${fact.value}`;
}

function hasCanonicalFactExpectations(
  facts: unknown,
  options: { allowEmpty: boolean },
): facts is ReadonlyArray<E2EMemoryFactExpectation> {
  if (!Array.isArray(facts) || facts.length > MAX_EXPECTED_FACTS) return false;
  if (!options.allowEmpty && facts.length === 0) return false;
  const keys: string[] = [];
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false;
    if (Object.keys(fact).sort().join(',') !== 'predicate,value') return false;
    const candidate = fact as Partial<E2EMemoryFactExpectation>;
    if (!isCanonicalValue(candidate.predicate) || !isCanonicalValue(candidate.value)) {
      return false;
    }
    keys.push(canonicalFactKey(candidate as E2EMemoryFactExpectation));
  }
  return new Set(keys).size === keys.length;
}

function evaluateAnswer(
  result: E2EScenarioResult,
  turn: E2EScenarioTurnTrace,
  rubric: Extract<E2EMemoryProbeRubric, { kind: 'turn_memory_answer' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  const answer = rubric.answer;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} memory answer expectation is invalid`);
  }
  const text = turn.finalAssistant?.text;
  if (typeof text !== 'string') {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} final response is missing`);
  }

  if (answer.kind === 'abstention') {
    if (Object.keys(answer).sort().join(',') !== 'exactText,kind' || !isCanonicalValue(answer.exactText)) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} abstention expectation is invalid`,
      );
    }
    if (text.trim() !== answer.exactText) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} did not return the explicit abstention`,
      );
    }
    return { fixtureId, passed: true };
  }

  if (answer.kind !== 'fact_values') {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} memory answer expectation is invalid`);
  }
  const keys = Object.keys(answer).sort().join(',');
  if (
    (keys !== 'kind,requiredValues' && keys !== 'forbiddenValues,kind,requiredValues') ||
    !hasUniqueCanonicalValues(answer.requiredValues) ||
    (answer.forbiddenValues !== undefined &&
      !hasUniqueCanonicalValues(answer.forbiddenValues)) ||
    (answer.forbiddenValues ?? []).some((value) => answer.requiredValues.includes(value))
  ) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} memory answer expectation is invalid`);
  }
  const missing = answer.requiredValues.filter((value) => !text.includes(value));
  if (missing.length > 0) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} final response omitted required memory value`,
    );
  }
  const surfacedForbidden = (answer.forbiddenValues ?? []).filter((value) => text.includes(value));
  if (surfacedForbidden.length > 0) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} final response surfaced forbidden memory value`,
    );
  }
  return { fixtureId, passed: true };
}

function factIdsForExpectation(
  result: E2EScenarioResult,
  expectation: E2EMemoryFactExpectation,
): string[] {
  return result.memoryFinalState.facts
    .filter(
      (fact) => fact.predicate === expectation.predicate && fact.objectText === expectation.value,
    )
    .map((fact) => fact.id);
}

function evaluateSelection(
  result: E2EScenarioResult,
  turn: E2EScenarioTurnTrace,
  rubric: Extract<E2EMemoryProbeRubric, { kind: 'turn_memory_selection' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  const keys = Object.keys(rubric).sort().join(',');
  if (
    ![
      'kind,requiredFacts,turnIndex',
      'forbiddenFacts,kind,requiredFacts,turnIndex',
      'kind,maxSelectedFacts,requiredFacts,turnIndex',
      'forbiddenFacts,kind,maxSelectedFacts,requiredFacts,turnIndex',
    ].includes(keys) ||
    !hasCanonicalFactExpectations(rubric.requiredFacts, { allowEmpty: true }) ||
    (rubric.forbiddenFacts !== undefined &&
      !hasCanonicalFactExpectations(rubric.forbiddenFacts, { allowEmpty: false })) ||
    (rubric.maxSelectedFacts !== undefined &&
      (!Number.isSafeInteger(rubric.maxSelectedFacts) || rubric.maxSelectedFacts < 0))
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory selection expectation is invalid`,
    );
  }
  const requiredKeys = new Set(rubric.requiredFacts.map(canonicalFactKey));
  if ((rubric.forbiddenFacts ?? []).some((fact) => requiredKeys.has(canonicalFactKey(fact)))) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory selection expectation is invalid`,
    );
  }
  if (turn.retrieval.instrumentationStatus !== 'recorded' || turn.retrieval.events.length === 0) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} prompt retrieval evidence is unavailable`,
    );
  }
  const selectedIds = new Set(
    turn.retrieval.events.flatMap((event) => event.counts.selectedFactIds),
  );
  if (
    rubric.maxSelectedFacts !== undefined &&
    selectedIds.size > rubric.maxSelectedFacts
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} selected too many memory facts`,
    );
  }
  for (const expectation of rubric.requiredFacts) {
    const matchingIds = factIdsForExpectation(result, expectation);
    if (matchingIds.length === 0 || !matchingIds.some((id) => selectedIds.has(id))) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} did not select a required memory fact`,
      );
    }
  }
  for (const expectation of rubric.forbiddenFacts ?? []) {
    if (factIdsForExpectation(result, expectation).some((id) => selectedIds.has(id))) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} selected a forbidden memory fact`,
      );
    }
  }
  return { fixtureId, passed: true };
}

export function evaluateE2EMemoryProbeRubric(
  result: E2EScenarioResult,
  rubric: E2EMemoryProbeRubric,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  if (!Number.isSafeInteger(rubric.turnIndex) || rubric.turnIndex < 0) {
    return invalidOutcome(fixtureId, 'memory probe turn index is invalid');
  }
  const turn = findTurnTrace(result, rubric.turnIndex);
  if (!turn) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} trace missing`);
  }
  return rubric.kind === 'turn_memory_answer'
    ? evaluateAnswer(result, turn, rubric)
    : evaluateSelection(result, turn, rubric);
}
