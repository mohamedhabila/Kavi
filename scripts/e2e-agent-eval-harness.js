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

const label = 'e2e-agent-eval';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) {
  exitWithStatus(status);
}

const { reportPath, maxRetries } = configureE2eReportEnv(projectRoot);
console.log(`[e2e-agent-eval] report=${reportPath} maxScenarioRetries=${maxRetries}`);

status = runJest({
  projectRoot,
  testPaths: [
    '__tests__/acceptance/e2eAgentMetrics.test.ts',
    '__tests__/acceptance/e2eDelegationMetrics.test.ts',
  ],
});

const flushStatus = flushE2eReport(projectRoot, label);
if (flushStatus !== 0) {
  exitWithStatus(flushStatus);
}

if (status !== 0) {
  fail(label, 'E2E agent eval failed. See failures above.');
  exitWithStatus(status);
}

console.log('[e2e-agent-eval] E2E agent eval passed.');
exitWithStatus(0);
