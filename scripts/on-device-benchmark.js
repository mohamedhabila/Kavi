#!/usr/bin/env node

const { applyProjectLocalEnv, exitWithStatus, resolveProjectRoot } = require('./lib/harness');
const { runOnDeviceBenchmark } = require('./onDeviceBenchmark/runner');

const label = 'on-device-benchmark';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);

const result = runOnDeviceBenchmark({
  projectRoot,
  env: process.env,
});

console.log(
  `[${label}] status=${result.report.status} report=${result.config.reportPath} reason=${result.report.reason || 'n/a'}`,
);
if (result.report.summary) {
  console.log(
    `[${label}] scenarios=${result.report.summary.passedCount}/${result.report.summary.scenarioCount} crashFree=${result.report.summary.crashFree}`,
  );
}

exitWithStatus(result.exitStatus);
