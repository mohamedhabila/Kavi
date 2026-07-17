import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createPrivateEvaluationCliProject } from '../helpers/privateEvaluationCliProject';

const {
  digestCalibrationProjection,
  evaluateJudgeCalibration,
  loadJudgeCalibrationSchema,
  validateJudgeCalibrationInput,
  validateJudgeCalibrationReport,
} = require('../../scripts/lib/judgeCalibration');

const projectRoot = path.resolve(__dirname, '../..');
const schema = loadJudgeCalibrationSchema(projectRoot);
const digest = 'a'.repeat(64);

type ProjectionInput = {
  custody: { humanLabelsSha256: string; judgePredictionsSha256: string };
  examples: Array<{ id: string; family: string; humanLabel: string; judgeLabel: string }>;
};

function buildInput(options: { mismatchCount?: number } = {}) {
  const mismatchCount = options.mismatchCount ?? 4;
  const examples = Array.from({ length: 100 }, (_, index) => {
    const humanLabel = index < 50 ? 'pass' : 'fail';
    return {
      id: `cal-${index.toString(16).padStart(16, '0')}`,
      family: index % 2 === 0 ? 'memory' : 'task_completion',
      humanLabel,
      judgeLabel: index < mismatchCount ? (humanLabel === 'pass' ? 'fail' : 'pass') : humanLabel,
    };
  });
  const input = {
    $schema:
      'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/judge-calibration.schema.json',
    kind: 'judge_calibration_input',
    schemaVersion: '1.0.0',
    id: 'private-calibration-v1',
    frozenAt: '2025-01-01T00:00:00.000Z',
    candidate: {
      id: 'candidate-app',
      maintainerIds: ['candidate-maintainer'],
    },
    custody: {
      ownerId: 'calibration-owner',
      reviewerId: 'calibration-reviewer',
      humanLabelsSha256: '',
      judgePredictionsSha256: '',
      candidateAccessDetected: false,
      humanLabelsExposedBeforeJudgeFreeze: false,
      humanLabelsFrozenAt: '2025-01-01T12:00:00.000Z',
      judgePredictionsFrozenAt: '2025-01-02T00:00:00.000Z',
      humanLabelsReleasedAt: '2025-01-03T00:00:00.000Z',
      accessReviewedAt: '2025-01-04T00:00:00.000Z',
    },
    evaluator: {
      kind: 'llm_judge',
      id: 'private-judge',
      modelIdentity: 'private-model-identity',
      judgeConfigSha256: digest,
      modelConfigSha256: 'b'.repeat(64),
      promptSha256: 'c'.repeat(64),
      rubricSha256: 'd'.repeat(64),
    },
    requiredFamilies: ['memory', 'task_completion'],
    examples,
  };
  refreshProjectionDigests(input);
  return input;
}

function refreshProjectionDigests(input: ProjectionInput) {
  input.custody.humanLabelsSha256 = digestCalibrationProjection(input.examples, 'human');
  input.custody.judgePredictionsSha256 = digestCalibrationProjection(input.examples, 'judge');
}

function evaluate(input: ReturnType<typeof buildInput>) {
  return evaluateJudgeCalibration(input, {
    generatedAt: '2025-01-05T00:00:00.000Z',
    inputSha256: 'e'.repeat(64),
    schema,
  });
}

describe('judge calibration contract', () => {
  it('passes only below five-percent resolved disagreement', () => {
    const result = evaluate(buildInput());

    expect(result.contractFailures).toEqual([]);
    expect(result.reportFailures).toEqual([]);
    expect(result.report).toMatchObject({
      status: 'passed',
      claimEligible: true,
      counts: {
        resolvedHuman: 100,
        humanPass: 50,
        humanFail: 50,
        judgeBinaryAgreement: 96,
        judgeBinaryMismatch: 4,
        judgeAmbiguousOnResolved: 0,
      },
      disagreement: { count: 4, rate: 0.04, failureThreshold: 0.05 },
      failures: [],
    });
    expect(validateJudgeCalibrationReport(result.report, schema)).toEqual([]);

    const thresholdInput = buildInput({ mismatchCount: 5 });
    const thresholdResult = evaluate(thresholdInput);
    expect(thresholdResult.report).toMatchObject({
      status: 'failed',
      claimEligible: false,
      disagreement: { count: 5, rate: 0.05 },
      failures: expect.arrayContaining(['judge_disagreement_threshold']),
    });
  });

  it('fingerprints label projections independently of private file ordering', () => {
    const input = buildInput({ mismatchCount: 0 });
    const reversed = [...input.examples].reverse();

    expect(digestCalibrationProjection(reversed, 'human')).toBe(input.custody.humanLabelsSha256);
    expect(digestCalibrationProjection(reversed, 'judge')).toBe(
      input.custody.judgePredictionsSha256,
    );
  });

  it('keeps human ambiguity separate and counts judge ambiguity as disagreement', () => {
    const input = buildInput({ mismatchCount: 0 });
    input.examples.push(
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `cal-${(100 + index).toString(16).padStart(16, '0')}`,
        family: 'memory',
        humanLabel: 'ambiguous',
        judgeLabel: 'ambiguous',
      })),
    );
    input.examples[0].judgeLabel = 'ambiguous';
    refreshProjectionDigests(input);
    const result = evaluate(input);

    expect(result.report.counts).toMatchObject({
      total: 110,
      resolvedHuman: 100,
      humanAmbiguous: 10,
      judgeAmbiguousOnResolved: 1,
    });
    expect(result.report.disagreement).toMatchObject({ count: 1, rate: 0.01 });
    expect(result.report.claimEligible).toBe(true);
  });

  it('rejects all-abstain judges and imbalanced human classes', () => {
    const abstaining = buildInput({ mismatchCount: 0 });
    abstaining.examples.forEach((example) => {
      example.judgeLabel = 'ambiguous';
    });
    refreshProjectionDigests(abstaining);
    expect(evaluate(abstaining).report).toMatchObject({
      claimEligible: false,
      disagreement: { count: 100, rate: 1 },
      failures: expect.arrayContaining(['judge_disagreement_threshold']),
    });

    const imbalanced = buildInput({ mismatchCount: 0 });
    imbalanced.examples.forEach((example, index) => {
      example.humanLabel = index < 95 ? 'pass' : 'fail';
      example.judgeLabel = example.humanLabel;
    });
    refreshProjectionDigests(imbalanced);
    expect(evaluate(imbalanced).report.failures).toContain('class_imbalance');
  });

  it('rejects duplicate examples, undeclared families, invalid custody, and zero configs', () => {
    const input = buildInput({ mismatchCount: 0 });
    input.examples[1].id = input.examples[0].id;
    input.examples[2].family = 'undeclared-shadow-family';
    input.custody.ownerId = input.candidate.maintainerIds[0];
    input.evaluator.promptSha256 = '0'.repeat(64);
    const result = evaluate(input);

    expect(result.contractFailures).toEqual(
      expect.arrayContaining([
        'input.examples[1].id: must be unique',
        'input.examples[2].family: must be declared by requiredFamilies',
      ]),
    );
    expect(result.report).toMatchObject({
      claimEligible: false,
      custodyValid: false,
      failures: expect.arrayContaining([
        'invalid_contract',
        'invalid_configuration',
        'invalid_custody',
      ]),
    });
  });

  it('rejects post-hoc label edits and non-strict freeze chronology', () => {
    const digestMismatch = buildInput({ mismatchCount: 0 });
    digestMismatch.examples[0].humanLabel = 'fail';
    expect(evaluate(digestMismatch).report).toMatchObject({
      custodyValid: false,
      claimEligible: false,
      failures: expect.arrayContaining(['invalid_custody']),
    });

    const predictionDigestMismatch = buildInput({ mismatchCount: 0 });
    predictionDigestMismatch.examples[0].judgeLabel = 'ambiguous';
    expect(evaluate(predictionDigestMismatch).report.failures).toContain('invalid_custody');

    const equalLabelFreeze = buildInput({ mismatchCount: 0 });
    equalLabelFreeze.custody.humanLabelsFrozenAt =
      equalLabelFreeze.custody.judgePredictionsFrozenAt;
    expect(evaluate(equalLabelFreeze).report.failures).toContain('invalid_custody');

    const labelsFrozenAfterPredictions = buildInput({ mismatchCount: 0 });
    labelsFrozenAfterPredictions.custody.humanLabelsFrozenAt = '2025-01-02T00:00:01.000Z';
    expect(evaluate(labelsFrozenAfterPredictions).report.failures).toContain('invalid_custody');

    const equalConfigFreeze = buildInput({ mismatchCount: 0 });
    equalConfigFreeze.frozenAt = equalConfigFreeze.custody.judgePredictionsFrozenAt;
    expect(evaluate(equalConfigFreeze).report.failures).toContain('invalid_custody');

    const equalRelease = buildInput({ mismatchCount: 0 });
    equalRelease.custody.humanLabelsReleasedAt = equalRelease.custody.judgePredictionsFrozenAt;
    expect(evaluate(equalRelease).report.failures).toContain('invalid_custody');
  });

  it('bounds identifiers, maintainers, families, and private examples', () => {
    const input = buildInput({ mismatchCount: 0 });
    input.candidate.id = 'a'.repeat(129);
    input.candidate.maintainerIds = Array.from({ length: 51 }, (_, index) => `maintainer-${index}`);
    input.requiredFamilies = Array.from({ length: 101 }, (_, index) => `family-${index}`);
    input.examples = Array.from({ length: 10001 }, (_, index) => ({
      id: `cal-${index.toString(16).padStart(16, '0')}`,
      family: 'family-0',
      humanLabel: index % 2 === 0 ? 'pass' : 'fail',
      judgeLabel: index % 2 === 0 ? 'pass' : 'fail',
    }));

    expect(validateJudgeCalibrationInput(input, schema)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('input.candidate.id: must NOT have more than 128 characters'),
        expect.stringContaining('input.candidate.maintainerIds: must NOT have more than 50 items'),
        expect.stringContaining('input.requiredFamilies: must NOT have more than 100 items'),
        expect.stringContaining('input.examples: must NOT have more than 10000 items'),
      ]),
    );
  });

  it('identifies deterministic structural evaluators without requiring LLM calibration', () => {
    const input = {
      $schema:
        'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/judge-calibration.schema.json',
      kind: 'judge_calibration_input',
      schemaVersion: '1.0.0',
      id: 'structural-evaluator-declaration',
      frozenAt: '2025-01-01T00:00:00.000Z',
      evaluator: {
        kind: 'deterministic_structural',
        id: 'structural-rubric-engine',
        implementationSha256: 'f'.repeat(64),
        rubricSha256: '1'.repeat(64),
      },
      requiredFamilies: ['structural_state'],
      examples: [],
    };
    const result = evaluateJudgeCalibration(input, {
      generatedAt: '2025-01-05T00:00:00.000Z',
      inputSha256: '2'.repeat(64),
      schema,
    });

    expect(result).toMatchObject({
      contractFailures: [],
      reportFailures: [],
      report: {
        status: 'not_required',
        claimEligible: true,
        custodyValid: true,
        counts: { total: 0, resolvedHuman: 0 },
        failures: [],
      },
    });
  });

  it('projects only aggregate counts and frozen fingerprints', () => {
    const result = evaluate(buildInput());
    const serialized = JSON.stringify(result.report);

    expect(serialized).not.toContain('cal-0000000000000000');
    expect(serialized).not.toContain('calibration-owner');
    expect(serialized).not.toContain('candidate-maintainer');
    expect(serialized).not.toContain('private-model-identity');
    expect(serialized).not.toContain('humanLabel');
    expect(serialized).not.toContain('judgeLabel');
  });

  it('runs the private, keyless CLI and fails closed without exposing its input path', () => {
    const cliProject = createPrivateEvaluationCliProject(projectRoot);
    const directory = fs.mkdtempSync(path.join(cliProject.privateRoot, 'judge-calibration-test-'));
    const inputPath = path.join(directory, 'labels.json');
    const outputRelativePath = path.join(
      '.artifacts',
      `judge-calibration-test-${process.pid}.json`,
    );
    const outputPath = path.join(cliProject.projectRoot, outputRelativePath);
    try {
      fs.writeFileSync(inputPath, `${JSON.stringify(buildInput())}\n`, { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        [
          cliProject.scriptPath('judge-calibration.js'),
          '--input',
          inputPath,
          '--output',
          outputRelativePath,
        ],
        { cwd: cliProject.projectRoot, env: cliProject.spawnEnv, encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('status=passed');
      expect(result.stdout).not.toContain(inputPath);
      expect(result.stderr).toBe('');
      const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      expect(report.claimEligible).toBe(true);
      expect(JSON.stringify(report)).not.toContain(inputPath);
    } finally {
      cliProject.cleanup();
    }
  });
});
