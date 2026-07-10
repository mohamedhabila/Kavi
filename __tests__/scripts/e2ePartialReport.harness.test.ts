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
  const tokenBuckets = {
    systemPromptTokens: 0,
    toolDeclarationTokens: 0,
    memoryContextTokens: 0,
    conversationHistoryTokens: 0,
    userTurnTokens: 0,
    toolResultTokens: 0,
  };
  return {
    schemaVersion: 'e2e-run-report-scenario-v2',
    suite: 'core',
    fixtureId: 'file-write-read',
    contentClass: 'synthetic_public',
    passed: true,
    attemptCount: 1,
    durationMs: 10,
    completed: true,
    userTurnCount: 1,
    toolCallCount: 0,
    turnCount: 1,
    graphStatus: 'finalized',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      eventCount: 0,
      tokenBuckets,
    },
    tokenBuckets,
    cache: {
      inputTokens: 0,
      eligibleInputTokens: 0,
      providerManagedReadinessTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheReadRate: 0,
      eligibleCacheReadRate: 0,
      eligible: false,
    },
    loopDiagnostics: {
      repeatedToolCalls: [],
      repeatedCatalogAfterActivationCount: 0,
      repeatedHoldReasons: [],
      passing: true,
    },
    benchmarkFamilies: ['kavi-core'],
    assessmentDimensions: ['task_completion'],
    rubricAudit: {
      rubricCount: 0,
      assistantProseRubricCount: 0,
      weakPatternRubricCount: 0,
      structuralSubstringRubricCount: 0,
      risks: [],
    },
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
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, usage: { ...entry.usage, legacyCounter: 1 } }],
      }),
    ).toThrow('Unknown entries[0].usage fields');
    const { toolResultTokens: _toolResultTokens, ...incompleteBuckets } = entry.tokenBuckets;
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, tokenBuckets: incompleteBuckets }],
      }),
    ).toThrow('Missing entries[0].tokenBuckets.toolResultTokens');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [
          {
            ...entry,
            trace: { schemaVersion: 'e2e-redacted-trace-v2', privatePayload: 'not-a-trace' },
          },
        ],
      }),
    ).toThrow('Invalid entries[0].trace');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, benchmarkFamilies: ['PRIVATE_FAMILY_SENTINEL'] }],
      }),
    ).toThrow('Invalid entries[0].benchmarkFamilies');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, assessmentDimensions: ['PRIVATE_AXIS_SENTINEL'] }],
      }),
    ).toThrow('Invalid entries[0].assessmentDimensions');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, fixtureId: '/Users/private/PRIVATE_FIXTURE_SENTINEL' }],
      }),
    ).toThrow('Invalid entries[0].fixtureId');
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [{ ...entry, contentClass: 'PRIVATE_CONTENT_CLASS_SENTINEL' }],
      }),
    ).toThrow('Invalid entries[0].contentClass');
    const { contentClass: _contentClass, ...unclassifiedEntry } = entry;
    expect(() =>
      parsePartialReport({
        schemaVersion: PARTIAL_REPORT_SCHEMA_VERSION,
        entries: [unclassifiedEntry],
      }),
    ).toThrow('Missing entries[0].contentClass');
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
