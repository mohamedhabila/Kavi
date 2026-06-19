const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { applyLocalEnv } = require('../load-local-env');
const { readFirstEnvValue, resolveE2eProviderSpec } = require('../e2eReport/provider');

function resolveProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function platformCommand(commandName) {
  return process.platform === 'win32' ? `${commandName}.cmd` : commandName;
}

function exitWithStatus(status) {
  process.exit(status ?? 1);
}

function fail(label, message) {
  console.error(`[${label}] ${message}`);
  return 1;
}

function runJest(options) {
  const projectRoot = options.projectRoot || resolveProjectRoot();
  const result = spawnSync(
    platformCommand('npx'),
    ['jest', '--runInBand', '--colors', ...options.testPaths],
    {
      cwd: projectRoot,
      stdio: options.stdio || 'inherit',
      env: options.env || process.env,
    },
  );
  return result.status ?? 1;
}

function runJestHarness(options) {
  const status = runJest(options);
  if (status !== 0) {
    console.error(`[${options.label}] ${options.failureMessage}`);
    return status;
  }

  console.log(`[${options.label}] ${options.successMessage}`);
  return 0;
}

function applyProjectLocalEnv(projectRoot = resolveProjectRoot()) {
  applyLocalEnv(projectRoot);
}

function requireE2eAgentEvalEnv(label, env = process.env) {
  if (env.RUN_E2E_AGENT_EVAL !== '1') {
    return fail(
      label,
      'Set RUN_E2E_AGENT_EVAL=1 in .env.local or your shell. See docs/agent-quality-roadmap.md',
    );
  }

  const providerSpec = resolveE2eProviderSpec(env);
  if (!readFirstEnvValue(env, providerSpec.apiKeyEnv)) {
    return fail(
      label,
      `${providerSpec.apiKeyEnv.join(' or ')} is missing. Set E2E_PROVIDER=${providerSpec.key} with matching credentials in .env.local.`,
    );
  }

  if (!providerSpec.defaultModel && !readFirstEnvValue(env, providerSpec.modelEnv)) {
    return fail(
      label,
      `${providerSpec.modelEnv.join(' or ')} is missing for E2E_PROVIDER=${providerSpec.key}.`,
    );
  }

  if (!providerSpec.defaultBaseUrl && !readFirstEnvValue(env, providerSpec.baseUrlEnv)) {
    return fail(
      label,
      `${providerSpec.baseUrlEnv.join(' or ')} is missing for E2E_PROVIDER=${providerSpec.key}.`,
    );
  }

  return 0;
}

function configureE2eReportEnv(projectRoot, env = process.env, options = {}) {
  const reportPath =
    env.E2E_REPORT_PATH?.trim() || path.join(projectRoot, '.artifacts', 'e2e-agent-report.json');
  env.E2E_REPORT_PATH = reportPath;
  env.E2E_REPORT_PARTIAL_PATH = `${reportPath}.partial.json`;
  if (fs.existsSync(env.E2E_REPORT_PARTIAL_PATH)) {
    fs.unlinkSync(env.E2E_REPORT_PARTIAL_PATH);
  }

  const maxRetries = env.E2E_MAX_SCENARIO_RETRIES?.trim() ?? '0';
  env.E2E_MAX_SCENARIO_RETRIES = maxRetries;
  if (options.collectMode) {
    env.E2E_COLLECT_MODE = '1';
  }

  return { reportPath, maxRetries };
}

function flushE2eReport(projectRoot, label, env = process.env) {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, 'scripts/e2e-flush-run-report.js')],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env,
    },
  );

  if (result.status !== 0) {
    console.error(`[${label}] Failed to flush E2E JSON report.`);
    return result.status ?? 1;
  }

  return 0;
}

module.exports = {
  applyProjectLocalEnv,
  configureE2eReportEnv,
  exitWithStatus,
  fail,
  flushE2eReport,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
  runJestHarness,
};
