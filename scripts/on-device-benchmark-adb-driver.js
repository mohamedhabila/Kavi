#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProjectRoot } = require('./lib/harness');

const label = 'on-device-benchmark-adb-driver';

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
    throw new Error('Usage: on-device-benchmark-adb-driver.js --plan <path> --report <path>');
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
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.stderr?.trim() || result.stdout?.trim()}`,
    );
  }
  return result.stdout || '';
}

function runAndMirrorOutput(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  }
  return `${stdout}\n${stderr}`;
}

function resolveDeviceId(plan) {
  return plan.device?.deviceId || process.env.E2E_ON_DEVICE_DEVICE_ID || 'emulator-5554';
}

function resolveModelPath(plan, projectRoot, deviceId) {
  if (plan.model?.modelPath) {
    return plan.model.modelPath;
  }

  const appDataDir = run('adb', ['-s', deviceId, 'shell', 'run-as', plan.app.appId, 'pwd'], {
    cwd: projectRoot,
  }).trim();
  const relativeModelPath = run(
    'adb',
    [
      '-s',
      deviceId,
      'shell',
      'run-as',
      plan.app.appId,
      'find',
      'files/local-llm/models',
      '-maxdepth',
      '1',
      '-name',
      '*.litertlm',
    ],
    { cwd: projectRoot },
  )
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)[0];

  if (!relativeModelPath) {
    throw new Error('No installed .litertlm model found under files/local-llm/models.');
  }
  return `${appDataDir}/${relativeModelPath}`;
}

function installDebugArtifacts(projectRoot, deviceId) {
  run('./gradlew', [':app:assembleDebug', ':app:assembleDebugAndroidTest'], {
    cwd: path.join(projectRoot, 'android'),
    stdio: 'inherit',
  });
  run('adb', ['-s', deviceId, 'install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  run(
    'adb',
    ['-s', deviceId, 'install', '-r', 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );
}

function runInstrumentation(projectRoot, deviceId, plan, modelPath) {
  const scenarioIds = plan.scenarios.map((scenario) => scenario.id).join(',');
  const reportPath = 'files/on-device-driver-report.json';
  const output = runAndMirrorOutput(
    'adb',
    [
      '-s',
      deviceId,
      'shell',
      'am',
      'instrument',
      '-w',
      '-r',
      '-e',
      'class',
      'com.kavi.mobile.OnDeviceLlmBenchmarkTest,com.kavi.mobile.KaviLocalLlmModuleLifecycleTest',
      '-e',
      'benchmarkModelId',
      plan.model.modelId,
      '-e',
      'benchmarkModelPath',
      modelPath,
      '-e',
      'benchmarkReportPath',
      reportPath,
      '-e',
      'benchmarkBackend',
      plan.model.backend || 'cpu',
      '-e',
      'benchmarkRuntime',
      plan.model.runtime || 'litert-lm',
      '-e',
      'benchmarkModelSupportsTools',
      plan.model.capabilities?.tools ? 'true' : 'false',
      '-e',
      'benchmarkScenarioIds',
      scenarioIds,
      '-e',
      'benchmarkConversationTurns',
      String(plan.defaults?.conversationTurns || 20),
      `${plan.app.appId}.test/androidx.test.runner.AndroidJUnitRunner`,
    ],
    { cwd: projectRoot },
  );
  if (/FAILURES!!!|INSTRUMENTATION_STATUS_CODE:\s*-2|initializationError\(/u.test(output)) {
    throw new Error('Android instrumentation reported test failures.');
  }
  if (!/OK \(\d+ tests?\)/u.test(output)) {
    throw new Error('Android instrumentation did not report a successful JUnit summary.');
  }

  return reportPath;
}

function pullDriverReport(projectRoot, deviceId, appId, deviceReportPath, hostReportPath) {
  const report = run('adb', ['-s', deviceId, 'shell', 'run-as', appId, 'cat', deviceReportPath], {
    cwd: projectRoot,
  });
  fs.mkdirSync(path.dirname(hostReportPath), { recursive: true });
  fs.writeFileSync(hostReportPath, report, 'utf8');
}

function main() {
  const projectRoot = resolveProjectRoot();
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(args.planPath, 'utf8'));
  const deviceId = resolveDeviceId(plan);
  const modelPath = resolveModelPath(plan, projectRoot, deviceId);

  console.log(`[${label}] device=${deviceId} modelPath=${modelPath}`);
  installDebugArtifacts(projectRoot, deviceId);
  const deviceReportPath = runInstrumentation(projectRoot, deviceId, plan, modelPath);
  pullDriverReport(projectRoot, deviceId, plan.app.appId, deviceReportPath, args.reportPath);
  console.log(`[${label}] wrote ${args.reportPath}`);
}

try {
  main();
} catch (error) {
  console.error(`[${label}] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
