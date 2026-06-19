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
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
      ],
      graphSnapshots: [
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          sessionActivatedToolNames: ['memory_recall'],
          observedToolResults: [{ id: 'tc-1', name: 'tool_catalog' }],
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          sessionActivatedToolNames: ['memory_recall'],
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
        { id: 'tc-1', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
        { id: 'tc-2', name: 'tool_catalog', arguments: '{"query":"memory_recall"}' },
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
          sessionActivatedToolNames: ['memory_recall'],
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

  it('counts repeated finalization holds by hold episode instead of snapshot retention', () => {
    const result = buildFixtureResult({
      graphSnapshots: [
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'running',
          finalizationHoldReason: 'goals_incomplete',
        } as E2EScenarioResult['graphSnapshots'][number],
        {
          status: 'finalized',
          finalizationHoldReason: 'goals_incomplete',
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
      repeatedHoldReasons: [{ reason: 'goals_incomplete', count: 2 }],
      passing: true,
    });
  });
});
