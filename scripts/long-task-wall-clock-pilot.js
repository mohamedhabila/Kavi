#!/usr/bin/env node

const path = require('path');
const { applyEnvFile } = require('./load-local-env');
const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');
const { resolveE2eProviderSpec } = require('./e2eReport/provider');

const label = 'long-task-wall-clock-pilot';
const projectRoot = resolveProjectRoot();

// Preserve shell and .env.local precedence, then fill any missing local-only
// evaluation variables from the repository's ignored .env file.
applyProjectLocalEnv(projectRoot);
applyEnvFile(path.join(projectRoot, '.env'));
process.env.RUN_E2E_AGENT_EVAL = '1';
process.env.RUN_LONG_TASK_WALL_CLOCK_PILOT = '1';
delete process.env.LONG_TASK_PILOT_WAIT_COUNT;
delete process.env.LONG_TASK_PILOT_WAIT_MS;
delete process.env.LONG_TASK_PILOT_INTER_TURN_DELAY_MS;

const providerSpec = resolveE2eProviderSpec(process.env);
if (providerSpec.key !== 'openrouter') {
  exitWithStatus(
    fail(
      label,
      `This pilot is intentionally pinned to OpenRouter; resolved E2E_PROVIDER=${providerSpec.key}.`,
    ),
  );
}

const environmentStatus = requireE2eAgentEvalEnv(label);
if (environmentStatus !== 0) {
  exitWithStatus(environmentStatus);
}

const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidencePath =
  process.env.LONG_TASK_EVIDENCE_PATH?.trim() ||
  path.join(projectRoot, '.private', 'evals', 'long-task-wall-clock', `${runStamp}.json`);
process.env.LONG_TASK_EVIDENCE_PATH = evidencePath;

console.log(
  `[${label}] provider=openrouter model=${process.env.E2E_OPENROUTER_MODEL} evidence=${evidencePath}`,
);
console.log(
  `[${label}] Expect about 18-22 minutes: 15 measured one-minute worker waits plus live provider and verification time.`,
);

const status = runJest({
  projectRoot,
  testPaths: ['__tests__/acceptance/longTaskWallClockLivePilot.test.ts'],
});

if (status !== 0) {
  exitWithStatus(
    fail(label, `Live long-task validation failed. Private evidence remains at ${evidencePath}.`),
  );
}

console.log(`[${label}] Live long-task validation passed. Evidence: ${evidencePath}`);
exitWithStatus(0);
