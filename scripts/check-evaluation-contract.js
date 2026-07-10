const path = require('path');

const { checkEvaluationContract } = require('./lib/evaluationContract');

const projectRoot = path.resolve(__dirname, '..');
const failures = checkEvaluationContract(projectRoot);

if (failures.length > 0) {
  console.error('[check-evaluation-contract] Evaluation contract validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('[check-evaluation-contract] Canonical evaluation schema and contract are valid.');
}
