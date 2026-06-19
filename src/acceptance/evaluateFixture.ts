// ---------------------------------------------------------------------------
// Kavi — Acceptance fixture evaluator
// ---------------------------------------------------------------------------
// Structural validation of deterministic task traces (no live LLM).
// ---------------------------------------------------------------------------

import type { AcceptanceFixture, AcceptanceTurnTrace } from './taskFixtures';

export type AcceptanceViolation = {
  code: string;
  message: string;
};

export type AcceptanceEvaluation = {
  fixtureId: string;
  passed: boolean;
  totalToolCalls: number;
  totalTokens: number;
  violations: AcceptanceViolation[];
};

function countToolCalls(turns: ReadonlyArray<AcceptanceTurnTrace>): number {
  return turns.reduce((sum, turn) => sum + turn.tools.length, 0);
}

function sumEstimatedTokens(turns: ReadonlyArray<AcceptanceTurnTrace>): number {
  return turns.reduce((sum, turn) => sum + turn.estimatedTokens, 0);
}

function evaluateResearchOrdering(fixture: AcceptanceFixture): AcceptanceViolation[] {
  if (fixture.maxWebSearchBeforeFetch === undefined) {
    return [];
  }

  let webSearchCount = 0;
  let sawFetch = false;
  const violations: AcceptanceViolation[] = [];

  for (const turn of fixture.turns) {
    for (const tool of turn.tools) {
      if (tool === 'web_fetch') {
        sawFetch = true;
      }
      if (tool === 'web_search') {
        if (!sawFetch) {
          webSearchCount += 1;
        }
      }
    }
  }

  if (fixture.turns[0]?.tools[0] !== 'web_search') {
    violations.push({
      code: 'research_first_tool',
      message: 'First research step must be web_search.',
    });
  }

  if (webSearchCount > fixture.maxWebSearchBeforeFetch) {
    violations.push({
      code: 'research_search_before_fetch',
      message: `Exceeded web_search turns (${webSearchCount}) before first web_fetch.`,
    });
  }

  const fetchCount = fixture.turns
    .flatMap((turn) => turn.tools)
    .filter((tool) => tool === 'web_fetch').length;
  if (fetchCount < 1) {
    violations.push({
      code: 'research_missing_fetch',
      message: 'Research fixture must include at least one web_fetch.',
    });
  }

  return violations;
}

export function evaluateAcceptanceFixture(fixture: AcceptanceFixture): AcceptanceEvaluation {
  const totalToolCalls = countToolCalls(fixture.turns);
  const totalTokens = sumEstimatedTokens(fixture.turns);
  const violations: AcceptanceViolation[] = [];

  if (totalToolCalls > fixture.maxToolCalls) {
    violations.push({
      code: 'tool_call_ceiling',
      message: `Tool calls ${totalToolCalls} exceed ceiling ${fixture.maxToolCalls}.`,
    });
  }

  if (totalTokens > fixture.maxTotalTokens) {
    violations.push({
      code: 'token_ceiling',
      message: `Estimated tokens ${totalTokens} exceed ceiling ${fixture.maxTotalTokens}.`,
    });
  }

  if (fixture.id === 'research') {
    violations.push(...evaluateResearchOrdering(fixture));
  }

  return {
    fixtureId: fixture.id,
    passed: violations.length === 0,
    totalToolCalls,
    totalTokens,
    violations,
  };
}