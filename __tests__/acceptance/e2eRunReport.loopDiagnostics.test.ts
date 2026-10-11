import {
  buildE2ERunReport,
  buildE2ERunReportScenarioEntry,
} from '../../src/acceptance/e2eAgent/e2eRunReport';
import type { E2EScenarioResult } from '../../src/acceptance/e2eAgent/types';

import {
  buildFixtureResult,
  installE2ERunReportFixtureReset,
} from '../helpers/e2eRunReportHarness';

describe('e2eRunReport loop diagnostics', () => {
  installE2ERunReportFixtureReset();

  it('surfaces discovery loops after session-level tool activation', () => {
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_search"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_search"}' },
      ],
      graphSnapshots: [
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_search'],
          observedToolResults: [],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_search'],
          observedToolResults: [{ id: 'tc-1', name: 'tool_catalog' }],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          sessionActivatedToolNames: ['memory_search'],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });
    const report = buildE2ERunReport([entry], {
      metricOutcomes: [{ fixtureId: result.fixtureId, passed: true }],
      metricResults: [result],
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedCatalogAfterActivationCount: 2,
      repeatedToolCalls: [
        expect.objectContaining({
          name: 'tool_catalog',
          count: 2,
          noNewEvidence: true,
        }),
      ],
      passing: false,
    });
    expect(report.readiness.failedCriteria).toContain('loop_diagnostics');
  });

  it('does not classify pre-activation discovery fanout as post-activation catalog looping', () => {
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_search"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_search"}' },
      ],
      graphSnapshots: [
        {
          status: 'running',
          sessionActivatedToolNames: [],
          observedToolResults: [{ id: 'tc-1', name: 'tool_catalog' }],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          sessionActivatedToolNames: [],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          sessionActivatedToolNames: ['memory_search'],
          observedToolResults: [
            { id: 'tc-1', name: 'tool_catalog' },
            { id: 'tc-2', name: 'tool_catalog' },
          ],
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedCatalogAfterActivationCount: 0,
      repeatedToolCalls: [
        expect.objectContaining({
          name: 'tool_catalog',
          count: 2,
          noNewEvidence: true,
        }),
      ],
      passing: true,
    });
  });

  it('does not call a repeated call stale when its results differ', () => {
    const call = { name: 'web_search', arguments: '{"query":"rates"}' };
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', ...call },
        { id: 'tc-2', ...call },
        { id: 'tc-3', ...call },
      ],
      toolResults: [
        { toolCallId: 'tc-1', name: 'web_search', content: '{"items":["a"]}', isError: false },
        { toolCallId: 'tc-2', name: 'web_search', content: '{"items":["b"]}', isError: false },
        { toolCallId: 'tc-3', name: 'web_search', content: '{"items":["c"]}', isError: false },
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics?.repeatedToolCalls).toEqual([
      expect.objectContaining({ name: 'web_search', count: 3, noNewEvidence: false }),
    ]);
  });

  it('calls a repeated call stale when it answered the same every time', () => {
    const call = { name: 'web_search', arguments: '{"query":"rates"}' };
    const same = '{"items":["a"]}';
    const result = buildFixtureResult({
      toolCalls: [
        { id: 'tc-1', ...call },
        { id: 'tc-2', ...call },
        { id: 'tc-3', ...call },
      ],
      toolResults: ['tc-1', 'tc-2', 'tc-3'].map((toolCallId) => ({
        toolCallId,
        name: 'web_search',
        content: same,
        isError: false,
      })),
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedToolCalls: [
        expect.objectContaining({ name: 'web_search', count: 3, noNewEvidence: true }),
      ],
      passing: false,
    });
  });

  it('counts repeated finalization holds by hold episode instead of snapshot retention', () => {
    const result = buildFixtureResult({
      graphSnapshots: [
        {
          status: 'running',
          finalizationHoldReason: 'async_waiting_finalization_hold',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'async_waiting_finalization_hold',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'async_waiting_finalization_hold',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          finalizationHoldReason: 'async_waiting_finalization_hold',
        } as E2EScenarioResult['graphSnapshots'][number],
      ],
    });

    const entry = buildE2ERunReportScenarioEntry({
      suite: 'core',
      result,
      outcome: { fixtureId: result.fixtureId, passed: true },
      attemptCount: 1,
    });

    expect(entry.loopDiagnostics).toMatchObject({
      repeatedHoldReasons: [{ reason: 'async_waiting_finalization_hold', count: 2 }],
      passing: true,
    });
  });
});
