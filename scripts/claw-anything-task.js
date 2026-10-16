#!/usr/bin/env node

// Claw-Anything: runs one benchmark task through Kavi. The Python adapter
// (benchmarks/claw_anything/kavi_agent.py) starts the task's mock services and dispatcher,
// writes the task spec, and calls this once per trial with CLAW_ANYTHING_SPEC and
// CLAW_ANYTHING_DISPATCH_TOKEN set.

const fs = require('fs');

const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');

const label = 'claw-anything-task';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);
process.env.RUN_E2E_AGENT_EVAL = '1';

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) exitWithStatus(status);

const specPath = process.env.CLAW_ANYTHING_SPEC?.trim();
if (!specPath || !fs.existsSync(specPath)) {
  exitWithStatus(fail(label, 'Set CLAW_ANYTHING_SPEC to the task spec the adapter wrote.'));
}
if (!process.env.CLAW_ANYTHING_DISPATCH_TOKEN?.trim()) {
  exitWithStatus(fail(label, 'CLAW_ANYTHING_DISPATCH_TOKEN is not set.'));
}

status = runJest({
  projectRoot,
  testPaths: ['__tests__/acceptance/clawAnythingLive.test.ts'],
  // The task's day is a UTC date, and the mock services freeze "now" at its noon, UTC.
  env: { ...process.env, RUN_CLAW_ANYTHING: '1', TZ: 'UTC' },
});
exitWithStatus(status);
