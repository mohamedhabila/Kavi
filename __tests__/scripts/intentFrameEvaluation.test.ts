import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const {
  aggregateIntentFrameEvaluation,
  digestIntentFrameProjection,
} = require('../../scripts/lib/intentFrameEvaluation');
const {
  INTENT_FRAME_FIELDS,
  loadIntentFrameSchema,
  validateIntentFrameInput,
  validateIntentFrameReport,
} = require('../../scripts/lib/intentFrameContract');

const projectRoot = path.resolve(__dirname, '../..');
const schema = loadIntentFrameSchema(projectRoot);
const fixturePath = path.join(__dirname, '../fixtures/intent-frame-synthetic.json');

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function removeEmptyDirectory(directory: string): void {
  try {
    fs.rmdirSync(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error;
  }
}

function loadFixture(): any {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function freezeProjectionDigests(input: any): void {
  input.source.candidateArtifactSha256 = digestIntentFrameProjection(input.cases, 'candidate');
  input.source.goldLabelsSha256 = digestIntentFrameProjection(input.cases, 'gold');
}

function aggregate(input: any) {
  return aggregateIntentFrameEvaluation(input, {
    generatedAt: '2026-07-10T11:00:00.000Z',
    inputSha256: 'd'.repeat(64),
    schema,
  });
}

function makeScorableCandidatesPerfect(input: any): void {
  for (const caseEntry of input.cases) {
    for (const field of INTENT_FRAME_FIELDS) {
      const goldField = caseEntry.gold[field];
      if (goldField.status !== 'scorable') continue;
      caseEntry.candidate[field] = Object.hasOwn(goldField, 'values')
        ? [...goldField.values]
        : goldField.value;
    }
  }
}

describe('evaluator-only intent frame', () => {
  it('scores every closed field and keeps ambiguous and unscorable evidence explicit', () => {
    const input = loadFixture();
    const result = aggregate(input);

    expect(result.contractFailures).toEqual([]);
    expect(result.reportFailures).toEqual([]);
    expect(result.report).toMatchObject({
      claimEligible: true,
      eligibilityFailures: [],
      counts: {
        cases: 6,
        fieldLabels: 60,
        scorable: 58,
        ambiguous: 1,
        unscorable: 1,
      },
      evaluator: {
        kind: 'deterministic_structural',
        minimumScorableCoverage: 0.8,
      },
      leakageControls: {
        closedCandidateFrame: true,
        rawRequestExcluded: true,
        executionEvidenceExcluded: true,
        finalAnswerExcluded: true,
        goldAppRuntimeAccess: false,
        candidateCapturePhase: 'pre_execution',
      },
    });
    expect(result.report.fields.map((field: any) => field.field)).toEqual(INTENT_FRAME_FIELDS);
    expect(result.report.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'preferences',
          scorable: 5,
          ambiguous: 1,
          unscorable: 0,
          coverageRate: 5 / 6,
          f1: 1,
        }),
        expect.objectContaining({
          field: 'entities',
          scorable: 5,
          ambiguous: 0,
          unscorable: 1,
          coverageRate: 5 / 6,
          f1: 1,
        }),
        expect.objectContaining({
          field: 'requestedMode',
          truePositive: 4,
          falsePositive: 2,
          falseNegative: 2,
          f1: 2 / 3,
        }),
      ]),
    );
    expect(result.report.macroF1).toBeCloseTo(14 / 15, 12);
    expect(result.report.coverage.languages).toHaveLength(6);
    expect(result.report.coverage.productAreas).toHaveLength(6);
    expect(validateIntentFrameReport(result.report, schema)).toEqual([]);
  });

  it('is byte-deterministic for frozen input, projections, and generated time', () => {
    const input = loadFixture();
    const first = aggregate(input).report;
    const second = aggregate(input).report;

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(digestIntentFrameProjection(input.cases, 'candidate')).toBe(
      input.source.candidateArtifactSha256,
    );
    expect(digestIntentFrameProjection(input.cases, 'gold')).toBe(
      input.source.goldLabelsSha256,
    );
  });

  it('binds both frozen projections to case identity and request identity', () => {
    const input = loadFixture();
    const firstRequest = input.cases[0].requestSha256;
    input.cases[0].requestSha256 = input.cases[1].requestSha256;
    input.cases[1].requestSha256 = firstRequest;

    const result = aggregate(input);
    expect(result.report.claimEligible).toBe(false);
    expect(result.report.eligibilityFailures).toEqual(
      expect.arrayContaining(['candidate_digest_mismatch', 'gold_digest_mismatch']),
    );

    const reassociatedGold = loadFixture();
    const firstGold = reassociatedGold.cases[0].gold;
    reassociatedGold.cases[0].gold = reassociatedGold.cases[1].gold;
    reassociatedGold.cases[1].gold = firstGold;
    expect(aggregate(reassociatedGold).report.eligibilityFailures).toContain(
      'gold_digest_mismatch',
    );

    const relabeledCoverage = loadFixture();
    relabeledCoverage.cases[0].language = 'fr';
    relabeledCoverage.cases[1].productArea = 'long_task';
    expect(aggregate(relabeledCoverage).report.eligibilityFailures).toEqual(
      expect.arrayContaining(['candidate_digest_mismatch', 'gold_digest_mismatch']),
    );
  });

  it('rejects an all-zero request digest instead of treating a placeholder as evidence', () => {
    const input = loadFixture();
    input.cases[0].requestSha256 = '0'.repeat(64);
    freezeProjectionDigests(input);

    const result = aggregate(input);
    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('input.cases[0].requestSha256: must match pattern'),
      ]),
    );
    expect(result.report.eligibilityFailures).toContain('invalid_contract');
  });

  it('rejects execution, tool-call, final-answer, and raw-request leakage', () => {
    for (const forbiddenField of ['execution', 'toolCalls', 'finalAnswer']) {
      const input = loadFixture();
      input.cases[0].candidate[forbiddenField] = { private: true };
      expect(validateIntentFrameInput(input, schema)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('input.cases[0].candidate: must NOT have additional properties'),
        ]),
      );
      expect(aggregate(input).report.eligibilityFailures).toContain('invalid_contract');
    }

    const rawRequest = loadFixture();
    rawRequest.cases[0].requestText = 'private request text';
    expect(validateIntentFrameInput(rawRequest, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('input.cases[0]: must NOT have additional properties'),
      ]),
    );

    const postExecutionCapture = loadFixture();
    postExecutionCapture.source.candidateCapturePhase = 'post_execution';
    postExecutionCapture.source.candidateExecutionEvidenceAccess = true;
    postExecutionCapture.source.candidateFinalAnswerAccess = true;
    postExecutionCapture.source.goldAppRuntimeAccess = true;
    expect(validateIntentFrameInput(postExecutionCapture, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('input.source.candidateCapturePhase: must be equal to constant'),
        expect.stringContaining(
          'input.source.candidateExecutionEvidenceAccess: must be equal to constant',
        ),
        expect.stringContaining(
          'input.source.candidateFinalAnswerAccess: must be equal to constant',
        ),
        expect.stringContaining('input.source.goldAppRuntimeAccess: must be equal to constant'),
      ]),
    );
  });

  it('does not publish case ids, canonical atoms, requests, gold, or candidates', () => {
    const report = aggregate(loadFixture()).report;
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain('calendar-en-001');
    expect(serialized).not.toContain('create_calendar_event');
    expect(serialized).not.toContain('requestSha256');
    expect(serialized).not.toContain('candidate"');
    expect(serialized).not.toContain('gold"');
    expect(serialized).not.toContain('multiple_valid_interpretations');
    expect(serialized).not.toContain('1111111111111111111111111111111111111111111111111111111111111111');
  });

  it('keeps perfect F1 on a selected subset ineligible when field coverage is too low', () => {
    const input = loadFixture();
    makeScorableCandidatesPerfect(input);
    for (let index = 0; index < input.cases.length - 1; index += 1) {
      input.cases[index].gold.goal = {
        status: 'ambiguous',
        reason: 'multiple_valid_interpretations',
      };
    }
    freezeProjectionDigests(input);

    const report = aggregate(input).report;
    const goal = report.fields.find((field: any) => field.field === 'goal');
    expect(report.macroF1).toBe(1);
    expect(goal).toMatchObject({
      scorable: 1,
      ambiguous: 5,
      coverageRate: 1 / 6,
      f1: 1,
    });
    expect(report.claimEligible).toBe(false);
    expect(report.eligibilityFailures).toContain('incomplete_field_coverage');
  });

  it('rejects duplicate cases and mixed none atoms without hiding their scores', () => {
    const input = loadFixture();
    input.cases[1].id = input.cases[0].id;
    input.cases[0].candidate.constraints = ['none', 'no_guest_invites'];
    freezeProjectionDigests(input);

    const result = aggregate(input);
    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id: must be unique'),
        expect.stringContaining('none must be the only atom'),
      ]),
    );
    expect(result.report.eligibilityFailures).toEqual(
      expect.arrayContaining(['invalid_contract', 'duplicate_case', 'invalid_none_atom']),
    );
    expect(result.report.fields).toHaveLength(10);
    expect(result.reportFailures).toEqual([]);
  });

  it('detects report denominator, coverage, metric, ordering, and eligibility edits', () => {
    const report = clone(aggregate(loadFixture()).report);
    report.claimEligible = false;
    report.counts.fieldLabels = 59;
    report.fields[0].coverageRate = 1 / 6;
    report.fields[0].f1 = 0.25;
    [report.fields[0], report.fields[1]] = [report.fields[1], report.fields[0]];
    report.coverage.languages.reverse();

    expect(validateIntentFrameReport(report, schema)).toEqual(
      expect.arrayContaining([
        'report.claimEligible: must equal absence of eligibility failures',
        'report.counts.fieldLabels: must equal cases times the closed field count',
        expect.stringContaining('must preserve the canonical intent-frame order'),
        expect.stringContaining('coverageRate: must equal scorable evidence divided by cases'),
        expect.stringContaining('f1: must equal the canonical confusion-count rate'),
        'report.coverage.languages: must contain unique entries sorted by id',
      ]),
    );
  });

  it('runs the private keyless CLI and writes only the public aggregate', () => {
    const privateRoot = path.join(projectRoot, '.private', 'evals');
    fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    const directory = fs.mkdtempSync(path.join(privateRoot, 'intent-frame-test-'));
    const inputPath = path.join(directory, 'frames.json');
    const outputRelativePath = path.join('.artifacts', `intent-frame-test-${process.pid}.json`);
    const outputPath = path.join(projectRoot, outputRelativePath);
    try {
      fs.writeFileSync(inputPath, `${JSON.stringify(loadFixture())}\n`, { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        [
          './scripts/intent-frame-evaluation.js',
          '--input',
          inputPath,
          '--output',
          outputRelativePath,
        ],
        { cwd: projectRoot, encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('claimEligible=true');
      expect(result.stdout).not.toContain(inputPath);
      expect(result.stderr).toBe('');
      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      expect(report.claimEligible).toBe(true);
      expect(JSON.stringify(report)).not.toContain(inputPath);
      expect(JSON.stringify(report)).not.toContain('calendar-en-001');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.rmSync(outputPath, { force: true });
      removeEmptyDirectory(path.dirname(outputPath));
    }
  });
});
