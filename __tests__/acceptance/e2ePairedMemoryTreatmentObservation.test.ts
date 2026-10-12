import { buildE2EPairedPublicReport } from '../../src/acceptance/e2eAgent/e2ePairedPublicReport';
import {
  buildPairedMemoryPromptBuild,
  buildPairedTurnTrace,
  recordedMemoryPrompt,
} from '../helpers/e2ePairedRunHarness';
import { completedCondition, runtime } from '../helpers/e2ePairedPublicReportHarness';

describe('paired memory treatment observations', () => {
  it('accepts a turn that read memory again after it changed mid-turn', () => {
    const report = buildE2EPairedPublicReport(
      runtime([
        completedCondition({ condition: 'memory_off', rubricPassed: 0, rubricTotal: 1 }),
        completedCondition({
          condition: 'production_auto',
          rubricPassed: 1,
          rubricTotal: 1,
          turnTraces: [
            buildPairedTurnTrace(
              recordedMemoryPrompt([
                buildPairedMemoryPromptBuild(),
                buildPairedMemoryPromptBuild({ itemIds: ['private-item-id', 'private-item-2'] }),
              ]),
            ),
          ],
        }),
      ]),
    );

    expect(report.validForDeltaClaims).toBe(true);
    expect(report.memoryPairedObservation).toMatchObject({
      status: 'positive_delta',
      pairedScoreDelta: 1,
    });
    expect(report.conditions[1]).toMatchObject({
      metrics: {
        userTurnCount: 1,
        memory: {
          turnStatusCounts: { recorded: 1 },
          buildCount: 2,
          selectedItemCount: 2,
          selectedPastTurnCount: 1,
        },
      },
    });
  });
});
