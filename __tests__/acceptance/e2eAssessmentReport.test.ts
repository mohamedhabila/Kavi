import {
  buildE2EAssessmentReport,
  formatE2EAssessmentReportSummary,
  isE2EAssessmentEvidencePassing,
} from '../../src/acceptance/e2eAgent/e2eAssessmentReport';
import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

function buildFixtureResult(fixtureId: string, overrides?: Partial<E2EScenarioResult>): E2EScenarioResult {
  return {
    fixtureId,
    conversationId: `conv-${fixtureId}`,
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [{ status: 'finalized' } as E2EScenarioResult['graphSnapshots'][number]],
    turnTraces: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
      eventCount: 1,
    },
    errors: [],
    completed: true,
    durationMs: 100,
    userTurnCount: 1,
    ...overrides,
  };
}

describe('e2eAssessmentReport', () => {
  it('aggregates dimensional and benchmark-family pass rates', () => {
    const entries = [
      buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult('file-write-read'),
        outcome: { fixtureId: 'file-write-read', passed: true },
        attemptCount: 1,
      }),
      buildE2ERunReportScenarioEntry({
        suite: 'core',
        result: buildFixtureResult('bench-session-tool-cache'),
        outcome: {
          fixtureId: 'bench-session-tool-cache',
          passed: false,
          detail: 'first turn missing tool tool_catalog',
        },
        attemptCount: 2,
      }),
    ];

    const report = buildE2EAssessmentReport(entries);

    expect(report.scenarioCount).toBe(2);
    expect(report.overallScenarioPassRate).toBe(0.5);
    expect(report.dimensions.length).toBeGreaterThan(0);
    expect(report.benchmarkFamilies.length).toBeGreaterThan(0);

    const toolDiscovery = report.dimensions.find((entry) => entry.id === 'tool_discovery');
    expect(toolDiscovery).toBeDefined();
    expect(toolDiscovery?.failedScenarioIds).toContain('bench-session-tool-cache');

    const summary = formatE2EAssessmentReportSummary(report);
    expect(summary).toContain('dimension:tool_discovery');
    expect(summary).toContain('benchmark:tool-discovery-adapted');
    expect(isE2EAssessmentEvidencePassing(report)).toBe(false);
  });
});