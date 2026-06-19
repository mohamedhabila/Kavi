#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Maintainer gate: structural acceptance + live provider E2E (opt-in, keyless CI safe)
// ---------------------------------------------------------------------------

const { spawnSync } = require('child_process');
const path = require('path');
const { applyLocalEnv } = require('./load-local-env');
const { requireE2eAgentEvalEnv } = require('./lib/harness');

const projectRoot = path.resolve(__dirname, '..');
applyLocalEnv(projectRoot);

function fail(message) {
  console.error(`[verify-strict:e2e] ${message}`);
  process.exit(1);
}

function runNpmScript(scriptName) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, ['run', scriptName], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

if (process.env.RUN_E2E_AGENT_EVAL !== '1') {
  fail('Set RUN_E2E_AGENT_EVAL=1 in .env.local or your shell. See docs/testing.md');
}

const envStatus = requireE2eAgentEvalEnv('verify-strict:e2e');
if (envStatus !== 0) {
  process.exit(envStatus);
}

console.log('[verify-strict:e2e] Running verify:strict (structural acceptance metrics)...');
const strictStatus = runNpmScript('verify:strict');
if (strictStatus !== 0) {
  process.exit(strictStatus);
}

console.log('[verify-strict:e2e] Running eval:e2e (live provider agent scenarios)...');
const e2eStatus = runNpmScript('eval:e2e');
if (e2eStatus !== 0) {
  process.exit(e2eStatus);
}

console.log('[verify-strict:e2e] Maintainer gate passed.');
process.exit(0);
