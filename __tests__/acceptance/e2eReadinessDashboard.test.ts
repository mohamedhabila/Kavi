import { buildE2EAssessmentReport } from '../../src/acceptance/e2eAgent/e2eAssessmentReport';
import { buildE2EReadinessDashboard } from '../../src/acceptance/e2eAgent/e2eReadinessDashboard';
import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

function buildFixtureResult(overrides?: Partial<E2EScenarioResult>): E2EScenarioResult {
  return {
    fixtureId: 'tool-catalog-agents',
    conversationId: 'e2e-tool-catalog',
    toolCalls: [{ id: 'tc-1', name: 'tool_catalog', arguments: '{"category":"agents"}' }],
    toolResults: [],
    graphSnapshots: [{ status: 'running' } as E2EScenarioResult['graphSnapshots'][number]],
    turnTraces: [],
    usage: {
      inputTokens: 4096,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 4116,
      eventCount: 1,
    },
    errors: [],
    completed: true,
    durationMs: 1500,
    userTurnCount: 1,
    ...overrides,
  };
}

describe('e2eReadinessDashboard', () => {
  it('clusters failures from structural rubrics and mines redacted eval candidates', () => {
    const failedEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: {
        fixtureId: 'tool-catalog-agents',
        passed: false,
        detail: 'not used by dashboard clustering',
      },
      attemptCount: 1,
      rubrics: [
        { kind: 'graph_terminal_success' },
        { kind: 'workspace_file', path: 'artifacts/discovery-result.txt' },
        { kind: 'token_budget', maxTotalTokens: 100_000 },
      ],
    });
    const report = buildE2ERunReport([failedEntry], {
      generatedAt: '2026-06-12T00:00:00.000Z',
      maxScenarioRetries: 0,
      runMetadata: {
        gitSha: 'test-sha',
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        providerBaseUrl: 'https://aiplatform.googleapis.com/v1',
        collectMode: true,
      },
      cacheTelemetry: {
        cacheCreateAttempts: 0,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });

    const wrongArgsCluster = report.readinessDashboard.failureTaxonomy.find(
      (cluster) => cluster.category === 'wrong_args',
    );
    const goalCluster = report.readinessDashboard.failureTaxonomy.find(
      (cluster) => cluster.category === 'goal_state_bug',
    );
    const externalCluster = report.readinessDashboard.failureTaxonomy.find(
      (cluster) => cluster.category === 'external_runner_required',
    );

    expect(wrongArgsCluster).toMatchObject({
      count: 1,
      scenarioIds: ['tool-catalog-agents'],
      failedRubricKinds: expect.arrayContaining(['workspace_file']),
    });
    expect(goalCluster).toMatchObject({
      count: 1,
      scenarioIds: ['tool-catalog-agents'],
      failedRubricKinds: expect.arrayContaining(['graph_terminal_success']),
    });
    expect(externalCluster?.externalRequirementIds).toEqual(
      expect.arrayContaining(['agentdojo-prompt-injection', 'mcptox-tool-poisoning']),
    );
    expect(report.readinessDashboard.minedEvalCandidates).toHaveLength(1);
    expect(report.readinessDashboard.minedEvalCandidates[0]).toMatchObject({
      sourceScenarioId: 'tool-catalog-agents',
      categories: expect.arrayContaining(['wrong_args', 'goal_state_bug']),
      privacy: {
        rawPromptIncluded: false,
        rawToolArgsIncluded: false,
        rawToolResultsIncluded: false,
        rawAssistantTextIncluded: false,
      },
    });
    expect(JSON.stringify(report.readinessDashboard.minedEvalCandidates[0])).not.toContain(
      '{"category":"agents"}',
    );
  });

  it('summarizes family readiness, cache, mobile, security, cadence, and human calibration', () => {
    const passEntry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult({
        fixtureId: 'bench-androidworld-permission-denial',
        graphSnapshots: [{ status: 'finalized' } as E2EScenarioResult['graphSnapshots'][number]],
        usage: {
          inputTokens: 4096,
          outputTokens: 30,
          cacheReadTokens: 2048,
          cacheWriteTokens: 0,
          totalTokens: 4126,
          eventCount: 1,
        },
      }),
      outcome: { fixtureId: 'bench-androidworld-permission-denial', passed: true },
      attemptCount: 1,
      rubrics: [
        { kind: 'graph_terminal_success' },
        { kind: 'token_budget', maxTotalTokens: 160_000 },
      ],
    });
    const assessment = buildE2EAssessmentReport([passEntry], {
      generatedAt: '2026-06-12T00:00:00.000Z',
    });
    const report = buildE2ERunReport([passEntry], {
      generatedAt: '2026-06-12T00:00:00.000Z',
      maxScenarioRetries: 2,
      cacheTelemetry: {
        cacheCreateAttempts: 1,
        cacheCreateFailureCount: 0,
        cacheCreateFailuresByProviderStatus: [],
        cacheCreateTelemetryAvailable: true,
      },
    });
    const dashboard = buildE2EReadinessDashboard({
      generatedAt: report.generatedAt,
      runMetadata: report.runMetadata,
      entries: report.scenarios,
      totals: report.totals,
      cache: report.cache,
      graderAudit: report.graderAudit,
      assessment,
      reliability: report.reliability,
      readiness: report.readiness,
    });

    expect(dashboard.familyReadiness.length).toBeGreaterThan(0);
    expect(dashboard.reliability).toMatchObject({
      k: 3,
      pass1Rate: 1,
      passKRate: 1,
    });
    expect(dashboard.cache).toMatchObject({
      eligibleInputTokens: 4096,
      passing: true,
      cacheCreateTelemetryAvailable: true,
    });
    expect(dashboard.mobileNative).toMatchObject({
      scenarioCount: 1,
      passedCount: 1,
      passRate: 1,
    });
    expect(dashboard.security).toMatchObject({
      status: 'external_required',
      targetedAttackSuccessRate: null,
    });
    expect(dashboard.artifactRetention.defaultRetainedRuns).toBe(90);
    expect(dashboard.refreshCadence.map((entry) => entry.sourceGroup)).toEqual([
      'provider_docs',
      'bfcl_tau_agentdojo_security',
      'mobile_benchmarks',
    ]);
    expect(dashboard.humanAuditCalibration.status).toBe('not_required_structural_graders_only');
  });
});
