// ---------------------------------------------------------------------------
// E2E agent eval — live provider scenarios (opt-in)
// ---------------------------------------------------------------------------
// Gated: RUN_E2E_AGENT_EVAL=1 and selected-provider credentials.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { getThinkingParams } from '../../src/engine/thinking';
import { LlmService } from '../../src/services/llm/LlmService';
import {
  evaluateE2EAgentOutcomes,
  formatE2ETokenUsageReport,
  isE2EAgentMetricsPassing,
} from '../../src/acceptance/e2eAgent/evaluateE2EAgentMetrics';
import {
  buildE2EProvider,
  shouldRunE2EAgentEval,
} from '../../src/acceptance/e2eAgent/providerConfig';
import { formatE2EAssessmentReportSummary } from '../../src/acceptance/e2eAgent/e2eAssessmentReport';
import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
  formatE2ERunReportSummary,
  recordE2ERunReportEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import { runE2EScenarioWithRetry } from '../../src/acceptance/e2eAgent/e2eScenarioRetry';
import type { AcceptanceFixtureOutcome } from '../../src/acceptance/acceptanceMetrics/types';
import { E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';
import { useSettingsStore } from '../../src/store/useSettingsStore';

const describeE2E = shouldRunE2EAgentEval() ? describe : describe.skip;

describeE2E('E2E agent eval — selected provider', () => {
  jest.setTimeout(900_000);

  beforeEach(() => {
    useSettingsStore.setState({ disableLongTermMemory: false });
    resetE2EWorkspaceSandbox();
    resetE2EMemorySandbox();
  });

  afterEach(() => {
    resetE2EWorkspaceSandbox();
    teardownE2EMemorySandbox();
  });

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('connects with the selected provider config and returns text', async () => {
    const provider = buildE2EProvider();
    expect(provider.apiKey.length).toBeGreaterThan(0);
    expect(provider.baseUrl.length).toBeGreaterThan(0);
    expect(provider.model.length).toBeGreaterThan(0);

    const service = new LlmService(provider);
    const maxTokens = 256;
    const response = await service.sendMessage(
      [{ role: 'user', content: 'Reply with exactly one word: PONG' }],
      {
        model: provider.model,
        maxTokens,
        temperature: 0,
        ...getThinkingParams('minimal', provider.model, { maxTokens }),
      },
    );

    const text = String(response?.choices?.[0]?.message?.content ?? '').trim();
    expect(text.length).toBeGreaterThan(0);
    expect(text.toUpperCase()).toContain('PONG');
  });

  const scenarioResults: E2EScenarioResult[] = [];
  const scenarioOutcomes: AcceptanceFixtureOutcome[] = [];

  for (const scenario of E2E_AGENT_SCENARIOS) {
    it(`scenario ${scenario.id}`, async () => {
      const attempt = await runE2EScenarioWithRetry(scenario);
      scenarioResults.push(attempt.result);
      scenarioOutcomes.push(attempt.outcome);
      recordE2ERunReportEntry(
        buildE2ERunReportScenarioEntry({
          suite: 'core',
          result: attempt.result,
          outcome: attempt.outcome,
          attemptCount: attempt.attemptCount,
          rubrics: scenario.rubrics,
        }),
      );

      if (!attempt.outcome.passed) {
        const lastGraph = attempt.result.graphSnapshots[attempt.result.graphSnapshots.length - 1];
        console.error(
          `[e2e-agent-eval] ${scenario.id} failed`,
          attempt.outcome.detail,
          `attempts=${attempt.attemptCount}`,
          `tools=${attempt.result.toolCalls.map((call) => call.name).join(',')}`,
          `graph=${lastGraph?.status ?? 'none'}`,
          `errors=${attempt.result.errors.join('|') || 'none'}`,
          `tokens=${attempt.result.usage.totalTokens}`,
        );
      }

      expect(attempt.outcome.passed).toBe(true);
    });
  }

  it('records token usage per scenario and meets pass-rate threshold', () => {
    expect(scenarioResults.length).toBe(E2E_AGENT_SCENARIOS.length);
    expect(scenarioOutcomes.length).toBe(E2E_AGENT_SCENARIOS.length);

    for (const result of scenarioResults) {
      expect(result.usage.eventCount).toBeGreaterThan(0);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
    }

    const report = formatE2ETokenUsageReport(scenarioResults);
    console.log(`[e2e-agent-eval] token usage\n${report}`);

    const evaluation = evaluateE2EAgentOutcomes(scenarioOutcomes, scenarioResults);
    expect(isE2EAgentMetricsPassing(evaluation)).toBe(true);

    const reportEntries = scenarioResults.map((result, index) =>
      buildE2ERunReportScenarioEntry({
        suite: 'core',
        result,
        outcome: scenarioOutcomes[index]!,
        attemptCount: 1,
      }),
    );
    const runReport = buildE2ERunReport(reportEntries, {
      metricOutcomes: scenarioOutcomes,
      metricResults: scenarioResults,
    });
    console.log(formatE2ERunReportSummary(runReport));
    console.log(formatE2EAssessmentReportSummary(runReport.assessment));
  });
});
