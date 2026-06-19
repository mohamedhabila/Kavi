const fs = require('fs');
const { spawnSync } = require('child_process');
const { buildOnDeviceBenchmarkConfig } = require('./config');
const { probeDevice } = require('./deviceProbe');
const { buildScenarioPlan } = require('./scenarios');
const {
  buildCompletedReport,
  buildFailedReport,
  buildSkippedReport,
  writeJson,
} = require('./report');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolvePreflight(config, probe = probeDevice) {
  if (!config.enabled) {
    return { ok: false, skipped: true, reason: 'benchmark_not_enabled' };
  }
  if (!config.driverCommand) {
    return { ok: false, skipped: true, reason: 'driver_command_missing' };
  }
  if (!config.modelId) {
    return { ok: false, skipped: true, reason: 'model_id_missing' };
  }

  const deviceProbe = probe(config);
  if (!deviceProbe.ok) {
    return {
      ok: false,
      skipped: true,
      reason: deviceProbe.reason || 'device_unavailable',
      detail: deviceProbe,
    };
  }

  return {
    ok: true,
    device: deviceProbe,
  };
}

function runDriver(config, plan) {
  writeJson(config.planPath, plan);
  if (fs.existsSync(config.driverReportPath)) {
    fs.unlinkSync(config.driverReportPath);
  }

  const result = spawnSync(
    config.driverCommand.command,
    [...config.driverCommand.args, '--plan', config.planPath, '--report', config.driverReportPath],
    {
      cwd: config.projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_ON_DEVICE_PLAN_PATH: config.planPath,
        E2E_ON_DEVICE_DRIVER_REPORT_PATH: config.driverReportPath,
      },
    },
  );

  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      report: buildFailedReport(config, 'driver_failed', { exitStatus: result.status ?? 1 }),
    };
  }
  if (!fs.existsSync(config.driverReportPath)) {
    return {
      ok: false,
      report: buildFailedReport(config, 'driver_report_missing'),
    };
  }

  try {
    return {
      ok: true,
      driverReport: readJsonFile(config.driverReportPath),
    };
  } catch (error) {
    return {
      ok: false,
      report: buildFailedReport(config, 'driver_report_invalid_json', String(error)),
    };
  }
}

function runOnDeviceBenchmark(options) {
  const config = buildOnDeviceBenchmarkConfig(options);
  const preflight = resolvePreflight(config, options.probeDevice);
  if (!preflight.ok) {
    const report = buildSkippedReport(config, preflight.reason, preflight.detail);
    writeJson(config.reportPath, report);
    return { exitStatus: 0, report, config };
  }

  const plan = buildScenarioPlan({
    ...config,
    device: {
      ...config.device,
      deviceId: preflight.device.deviceId,
    },
  });
  const driverResult = runDriver(config, plan);
  if (!driverResult.ok) {
    writeJson(config.reportPath, driverResult.report);
    return { exitStatus: 1, report: driverResult.report, config };
  }

  try {
    const report = buildCompletedReport(config, plan, driverResult.driverReport);
    writeJson(config.reportPath, report);
    return { exitStatus: report.status === 'passed' ? 0 : 1, report, config };
  } catch (error) {
    const report = buildFailedReport(config, 'driver_report_contract_failed', String(error));
    writeJson(config.reportPath, report);
    return { exitStatus: 1, report, config };
  }
}

module.exports = {
  resolvePreflight,
  runDriver,
  runOnDeviceBenchmark,
};
