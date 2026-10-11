import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import {
  isCanonicalE2EMemoryItemExpectation,
  memoryItemMatches,
} from './e2eMemoryItemRubricEvaluator';
import type { E2ERubric, E2EScenarioResult, E2EScenarioTurnTrace } from './types';

type E2EMemoryProbeRubric = Extract<
  E2ERubric,
  { kind: 'turn_memory_answer' | 'turn_memory_selection' }
>;

const MAX_EXPECTED_VALUE_CHARS = 256;
const MAX_EXPECTED_VALUES = 32;
const SELECTION_RUBRIC_KEYS = new Set([
  'kind',
  'turnIndex',
  'requiredItems',
  'forbiddenItems',
  'maxSelectedItems',
]);

function fixtureIdForRubric(result: E2EScenarioResult, rubric: E2EMemoryProbeRubric): string {
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
    values.length <= MAX_EXPECTED_VALUES &&
    values.every(isCanonicalValue) &&
    new Set(values).size === values.length
  );
}

function normalizedIncludes(text: string, value: string): boolean {
  return text.normalize('NFKC').includes(value.normalize('NFKC'));
}

function hasCanonicalItemExpectations(items: unknown, options: { allowEmpty: boolean }): boolean {
  return (
    Array.isArray(items) &&
    items.length <= MAX_EXPECTED_VALUES &&
    (options.allowEmpty || items.length > 0) &&
    items.every(isCanonicalE2EMemoryItemExpectation)
  );
}

function evaluateAnswer(
  result: E2EScenarioResult,
  turn: E2EScenarioTurnTrace,
  rubric: Extract<E2EMemoryProbeRubric, { kind: 'turn_memory_answer' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  const answer = rubric.answer;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory answer expectation is invalid`,
    );
  }
  const text = turn.finalAssistant?.text;
  if (typeof text !== 'string') {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} final response is missing`);
  }

  if (answer.kind === 'abstention') {
    if (
      Object.keys(answer).sort().join(',') !== 'exactText,kind' ||
      !isCanonicalValue(answer.exactText)
    ) {
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
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory answer expectation is invalid`,
    );
  }
  const keys = Object.keys(answer).sort().join(',');
  if (
    (keys !== 'kind,requiredValues' && keys !== 'forbiddenValues,kind,requiredValues') ||
    !hasUniqueCanonicalValues(answer.requiredValues) ||
    (answer.forbiddenValues !== undefined && !hasUniqueCanonicalValues(answer.forbiddenValues)) ||
    (answer.forbiddenValues ?? []).some((value) => answer.requiredValues.includes(value))
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory answer expectation is invalid`,
    );
  }
  const missing = answer.requiredValues.filter((value) => !normalizedIncludes(text, value));
  if (missing.length > 0) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} final response omitted required memory value`,
    );
  }
  const surfacedForbidden = (answer.forbiddenValues ?? []).filter((value) =>
    normalizedIncludes(text, value),
  );
  if (surfacedForbidden.length > 0) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} final response surfaced forbidden memory value`,
    );
  }
  return { fixtureId, passed: true };
}

function evaluateSelection(
  result: E2EScenarioResult,
  turn: E2EScenarioTurnTrace,
  rubric: Extract<E2EMemoryProbeRubric, { kind: 'turn_memory_selection' }>,
): AcceptanceFixtureOutcome {
  const fixtureId = fixtureIdForRubric(result, rubric);
  if (
    !Object.keys(rubric).every((key) => SELECTION_RUBRIC_KEYS.has(key)) ||
    !hasCanonicalItemExpectations(rubric.requiredItems, { allowEmpty: true }) ||
    (rubric.forbiddenItems !== undefined &&
      !hasCanonicalItemExpectations(rubric.forbiddenItems, { allowEmpty: false })) ||
    (rubric.maxSelectedItems !== undefined &&
      (!Number.isSafeInteger(rubric.maxSelectedItems) || rubric.maxSelectedItems < 0))
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory selection expectation is invalid`,
    );
  }
  if (turn.memoryPrompt.status !== 'recorded') {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} prompt memory evidence is unavailable`,
    );
  }
  const selectedIds = new Set(turn.memoryPrompt.builds.flatMap((build) => build.itemIds));
  if (rubric.maxSelectedItems !== undefined && selectedIds.size > rubric.maxSelectedItems) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} selected too many memory items`);
  }
  const selected = result.memoryItems.items.filter((item) => selectedIds.has(item.id));
  if (
    rubric.requiredItems.some(
      (expectation) => !selected.some((item) => memoryItemMatches(item, expectation)),
    )
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} did not select a required memory item`,
    );
  }
  if (
    (rubric.forbiddenItems ?? []).some((expectation) =>
      selected.some((item) => memoryItemMatches(item, expectation)),
    )
  ) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} selected a forbidden memory item`);
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
