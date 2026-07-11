#!/usr/bin/env node

const path = require('path');
const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJestHarness,
} = require('./lib/harness');

const label = 'e2e-paired-assessment';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) exitWithStatus(status);

for (const name of ['E2E_PAIRED_SCENARIO_ID', 'E2E_PAIRED_RUN_ID', 'E2E_PAIRED_SEED']) {
  if (!process.env[name]?.trim()) {
    status = fail(label, `${name} is required.`);
    exitWithStatus(status);
  }
}

process.env.RUN_E2E_PAIRED_EVAL = '1';
process.env.E2E_PAIRED_REFERENCE_CONDITION =
  process.env.E2E_PAIRED_REFERENCE_CONDITION?.trim() || 'memory_off';
process.env.E2E_PAIRED_CANDIDATE_CONDITION =
  process.env.E2E_PAIRED_CANDIDATE_CONDITION?.trim() || 'production_auto';
process.env.E2E_PAIRED_RETENTION_ROOT =
  process.env.E2E_PAIRED_RETENTION_ROOT?.trim() ||
  path.join(projectRoot, '.private', 'evals', 'runs', 'e2e-paired');
process.env.E2E_SCENARIO_RUN_ID = process.env.E2E_PAIRED_RUN_ID.trim();

status = runJestHarness({
  projectRoot,
  label,
  testPaths: ['__tests__/acceptance/e2ePairedAssessmentCollect.test.ts'],
  failureMessage: 'Paired assessment failed; retained public evidence may contain failure details.',
  successMessage: `Paired evidence retained under ${process.env.E2E_PAIRED_RETENTION_ROOT}.`,
});
exitWithStatus(status);
