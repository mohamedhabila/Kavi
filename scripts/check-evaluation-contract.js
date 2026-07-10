const path = require('path');

const { checkEvaluationContract } = require('./lib/evaluationContract');
const { checkEvaluationCasePack } = require('./lib/evaluationCasePack');
const {
  checkPublicKlaeGovernance,
  validatePrivateKlaeRelease,
} = require('./lib/klaePrivateGovernance');
const { checkPublicJudgeCalibrationContract } = require('./lib/judgeCalibration');
const { checkPublicEvaluationStatisticsContract } = require('./lib/evaluationStatisticsContract');
const { checkPublicIntentFrameContract } = require('./lib/intentFrameContract');
const { checkBenchmarkProvenance } = require('./lib/benchmarkProvenance');

const RELEASE_OPTIONS = Object.freeze({
  '--registry': 'registryPath',
  '--registry-sha': 'registrySha256',
  '--candidate-id': 'candidateId',
  '--baseline-id': 'baselineId',
  '--app-sha': 'appCommitSha',
  '--configuration-sha': 'configurationSha256',
  '--prompt-sha': 'promptSha256',
});

function parseReleaseArguments(argv) {
  if (argv.length === 0) return { enabled: false, failures: [] };
  const failures = [];
  if (argv[0] !== '--private-release') {
    return { enabled: false, failures: ['arguments: expected --private-release'] };
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    const field = RELEASE_OPTIONS[option];
    const value = argv[index + 1];
    if (!field) {
      failures.push(`arguments: unknown option ${option ?? '<missing>'}`);
      continue;
    }
    if (typeof value !== 'string' || value.startsWith('--')) {
      failures.push(`arguments: ${option} requires one value`);
      index -= 1;
      continue;
    }
    if (Object.hasOwn(values, field)) {
      failures.push(`arguments: ${option} must be provided once`);
    }
    values[field] = value;
  }
  for (const [option, field] of Object.entries(RELEASE_OPTIONS)) {
    if (!Object.hasOwn(values, field)) failures.push(`arguments: ${option} is required`);
  }
  return {
    enabled: true,
    failures,
    registryPath: values.registryPath,
    expected: values,
  };
}

const projectRoot = path.resolve(__dirname, '..');
const release = parseReleaseArguments(process.argv.slice(2));
const failures = [
  ...checkEvaluationContract(projectRoot),
  ...checkEvaluationCasePack(projectRoot),
  ...checkPublicKlaeGovernance(projectRoot),
  ...checkPublicJudgeCalibrationContract(projectRoot),
  ...checkPublicEvaluationStatisticsContract(projectRoot),
  ...checkPublicIntentFrameContract(projectRoot),
  ...checkBenchmarkProvenance(projectRoot),
  ...release.failures,
];
if (release.enabled && release.failures.length === 0) {
  failures.push(
    ...validatePrivateKlaeRelease({
      projectRoot,
      registryPath: release.registryPath,
      expected: release.expected,
    }),
  );
}

if (failures.length > 0) {
  console.error('[check-evaluation-contract] Evaluation contract validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  const suffix = release.enabled
    ? ' The frozen 40/40/100+ private KLAE release packs and custody registry are valid.'
    : ' The KLAE governance, judge calibration, deterministic statistics, intent-frame contract, and enabled benchmark provenance are valid.';
  console.log(
    `[check-evaluation-contract] Canonical evaluation schema, contract, and public case pack are valid.${suffix}`,
  );
}
