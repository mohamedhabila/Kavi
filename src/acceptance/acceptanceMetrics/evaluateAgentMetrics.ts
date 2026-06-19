// ---------------------------------------------------------------------------
// Kavi — Agent acceptance metric evaluation entry point
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { computeFalseFinalizeRate } from './evaluateFalseFinalizeFixture';
import type { FalseFinalizeFixture } from './falseFinalizeFixtures';
import type { AcceptanceFixtureOutcome, AcceptanceMetricEvaluation, AcceptanceMetricSummary } from './types';
import {
  AGENT_BOOTSTRAP_MIN_PASS_RATE,
  FALSE_FINALIZE_MAX_RATE,
} from './thresholds';

export function evaluateAgentBootstrapOutcomes(
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>,
): AcceptanceMetricSummary {
  return buildPassRateSummary({
    metricId: 'agent-bootstrap-turn-2',
    label: 'Goals bootstrapped by turn 2',
    outcomes,
    targetRate: AGENT_BOOTSTRAP_MIN_PASS_RATE,
    comparator: 'min',
  });
}

export function evaluateFalseFinalizeOutcomes(params: {
  outcomes: ReadonlyArray<AcceptanceFixtureOutcome>;
  fixtures: ReadonlyArray<FalseFinalizeFixture>;
}): AcceptanceMetricSummary {
  const falseFinalizeRate = computeFalseFinalizeRate(params.outcomes, params.fixtures);
  const mustHoldCount = params.fixtures.filter((fixture) => fixture.expectation === 'must_hold')
    .length;
  const falseFinalizeCount = Math.round(falseFinalizeRate * mustHoldCount);

  return {
    metricId: 'agent-false-finalize',
    label: 'False finalize rate',
    passed: mustHoldCount - falseFinalizeCount,
    total: mustHoldCount,
    passRate: falseFinalizeRate,
    targetRate: FALSE_FINALIZE_MAX_RATE,
    comparator: 'max',
    outcomes: params.outcomes.filter((outcome) =>
      params.fixtures.some(
        (fixture) => fixture.id === outcome.fixtureId && fixture.expectation === 'must_hold',
      ),
    ),
  };
}

export function evaluateAgentMetricOutcomes(params: {
  bootstrapOutcomes: ReadonlyArray<AcceptanceFixtureOutcome>;
  falseFinalizeOutcomes: ReadonlyArray<AcceptanceFixtureOutcome>;
  falseFinalizeFixtures: ReadonlyArray<FalseFinalizeFixture>;
}): AcceptanceMetricEvaluation {
  const summaries = [
    evaluateAgentBootstrapOutcomes(params.bootstrapOutcomes),
    evaluateFalseFinalizeOutcomes({
      outcomes: params.falseFinalizeOutcomes,
      fixtures: params.falseFinalizeFixtures,
    }),
  ];

  return aggregateAcceptanceMetrics(summaries);
}

export function isAgentMetricsPassing(evaluation: AcceptanceMetricEvaluation): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}