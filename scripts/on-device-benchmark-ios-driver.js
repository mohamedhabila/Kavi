#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectRoot } = require('./lib/harness');

const label = 'on-device-benchmark-ios-driver';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      result.planPath = argv[index + 1];
      index += 1;
    } else if (arg === '--report') {
      result.reportPath = argv[index + 1];
      index += 1;
    }
  }
  if (!result.planPath || !result.reportPath) {
    throw new Error('Usage: on-device-benchmark-ios-driver.js --plan <path> --report <path>');
  }
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (options.mirrorOutput) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

function resolveDeviceId(plan) {
  return plan.device?.deviceId || process.env.E2E_ON_DEVICE_DEVICE_ID;
}

function assertUsableModelPath(plan) {
  const modelPath = plan.model?.modelPath;
  if (!modelPath) {
    throw new Error('E2E_ON_DEVICE_MODEL_PATH is required for iOS on-device benchmarks.');
  }
  let stat;
  try {
    stat = fs.statSync(modelPath);
  } catch (_error) {
    throw new Error(`iOS benchmark model path is not readable: ${modelPath}`);
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`iOS benchmark model path is not a non-empty file: ${modelPath}`);
  }
  return modelPath;
}

function setSimulatorEnv(deviceId, key, value) {
  run('xcrun', ['simctl', 'spawn', deviceId, 'launchctl', 'setenv', key, value]);
}

function unsetSimulatorEnv(deviceId, key) {
  run('xcrun', ['simctl', 'spawn', deviceId, 'launchctl', 'unsetenv', key]);
}

function runXcodeBenchmark(projectRoot, deviceId) {
  const packageRoot = path.join(projectRoot, 'ios', 'LocalPackages', 'LiteRTLM');
  const derivedDataPath = path.join(projectRoot, '.artifacts', 'xcode-ios-sim-package');
  run(
    'xcodebuild',
    [
      '-quiet',
      '-scheme',
      'LiteRTLM',
      '-destination',
      `id=${deviceId}`,
      '-derivedDataPath',
      derivedDataPath,
      '-packageAuthorizationProvider',
      'netrc',
      '-skipPackagePluginValidation',
      '-skipMacroValidation',
      '-jobs',
      '2',
      'test',
    ],
    { cwd: packageRoot, mirrorOutput: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function main() {
  const projectRoot = resolveProjectRoot();
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(args.planPath, 'utf8'));
  const deviceId = resolveDeviceId(plan);
  if (!deviceId) {
    throw new Error('E2E_ON_DEVICE_DEVICE_ID is required for iOS on-device benchmarks.');
  }
  const modelPath = assertUsableModelPath(plan);
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  if (fs.existsSync(args.reportPath)) {
    fs.unlinkSync(args.reportPath);
  }

  console.log(`[${label}] device=${deviceId} modelPath=${modelPath}`);
  const envKeys = [
    'LITERTLM_BENCHMARK_PLAN_PATH',
    'LITERTLM_BENCHMARK_REPORT_PATH',
  ];
  try {
    setSimulatorEnv(deviceId, 'LITERTLM_BENCHMARK_PLAN_PATH', path.resolve(args.planPath));
    setSimulatorEnv(deviceId, 'LITERTLM_BENCHMARK_REPORT_PATH', path.resolve(args.reportPath));
    runXcodeBenchmark(projectRoot, deviceId);
  } finally {
    envKeys.forEach((key) => {
      try {
        unsetSimulatorEnv(deviceId, key);
      } catch (_) {
      }
    });
  }

  if (!fs.existsSync(args.reportPath)) {
    throw new Error(`iOS benchmark did not write a driver report: ${args.reportPath}`);
  }
  console.log(`[${label}] wrote ${args.reportPath}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[${label}] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

module.exports = {
  assertUsableModelPath,
  parseArgs,
  resolveDeviceId,
};
