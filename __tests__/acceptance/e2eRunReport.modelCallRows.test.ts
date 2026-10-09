import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import {
  PARTIAL_REPORT_SCHEMA_VERSION,
  parsePartialReport,
} from '../../scripts/e2eReport/partialReport';
import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
  TOKEN_BUCKETS,
} from '../helpers/e2eRunReportHarness';

// Per-call usage rows (tool digests, router upstream names) were added to the scenario
// usage summary for private evidence. The run report validates its usage fields exactly,
// so carrying the rows into it made every report write throw — a live run scored 0/20
// with every scenario's work done. The rows stay out of the report.

describe('e2eRunReport scenario usage', () => {
  installE2ERunReportFixtureReset();

  it('reports usage without per-call rows, in a shape the partial report accepts', () => {
    const result = buildFixtureResult({
      usage: {
        inputTokens: 2000,
        outputTokens: 20,
        cacheReadTokens: 900,
        cacheWriteTokens: 0,
        totalTokens: 2020,
        eventCount: 2,
        tokenBuckets: TOKEN_BUCKETS,
        calls: [
          {
            inputTokens: 1000,
            outputTokens: 10,
            cacheReadTokens: 0,
            upstreamProvider: 'Fireworks',
          },
          { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 900, toolDeclarationTokens: 0 },
        ],
      },
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
      rubrics: [{ kind: 'graph_terminal_success' }],
    });

    expect(entry.usage).not.toHaveProperty('calls');
    expect(entry.usage).toMatchObject({ inputTokens: 2000, cacheReadTokens: 900 });
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [JSON.parse(JSON.stringify(entry))],
      }),
    ).not.toThrow();
  });
});
