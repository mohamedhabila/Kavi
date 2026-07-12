import type { AcceptanceFixtureOutcome } from '../acceptanceMetrics/types';
import { isCanonicalE2EMemoryFactExpectation } from './e2eMemoryProbeRubricEvaluators';
import type { E2ERubric, E2EScenarioResult } from './types';

type E2EMemoryFactRubric = Extract<E2ERubric, { kind: 'memory_fact' | 'memory_fact_absent' }>;

export function evaluateE2EMemoryFactRubric(
  result: E2EScenarioResult,
  rubric: E2EMemoryFactRubric,
  fixtureId: string,
): AcceptanceFixtureOutcome {
  const expectation = {
    subject: rubric.subject,
    predicate: rubric.predicate,
    value: rubric.value,
    scope: rubric.scope,
  };
  if (!isCanonicalE2EMemoryFactExpectation(expectation)) {
    return { fixtureId, passed: false, detail: 'memory fact expectation is invalid' };
  }
  const memory = result.memoryFinalState;
  if (!memory) {
    return { fixtureId, passed: false, detail: 'memory evidence unavailable' };
  }
  const subject = expectation.subject.toLowerCase();
  const predicate = expectation.predicate.toLowerCase();
  const value = expectation.value.toLowerCase();
  const matches = memory.facts.filter(
    (fact) =>
      fact.subject.trim().toLowerCase() === subject &&
      fact.predicate.trim().toLowerCase() === predicate &&
      fact.objectText.trim().toLowerCase() === value &&
      fact.scope === expectation.scope &&
      fact.deletedAt === null &&
      fact.invalidAt === null &&
      fact.validAt <= memory.capturedAt &&
      (fact.expiresAt === null || fact.expiresAt > memory.capturedAt),
  );
  const label = `${expectation.subject}/${expectation.scope}/${expectation.predicate}=${expectation.value}`;
  if (rubric.kind === 'memory_fact') {
    return matches.length > 0
      ? { fixtureId, passed: true }
      : { fixtureId, passed: false, detail: `memory fact missing: ${label}` };
  }
  return matches.length === 0
    ? { fixtureId, passed: true }
    : { fixtureId, passed: false, detail: `memory fact present: ${label}` };
}
