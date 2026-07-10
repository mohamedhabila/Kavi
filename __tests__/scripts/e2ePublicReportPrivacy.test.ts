import { buildE2ERunReportScenarioEntry } from '../../src/acceptance/e2eAgent/e2eRunReport';
import { buildFixtureResult } from '../helpers/e2eRunReportHarness';

const { buildE2eRunReport } = require('../../scripts/e2e-flush-run-report');
const {
  PARTIAL_REPORT_SCHEMA_VERSION,
  parsePartialReport,
} = require('../../scripts/e2eReport/partialReport');
const { projectPublicRunReport } = require('../../scripts/e2eReport/publicRunReport');
const { projectPublicRedactedTrace } = require('../../scripts/e2eReport/publicTraceSchema');

function buildScenarioEntry() {
  return buildE2ERunReportScenarioEntry({
    suite: 'core',
    result: buildFixtureResult(),
    outcome: { fixtureId: 'file-write-read', passed: true },
    attemptCount: 1,
  });
}

function buildRawReport() {
  return buildE2eRunReport([buildScenarioEntry()], {
    generatedAt: '2026-07-10T00:00:00.000Z',
    runMetadata: {
      gitSha: 'f'.repeat(40),
      provider: 'openai',
      providerId: 'e2e-openai',
      hostedFamily: 'openai',
      model: 'gpt-5',
      modelIdentitySource: 'provider-model-id',
      modelLocatorSha256: 'a'.repeat(64),
      endpointSha256: 'b'.repeat(64),
      scenarioManifestVersion: '2026-06-12.phase0',
      promptCacheMode: 'provider-default',
      nativeToolFixtureVersion: 'native-tools-2026-06-12',
      collectMode: false,
    },
  });
}

describe('public E2E report privacy boundaries', () => {
  it('rebuilds canonical assessment metadata and rejects unknown public axes', () => {
    const entryWithPrivateAxis = {
      ...buildScenarioEntry(),
      assessmentDimensions: ['PRIVATE_AXIS_SENTINEL'],
    };
    expect(() => buildE2eRunReport([entryWithPrivateAxis])).toThrow(
      'Unsupported public evaluation axis',
    );

    const rawReport = buildRawReport() as any;
    const dimension = rawReport.assessment.dimensions.find(
      (axis: { id: string }) => axis.id === 'task_completion',
    );
    const family = rawReport.assessment.benchmarkFamilies.find(
      (axis: { id: string }) => axis.id === 'kavi-core',
    );
    const dashboardFamily = rawReport.readinessDashboard.familyReadiness.find(
      (axis: { id: string }) => axis.id === 'kavi-core',
    );
    dimension.label = 'PRIVATE_AXIS_LABEL_SENTINEL';
    family.label = 'PRIVATE_FAMILY_LABEL_SENTINEL';
    family.externalReference = 'PRIVATE_FAMILY_REFERENCE_SENTINEL';
    dashboardFamily.label = 'PRIVATE_DASHBOARD_LABEL_SENTINEL';

    const publicReport = projectPublicRunReport(rawReport) as any;
    expect(JSON.stringify(publicReport)).not.toContain('PRIVATE_');
    expect(
      publicReport.assessment.dimensions.find((axis: { id: string }) =>
        axis.id === 'task_completion',
      ),
    ).toMatchObject({
      label: 'Task completion (artifacts, goals, terminal graph)',
    });
    expect(
      publicReport.assessment.benchmarkFamilies.find((axis: { id: string }) =>
        axis.id === 'kavi-core',
      ),
    ).toMatchObject({
      label: 'Kavi core scenarios',
      externalReference: 'Kavi core mobile-assistant scenario suite',
    });
    expect(
      publicReport.readinessDashboard.familyReadiness.find((axis: { id: string }) =>
        axis.id === 'kavi-core',
      ),
    ).toMatchObject({ label: 'Kavi core scenarios' });

    rawReport.assessment.dimensions.push({
      ...dimension,
      id: 'PRIVATE_AXIS_SENTINEL',
      label: 'PRIVATE_AXIS_SENTINEL',
    });
    expect(() => projectPublicRunReport(rawReport)).toThrow('invalid assessment dimension');
  });

  it('rejects a retained trace whose identity differs from its validated scenario', () => {
    const scenarioEntry = buildScenarioEntry();
    const mismatchedEntry = {
      ...scenarioEntry,
      trace: {
        ...scenarioEntry.trace,
        fixtureId: 'PRIVATE_TRACE_FIXTURE_SENTINEL',
      },
    };

    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [mismatchedEntry],
      }),
    ).toThrow('Mismatched entries[0].trace.fixtureId');
    expect(
      projectPublicRedactedTrace({
        ...scenarioEntry.trace,
        fixtureId: '/Users/private/PRIVATE_TRACE_FIXTURE_SENTINEL',
      }),
    ).toBeNull();
  });
});
