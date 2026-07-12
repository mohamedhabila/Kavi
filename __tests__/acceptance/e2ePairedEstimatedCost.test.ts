import { aggregateE2EEstimatedCost } from '../../src/acceptance/e2eAgent/e2eEstimatedCost';
import { buildE2EPairedPublicReport } from '../../src/acceptance/e2eAgent/e2ePairedPublicReport';
import type { E2EPairedConditionExecution } from '../../src/acceptance/e2eAgent/e2ePairedRuntime';
import { completedCondition, runtime } from '../helpers/e2ePairedPublicReportHarness';

describe('paired estimated-cost evidence', () => {
  it('keeps missing cost explicit without blocking capability deltas', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({
          condition: 'memory_off',
          rubricPassed: 0,
          rubricTotal: 1,
          estimatedCostUsd: null,
        }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          estimatedCostUsd: 0.05,
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.conditions[0]).toMatchObject({
      metrics: { estimatedCost: { status: 'unavailable', usd: null } },
    });
    expect(report.estimatedCost).toEqual({
      status: 'unavailable',
      referenceUsd: null,
      candidateUsd: null,
      pairUsd: null,
      deltaUsd: null,
    });
  });

  it('aggregates only complete non-negative per-call estimates', () => {
    expect(
      aggregateE2EEstimatedCost([
        { estimatedCost: 0.0125 },
        { estimatedCost: 0 },
        { estimatedCost: 0.0075 },
      ]),
    ).toEqual({ status: 'available', usd: 0.02 });
    expect(aggregateE2EEstimatedCost([])).toEqual({ status: 'unavailable', usd: null });
    expect(aggregateE2EEstimatedCost([{ estimatedCost: Number.NaN }])).toEqual({
      status: 'unavailable',
      usd: null,
    });
    expect(aggregateE2EEstimatedCost([{ estimatedCost: -0.01 }])).toEqual({
      status: 'unavailable',
      usd: null,
    });
  });

  it('rejects invalid completed-condition cost evidence', () => {
    const first = completedCondition({
      condition: 'production_auto',
      rubricPassed: 1,
      rubricTotal: 1,
    });
    const invalidCost = {
      ...first,
      result: {
        ...first.result,
        estimatedCost: { status: 'available', usd: -1 },
      },
    } as E2EPairedConditionExecution;

    expect(() =>
      buildE2EPairedPublicReport(
        runtime([
          invalidCost,
          completedCondition({
            condition: 'memory_off',
            rubricPassed: 1,
            rubricTotal: 1,
          }),
        ]),
      ),
    ).toThrow('estimatedCost.usd must be a non-negative finite number');
  });
});
