import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  PARTIAL_REPORT_SCHEMA_VERSION,
  parsePartialReport,
  readPartialReportFile,
  writePartialReportFile,
} from '../../scripts/e2eReport/partialReport';

function buildEntry() {
  return {
    schemaVersion: 'e2e-run-report-scenario-v2',
    suite: 'core',
    fixtureId: 'file-write-read',
    passed: true,
    attemptCount: 1,
    durationMs: 10,
    completed: true,
    userTurnCount: 1,
    toolCallCount: 0,
    turnCount: 1,
    graphStatus: 'finalized',
    usage: {},
    tokenBuckets: {},
    cache: {},
    loopDiagnostics: {},
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['task_completion'],
    rubricAudit: {},
    errors: [],
  };
}

describe('current evaluation partial report contract', () => {
  it('round-trips only the current versioned envelope', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-partial-'));
    const partialPath = join(directory, 'report.partial.json');
    const entry = buildEntry();

    try {
      writePartialReportFile(partialPath, [entry]);

      expect(readPartialReportFile<typeof entry>(partialPath)).toEqual({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [entry],
      });
      expect(JSON.parse(readFileSync(partialPath, 'utf8'))).toMatchObject({
        schemaVersion: 'e2e-partial-report-v2',
        entries: [{ schemaVersion: 'e2e-run-report-scenario-v2' }],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects legacy arrays, legacy versions, missing fields, and unknown entry fields', () => {
    const entry = buildEntry();

    expect(() => parsePartialReport([entry])).toThrow('current versioned envelope');
    expect(() =>
      parsePartialReport({ schemaVersion: 'e2e-partial-report-v1', entries: [entry] }),
    ).toThrow('legacy data is not accepted');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, schemaVersion: undefined }],
      }),
    ).toThrow('Unsupported entries[0].schemaVersion');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, legacyPrivatePayload: 'never-normalize-me' }],
      }),
    ).toThrow('Unknown entries[0] fields');
  });

  it('rejects an existing empty partial instead of treating it as a successful run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kavi-e2e-partial-empty-'));
    const partialPath = join(directory, 'report.partial.json');
    writeFileSync(partialPath, '', 'utf8');

    try {
      expect(() => readPartialReportFile(partialPath)).toThrow('empty');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
