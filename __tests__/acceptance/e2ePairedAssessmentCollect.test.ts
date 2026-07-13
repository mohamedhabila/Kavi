jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { buildE2EPairedAssessmentPlan } from '../../src/acceptance/e2eAgent/e2ePairedAssessmentPlan';
import { evaluateE2EPairedCausalMemoryAssessment } from '../../src/acceptance/e2eAgent/e2ePairedCausalMemoryAssessment';
import { writeE2EPairedPublicReportArtifact } from '../../src/acceptance/e2eAgent/e2ePairedReportArtifact';
import { requireE2ePairedRunId } from '../../scripts/lib/e2ePairedRunId';
import { runE2EPairedConditions } from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import {
  buildE2EProvider,
  shouldRunE2EAgentEval,
} from '../../src/acceptance/e2eAgent/providerConfig';
import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
  E2E_PAIRED_ONLY_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';

const enabled = process.env.RUN_E2E_PAIRED_EVAL === '1' && shouldRunE2EAgentEval();
const describePaired = enabled ? describe : describe.skip;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

describePaired('paired E2E assessment collector', () => {
  jest.setTimeout(3_600_000);

  it('executes both frozen conditions and retains a content-free public report', async () => {
    const scenarioId = requiredEnv('E2E_PAIRED_SCENARIO_ID');
    const runId = requireE2ePairedRunId(process.env.E2E_PAIRED_RUN_ID);
    const scenarios = [
      ...E2E_AGENT_SCENARIOS,
      ...DELEGATION_E2E_SCENARIOS,
      ...E2E_PAIRED_ONLY_SCENARIOS,
    ];
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario) throw new Error(`Unknown paired scenario: ${scenarioId}`);
    const seed = Number(requiredEnv('E2E_PAIRED_SEED'));
    if (!Number.isSafeInteger(seed)) throw new Error('E2E_PAIRED_SEED must be a safe integer.');
    const provider = buildE2EProvider();
    const plan = buildE2EPairedAssessmentPlan({
      pairId: runId,
      provider,
      scenario,
      referenceCondition: requiredEnv('E2E_PAIRED_REFERENCE_CONDITION'),
      candidateCondition: requiredEnv('E2E_PAIRED_CANDIDATE_CONDITION'),
      seed,
    });
    const runtime = await runE2EPairedConditions({ plan, provider, scenario });
    const report = writeE2EPairedPublicReportArtifact({
      runtime,
      retentionRoot: requiredEnv('E2E_PAIRED_RETENTION_ROOT'),
      runId,
    });
    const causalMemoryAssessment = evaluateE2EPairedCausalMemoryAssessment({
      runtime,
      scenario,
    });
    if (scenario.pairedEvaluation && !causalMemoryAssessment?.claimEligible) {
      throw new Error(
        `Paired causal-memory contract failed: ${causalMemoryAssessment?.status ?? 'missing'}.`,
      );
    }

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.conditions).toHaveLength(2);
    expect(report.pairedDelta).not.toBeNull();
    expect(report.executionSeed).toBe(seed);
    expect(report.executionOrder).toEqual(
      seed % 2 === 0
        ? [report.comparison.referenceCondition, report.comparison.candidateCondition]
        : [report.comparison.candidateCondition, report.comparison.referenceCondition],
    );
    expect(
      new Set(report.conditions.map((condition) => condition.executionIdentityHash)).size,
    ).toBe(2);
  });
});
