// ---------------------------------------------------------------------------
// Kavi — Delegation acceptance metrics
// ---------------------------------------------------------------------------

import { aggregateAcceptanceMetrics, buildPassRateSummary, isSummaryPassing } from './aggregateResults';
import { evaluateDelegationEvidenceFixture } from './evaluateDelegationEvidenceFixture';
import { evaluateDelegationSpawnFixture } from './evaluateDelegationSpawnFixture';
import { DELEGATION_EVIDENCE_FIXTURES } from './delegationEvidenceFixtures';
import { DELEGATION_SPAWN_FIXTURES } from './delegationSpawnFixtures';
import type { AcceptanceMetricEvaluation } from './types';
import { DELEGATION_SUCCESS_MIN_PASS_RATE } from './thresholds';

export function evaluateDelegationMetricOutcomes(): AcceptanceMetricEvaluation {
  const spawnOutcomes = DELEGATION_SPAWN_FIXTURES.map(evaluateDelegationSpawnFixture);
  const evidenceOutcomes = DELEGATION_EVIDENCE_FIXTURES.map(evaluateDelegationEvidenceFixture);

  return aggregateAcceptanceMetrics([
    buildPassRateSummary({
      metricId: 'delegation-spawn-gate',
      label: 'Delegated worker spawn blocked/allowed by structural goal deps',
      outcomes: spawnOutcomes,
      targetRate: DELEGATION_SUCCESS_MIN_PASS_RATE,
      comparator: 'min',
    }),
    buildPassRateSummary({
      metricId: 'delegation-worker-evidence',
      label: 'Worker terminal evidence drives completion gate readiness',
      outcomes: evidenceOutcomes,
      targetRate: DELEGATION_SUCCESS_MIN_PASS_RATE,
      comparator: 'min',
    }),
  ]);
}

export function isDelegationMetricsPassing(evaluation: AcceptanceMetricEvaluation): boolean {
  return evaluation.summaries.every(isSummaryPassing);
}