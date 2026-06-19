// ---------------------------------------------------------------------------
// Kavi — Structural memory recall evaluation (no language heuristics)
// ---------------------------------------------------------------------------

import type { MemoryFact } from '../../services/memory/facts/types';
import type { AcceptanceFixtureOutcome } from './types';

function buildFactHaystack(facts: ReadonlyArray<MemoryFact>): string {
  return facts
    .map((fact) => `${fact.predicate} ${fact.objectText}`)
    .join(' ')
    .toLowerCase();
}

export function evaluateMemoryRecallResult(params: {
  fixtureId: string;
  facts: ReadonlyArray<MemoryFact>;
  requiredStructuralTokens: ReadonlyArray<string>;
}): AcceptanceFixtureOutcome {
  if (params.facts.length === 0) {
    return {
      fixtureId: params.fixtureId,
      passed: false,
      detail: 'retrieval returned 0 facts',
    };
  }

  const haystack = buildFactHaystack(params.facts);
  const missingTokens = params.requiredStructuralTokens.filter(
    (token) => !haystack.includes(token.toLowerCase()),
  );

  if (missingTokens.length > 0) {
    return {
      fixtureId: params.fixtureId,
      passed: false,
      detail: `missing structural tokens: ${missingTokens.join(', ')}`,
    };
  }

  return { fixtureId: params.fixtureId, passed: true };
}
