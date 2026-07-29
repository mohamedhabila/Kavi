import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

type TaxonomyModule = {
  inferFailureCategories: (entry: Record<string, unknown>, cacheRate: number) => string[];
  parseRubricKind: (fixtureId: string) => string | null;
};

const taxonomy = require('../../scripts/e2eReport/taxonomy') as TaxonomyModule;
const publicPolicy = require('../../scripts/e2eReport/publicProjectionPolicy') as {
  FAILURE_CATEGORIES: ReadonlySet<string>;
  RUBRIC_KINDS: ReadonlySet<string>;
};
const { buildE2eRunReport } = require('../../scripts/e2e-flush-run-report') as {
  buildE2eRunReport: (entries: ReadonlyArray<Record<string, unknown>>) => Record<string, unknown>;
};
const { projectPublicRunReport } = require('../../scripts/e2eReport/publicRunReport') as {
  projectPublicRunReport: (report: Record<string, unknown>) => Record<string, unknown>;
};

function buildFailedEntry(failureId: string): Record<string, unknown> {
  return {
    passed: false,
    failedRubrics: [{ fixtureId: failureId }],
    assessmentDimensions: [],
    loopDiagnostics: { passing: true, repeatedToolCalls: [] },
    cache: { eligible: false, eligibleCacheReadRate: 0 },
    rubricAudit: { assistantProseRubricCount: 0, weakPatternRubricCount: 0 },
  };
}

describe('E2E report stage-attribution taxonomy', () => {
  it.each([
    ['fixture:turn-0:turn_route', 'turn_route', 'execution_route_failure'],
    ['fixture:turn-0:turn_completion:execution', 'turn_completion', 'execution_failure'],
    ['fixture:turn-0:turn_completion:agent_run', 'turn_completion', 'execution_failure'],
    ['fixture:turn-0:turn_completion:final_response', 'turn_completion', 'final_response_failure'],
    ['fixture:turn-0:turn_memory_receipt', 'turn_memory_receipt', 'memory_write_failure'],
    [
      'fixture:turn-0:turn_lifecycle_boundary',
      'turn_lifecycle_boundary',
      'lifecycle_recovery_failure',
    ],
    ['fixture:turn-0:turn_clarification', 'turn_clarification', 'missing_clarification'],
    [
      'fixture:turn-0:calendar_update_event:turn_native_invocation_count',
      'turn_native_invocation_count',
      'native_side_effect_failure',
    ],
    ['fixture:turn-0:all:turn_tool_call_count', 'turn_tool_call_count', 'wrong_tool'],
  ])('classifies %s from its current structural outcome id', (failureId, kind, category) => {
    expect(taxonomy.parseRubricKind(failureId)).toBe(kind);
    expect(taxonomy.inferFailureCategories(buildFailedEntry(failureId), 0.25)).toEqual([category]);
  });

  it('rejects the removed bundled completion outcome id', () => {
    expect(taxonomy.parseRubricKind('fixture:turn_completion')).toBeNull();
    expect(
      taxonomy.inferFailureCategories(buildFailedEntry('fixture:turn_completion'), 0.25),
    ).toEqual(['unknown_structural_failure']);
  });

  it('admits the precise rubric and category contracts through public projection', () => {
    expect(publicPolicy.RUBRIC_KINDS).toEqual(
      expect.objectContaining({
        has: expect.any(Function),
      }),
    );
    for (const rubricKind of [
      'turn_route',
      'turn_completion',
      'turn_memory_receipt',
      'turn_lifecycle_boundary',
      'turn_clarification',
      'turn_native_invocation_count',
      'turn_tool_call_count',
    ]) {
      expect(publicPolicy.RUBRIC_KINDS.has(rubricKind)).toBe(true);
    }
    for (const category of [
      'execution_route_failure',
      'execution_failure',
      'final_response_failure',
      'memory_write_failure',
      'lifecycle_recovery_failure',
    ]) {
      expect(publicPolicy.FAILURE_CATEGORIES.has(category)).toBe(true);
    }
  });

  it('preserves field-scoped completion identity and category in the public report', () => {
    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result: buildFixtureResult(),
      outcome: { fixtureId: 'file-write-read', passed: false },
      attemptCount: 1,
    });
    const rawReport = buildE2eRunReport([
      {
        ...entry,
        failedRubrics: [
          {
            fixtureId: 'file-write-read:turn-0:turn_completion:final_response',
            detail: 'private failure detail',
          },
        ],
      },
    ]);

    const publicReport = projectPublicRunReport(rawReport) as {
      scenarios: Array<{ failedRubrics: Array<{ rubricKind?: string }> }>;
      readinessDashboard: {
        failureTaxonomy: Array<{ category: string; scenarioIds: string[] }>;
      };
    };

    expect(publicReport.scenarios[0]?.failedRubrics[0]?.rubricKind).toBe('turn_completion');
    expect(
      publicReport.readinessDashboard.failureTaxonomy.find(
        (cluster) => cluster.category === 'final_response_failure',
      )?.scenarioIds,
    ).toEqual(['file-write-read']);
  });
});
