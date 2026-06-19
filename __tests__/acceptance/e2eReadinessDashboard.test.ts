import { buildE2EAssessmentReport } from '../../src/acceptance/e2eAgent/e2eAssessmentReport';
import { buildE2EReadinessDashboard } from '../../src/acceptance/e2eAgent/e2eReadinessDashboard';
import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  type E2ERunReportRubricFailure,
  type E2ERunReportScenarioEntry,
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

function buildTaxonomyEntry(params: {
  fixtureId: string;
  passed?: boolean;
  failedRubricKinds?: string[];
  rubricAudit?: Partial<E2ERunReportScenarioEntry['rubricAudit']>;
  usage?: Partial<E2EScenarioResult['usage']>;
}): E2ERunReportScenarioEntry {
  const baseUsage: E2EScenarioResult['usage'] = {
    inputTokens: 1000,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1020,
    eventCount: 1,
  };
  const result = buildFixtureResult({
    fixtureId: params.fixtureId,
    usage: {
      ...baseUsage,
      ...params.usage,
    },
  });
  const entry = buildE2ERunReportScenarioEntry({
    suite: 'core',
    result,
    outcome: { fixtureId: params.fixtureId, passed: params.passed ?? false },
    attemptCount: 1,
  });
  const failedRubrics: E2ERunReportRubricFailure[] | undefined = params.failedRubricKinds?.map(
    (kind) => ({
      fixtureId: `${params.fixtureId}:${kind}`,
    }),
  );

  return {
    ...entry,
    ...(failedRubrics ? { failedRubrics } : {}),
    rubricAudit: {
      ...entry.rubricAudit,
      ...params.rubricAudit,
    },
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

  it('classifies readiness failures from structural scenario metadata', () => {
    const report = buildE2ERunReport(
      [
        buildTaxonomyEntry({
          fixtureId: 'file-write-read',
          failedRubricKinds: ['workspace_file_absent'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'direct-agentdojo-untrusted-workspace-note',
          failedRubricKinds: ['workspace_file_absent', 'workspace_file'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'bench-androidworld-calendar-mutation',
          failedRubricKinds: ['workspace_file'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'bench-androidworld-permission-denial',
          failedRubricKinds: ['native_fixture_state'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'direct-toolsandbox-state-dependency',
          failedRubricKinds: ['native_fixture_state'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'bench-bfcl-sequential-memory-chain',
          failedRubricKinds: ['memory_fact'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'bench-prompt-cache-long-horizon',
          failedRubricKinds: ['cache_prefix_readiness'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'tool-catalog-agents',
          failedRubricKinds: ['token_budget'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'multi-turn-gate-followup',
          failedRubricKinds: ['min_user_turns'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'tool-catalog-query-memory',
          failedRubricKinds: ['unsupported_rubric'],
        }),
        buildTaxonomyEntry({
          fixtureId: 'multi-turn-catalog-memory',
          passed: true,
          rubricAudit: {
            assistantProseRubricCount: 1,
            risks: [
              {
                rubricKind: 'assistant_text',
                reason: 'covered by dashboard grader-quality taxonomy',
              },
            ],
          },
        }),
        buildTaxonomyEntry({
          fixtureId: 'workspace-inventory-manifest',
        }),
        buildTaxonomyEntry({
          fixtureId: 'bench-prompt-cache-convergence-long-run',
          passed: true,
          usage: {
            inputTokens: 4096,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 4116,
            eventCount: 1,
          },
        }),
      ],
      {
        generatedAt: '2026-06-12T00:00:00.000Z',
        maxScenarioRetries: 0,
      },
    );
    const clusters = new Map(
      report.readinessDashboard.failureTaxonomy.map((cluster) => [cluster.category, cluster]),
    );

    expect(clusters.get('wrong_args')?.scenarioIds).toEqual(['file-write-read']);
    expect(clusters.get('tool_poisoning_vulnerability')?.scenarioIds).toEqual([
      'direct-agentdojo-untrusted-workspace-note',
    ]);
    expect(clusters.get('permission_failure')?.scenarioIds).toEqual([
      'bench-androidworld-permission-denial',
      'direct-agentdojo-untrusted-workspace-note',
    ]);
    expect(clusters.get('native_side_effect_failure')?.scenarioIds).toEqual([
      'bench-androidworld-calendar-mutation',
      'direct-toolsandbox-state-dependency',
    ]);
    expect(clusters.get('memory_retrieval_miss')?.scenarioIds).toEqual([
      'bench-bfcl-sequential-memory-chain',
    ]);
    expect(clusters.get('cache_prefix_drift')?.scenarioIds).toEqual([
      'bench-prompt-cache-convergence-long-run',
      'bench-prompt-cache-long-horizon',
    ]);
    expect(clusters.get('token_budget_overrun')?.scenarioIds).toEqual(['tool-catalog-agents']);
    expect(clusters.get('missing_clarification')?.scenarioIds).toEqual([
      'multi-turn-gate-followup',
    ]);
    expect(clusters.get('grader_quality')?.scenarioIds).toEqual(['multi-turn-catalog-memory']);
    expect(clusters.get('unknown_structural_failure')?.scenarioIds).toEqual([
      'tool-catalog-query-memory',
      'workspace-inventory-manifest',
    ]);
  });

  it('uses zero percentiles for empty readiness input', () => {
    const report = buildE2ERunReport([], {
      generatedAt: '2026-06-12T00:00:00.000Z',
      maxScenarioRetries: 0,
    });

    expect(report.readinessDashboard.tokenCostLatency.p95ScenarioTotalTokens).toBe(0);
    expect(report.readinessDashboard.tokenCostLatency.p95ScenarioDurationMs).toBe(0);
  });
});
