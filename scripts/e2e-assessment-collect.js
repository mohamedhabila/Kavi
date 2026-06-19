#!/usr/bin/env node

const {
  applyProjectLocalEnv,
  configureE2eReportEnv,
  exitWithStatus,
  fail,
  flushE2eReport,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');

const label = 'e2e-assessment-collect';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) {
  exitWithStatus(status);
}

const { reportPath, maxRetries } = configureE2eReportEnv(projectRoot, process.env, {
  collectMode: true,
});
console.log(`[e2e-assessment-collect] report=${reportPath} maxScenarioRetries=${maxRetries}`);

status = runJest({
  projectRoot,
  testPaths: ['__tests__/acceptance/e2eAgentAssessmentCollect.test.ts'],
});

const flushStatus = flushE2eReport(projectRoot, label);
if (flushStatus !== 0) {
  exitWithStatus(flushStatus);
}

if (status !== 0) {
  fail(label, 'Assessment collect harness failed.');
  exitWithStatus(status);
}

console.log(`[e2e-assessment-collect] Evidence report written to ${reportPath}`);
exitWithStatus(0);
