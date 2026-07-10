const path = require('path');

const { checkEvaluationContract } = require('./lib/evaluationContract');
const { checkEvaluationCasePack } = require('./lib/evaluationCasePack');
const { checkPublicKlaeGovernance } = require('./lib/klaePrivateGovernance');

const projectRoot = path.resolve(__dirname, '..');
const failures = [
  ...checkEvaluationContract(projectRoot),
  ...checkEvaluationCasePack(projectRoot),
  ...checkPublicKlaeGovernance(projectRoot),
];

if (failures.length > 0) {
  console.error('[check-evaluation-contract] Evaluation contract validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    '[check-evaluation-contract] Canonical evaluation schema, contract, and public case pack are valid. The KLAE private-governance schema and metadata-only registry template are valid.',
  );
}
