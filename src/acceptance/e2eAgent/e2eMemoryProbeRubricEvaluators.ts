import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import type {
  E2EMemoryFactExpectation,
  E2EMemoryWriteReference,
  E2ERubric,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
} from './types';
import type { MemoryRememberResult } from '../../services/memory/memoryToolResultTypes';

type E2EMemoryProbeRubric = Extract<
  E2ERubric,
  { kind: 'turn_memory_answer' | 'turn_memory_selection' }
>;

const MAX_EXPECTED_VALUE_CHARS = 256;
const MAX_EXPECTED_FACTS = 32;
const MEMORY_FACT_SCOPES = new Set(['global', 'project', 'conversation', 'session', 'persona']);
const MEMORY_REMEMBER_TOOL_NAME = 'memory_remember';
const MEMORY_REMEMBER_STATUSES = new Set(['created', 'duplicate']);

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
    values.length <= MAX_EXPECTED_FACTS &&
    values.every(isCanonicalValue) &&
    new Set(values).size === values.length
  );
}

function normalizedIncludes(text: string, value: string): boolean {
  return text.normalize('NFKC').includes(value.normalize('NFKC'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalFactKey(fact: E2EMemoryFactExpectation): string {
  return `${fact.subject}\u0000${fact.predicate}\u0000${fact.value}\u0000${fact.scope}`;
}

function canonicalWriteKey(write: E2EMemoryWriteReference): string {
  return `${write.turnIndex}\u0000${write.subject}\u0000${write.value}\u0000${write.status}`;
}

export function isCanonicalE2EMemoryFactExpectation(
  fact: unknown,
): fact is E2EMemoryFactExpectation {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false;
  if (Object.keys(fact).sort().join(',') !== 'predicate,scope,subject,value') return false;
  const candidate = fact as Partial<E2EMemoryFactExpectation>;
  return (
    isCanonicalValue(candidate.subject) &&
    isCanonicalValue(candidate.predicate) &&
    isCanonicalValue(candidate.value) &&
    MEMORY_FACT_SCOPES.has(candidate.scope ?? '')
  );
}

function hasCanonicalFactExpectations(
  facts: unknown,
  options: { allowEmpty: boolean },
): facts is ReadonlyArray<E2EMemoryFactExpectation> {
  if (!Array.isArray(facts) || facts.length > MAX_EXPECTED_FACTS) return false;
  if (!options.allowEmpty && facts.length === 0) return false;
  const keys: string[] = [];
  for (const fact of facts) {
    if (!isCanonicalE2EMemoryFactExpectation(fact)) return false;
    keys.push(canonicalFactKey(fact));
  }
  return new Set(keys).size === keys.length;
}

function isCanonicalMemoryWriteReference(value: unknown): value is E2EMemoryWriteReference {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join(',') !== 'status,subject,turnIndex,value') return false;
  return (
    Number.isSafeInteger(value.turnIndex) &&
    (value.turnIndex as number) >= 0 &&
    isCanonicalValue(value.subject) &&
    isCanonicalValue(value.value) &&
    MEMORY_REMEMBER_STATUSES.has(String(value.status))
  );
}

function hasCanonicalMemoryWriteReferences(
  writes: unknown,
  options: { allowEmpty: boolean },
): writes is ReadonlyArray<E2EMemoryWriteReference> {
  if (!Array.isArray(writes) || writes.length > MAX_EXPECTED_FACTS) return false;
  if (!options.allowEmpty && writes.length === 0) return false;
  if (!writes.every(isCanonicalMemoryWriteReference)) return false;
  return new Set(writes.map(canonicalWriteKey)).size === writes.length;
}

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseMemoryRememberResult(content: string): MemoryRememberResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    !isRecord(parsed) ||
    parsed.ok !== true ||
    !MEMORY_REMEMBER_STATUSES.has(String(parsed.status))
  ) {
    return null;
  }
  const fact = parsed.fact;
  const superseded = parsed.superseded;
  if (
    !isRecord(fact) ||
    !isCanonicalValue(fact.id) ||
    !isCanonicalValue(fact.subject) ||
    !isCanonicalValue(fact.predicate) ||
    !isCanonicalValue(fact.value) ||
    !MEMORY_FACT_SCOPES.has(String(fact.scope)) ||
    !isSafeTimestamp(fact.validAt) ||
    (fact.invalidAt !== null && !isSafeTimestamp(fact.invalidAt)) ||
    !Array.isArray(superseded) ||
    superseded.some(
      (entry) =>
        !isRecord(entry) || !isCanonicalValue(entry.id) || !isSafeTimestamp(entry.invalidAt),
    )
  ) {
    return null;
  }
  return parsed as unknown as MemoryRememberResult;
}

type ResolvedMemoryWrite = Readonly<{
  reference: E2EMemoryWriteReference;
  sourceTurn: E2EScenarioTurnTrace;
  result: MemoryRememberResult;
  finalFact: E2EScenarioResult['memoryFinalState']['facts'][number];
}>;

function finalFactIsActive(
  result: E2EScenarioResult,
  fact: E2EScenarioResult['memoryFinalState']['facts'][number],
): boolean {
  return (
    fact.deletedAt === null &&
    fact.invalidAt === null &&
    fact.validAt <= result.memoryFinalState.capturedAt &&
    (fact.expiresAt === null || fact.expiresAt > result.memoryFinalState.capturedAt)
  );
}

function resolveMemoryWrite(
  result: E2EScenarioResult,
  reference: E2EMemoryWriteReference,
): ResolvedMemoryWrite | null {
  const sourceTurn = findTurnTrace(result, reference.turnIndex);
  if (!sourceTurn) return null;
  const matches = sourceTurn.toolResults.flatMap((toolResult) => {
    if (
      toolResult.name !== MEMORY_REMEMBER_TOOL_NAME ||
      toolResult.isError ||
      !sourceTurn.toolCalls.some(
        (toolCall) =>
          toolCall.id === toolResult.toolCallId && toolCall.name === MEMORY_REMEMBER_TOOL_NAME,
      )
    ) {
      return [];
    }
    const parsed = parseMemoryRememberResult(toolResult.content);
    if (
      !parsed ||
      parsed.status !== reference.status ||
      parsed.fact.subject !== reference.subject ||
      parsed.fact.value !== reference.value
    ) {
      return [];
    }
    const finalFact = result.memoryFinalState.facts.find((fact) => fact.id === parsed.fact.id);
    if (
      !finalFact ||
      finalFact.subject !== parsed.fact.subject ||
      finalFact.predicate !== parsed.fact.predicate ||
      finalFact.objectText !== parsed.fact.value ||
      finalFact.scope !== parsed.fact.scope ||
      finalFact.validAt !== parsed.fact.validAt
    ) {
      return [];
    }
    return [{ reference, sourceTurn, result: parsed, finalFact }];
  });
  return matches.length === 1 ? matches[0]! : null;
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

function factIdsForExpectation(
  result: E2EScenarioResult,
  expectation: E2EMemoryFactExpectation,
): string[] {
  return result.memoryFinalState.facts
    .filter(
      (fact) =>
        fact.subject === expectation.subject &&
        fact.predicate === expectation.predicate &&
        fact.objectText === expectation.value &&
        fact.scope === expectation.scope,
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
  const exactFactExpectation =
    'requiredFacts' in rubric &&
    [
      'kind,requiredFacts,turnIndex',
      'forbiddenFacts,kind,requiredFacts,turnIndex',
      'kind,maxSelectedFacts,requiredFacts,turnIndex',
      'forbiddenFacts,kind,maxSelectedFacts,requiredFacts,turnIndex',
    ].includes(keys) &&
    hasCanonicalFactExpectations(rubric.requiredFacts, { allowEmpty: true }) &&
    (rubric.forbiddenFacts === undefined ||
      hasCanonicalFactExpectations(rubric.forbiddenFacts, { allowEmpty: false }));
  const writeLineageExpectation =
    'requiredWrites' in rubric &&
    [
      'kind,requiredWrites,turnIndex',
      'kind,requiredWrites,supersededWrites,turnIndex',
      'kind,maxSelectedFacts,requiredWrites,turnIndex',
      'kind,maxSelectedFacts,requiredWrites,supersededWrites,turnIndex',
    ].includes(keys) &&
    hasCanonicalMemoryWriteReferences(rubric.requiredWrites, { allowEmpty: false }) &&
    (rubric.supersededWrites === undefined ||
      hasCanonicalMemoryWriteReferences(rubric.supersededWrites, { allowEmpty: false }));
  if (
    (!exactFactExpectation && !writeLineageExpectation) ||
    (rubric.maxSelectedFacts !== undefined &&
      (!Number.isSafeInteger(rubric.maxSelectedFacts) || rubric.maxSelectedFacts < 0))
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory selection expectation is invalid`,
    );
  }
  if (
    exactFactExpectation &&
    new Set(rubric.requiredFacts.map(canonicalFactKey)).size !== rubric.requiredFacts.length
  ) {
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
  if (rubric.maxSelectedFacts !== undefined && selectedIds.size > rubric.maxSelectedFacts) {
    return invalidOutcome(fixtureId, `turn ${rubric.turnIndex} selected too many memory facts`);
  }
  if (exactFactExpectation) {
    const requiredKeys = new Set(rubric.requiredFacts.map(canonicalFactKey));
    if ((rubric.forbiddenFacts ?? []).some((fact) => requiredKeys.has(canonicalFactKey(fact)))) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} memory selection expectation is invalid`,
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

  if (!('requiredWrites' in rubric)) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory selection expectation is invalid`,
    );
  }
  const requiredWrites = rubric.requiredWrites.map((reference) =>
    resolveMemoryWrite(result, reference),
  );
  const supersededWrites = (rubric.supersededWrites ?? []).map((reference) =>
    resolveMemoryWrite(result, reference),
  );
  if (
    requiredWrites.some((write) => write === null) ||
    supersededWrites.some((write) => write === null)
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory write lineage evidence is unavailable`,
    );
  }
  const resolvedRequired = requiredWrites as ResolvedMemoryWrite[];
  const resolvedSuperseded = supersededWrites as ResolvedMemoryWrite[];
  if (
    new Set([...resolvedRequired, ...resolvedSuperseded].map((write) => write.result.fact.id))
      .size !==
    resolvedRequired.length + resolvedSuperseded.length
  ) {
    return invalidOutcome(
      fixtureId,
      `turn ${rubric.turnIndex} memory write lineage expectation is ambiguous`,
    );
  }
  for (const write of resolvedRequired) {
    if (
      !finalFactIsActive(result, write.finalFact) ||
      !selectedIds.has(write.result.fact.id) ||
      (write.result.status === 'created' &&
        !write.sourceTurn.memoryEvidence.delta.facts.createdIds.includes(write.result.fact.id))
    ) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} did not select the current fact from the required memory write`,
      );
    }
  }
  for (const stale of resolvedSuperseded) {
    const successor = resolvedRequired.find((current) =>
      current.result.superseded.some(
        (receipt) =>
          receipt.id === stale.result.fact.id &&
          receipt.invalidAt === stale.finalFact.invalidAt &&
          receipt.invalidAt === current.result.fact.validAt,
      ),
    );
    if (
      !successor ||
      stale.finalFact.deletedAt !== null ||
      stale.finalFact.invalidAt === null ||
      stale.finalFact.predicate !== successor.finalFact.predicate ||
      stale.finalFact.subject !== successor.finalFact.subject ||
      stale.finalFact.scope !== successor.finalFact.scope ||
      selectedIds.has(stale.result.fact.id) ||
      !successor.sourceTurn.memoryEvidence.delta.invalidatedFactIds.includes(stale.result.fact.id)
    ) {
      return invalidOutcome(
        fixtureId,
        `turn ${rubric.turnIndex} memory supersession lineage is invalid`,
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
