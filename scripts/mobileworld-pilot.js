#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');

const label = 'mobileworld-pilot';
const expectedRevision = '8ae506487bf87785292d6cad101c49955d704d39';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);
process.env.RUN_E2E_AGENT_EVAL = '1';
process.env.RUN_MOBILEWORLD_PILOT = '1';

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) exitWithStatus(status);

const upstreamDir = path.resolve(
  process.env.MOBILEWORLD_UPSTREAM_DIR ||
    path.join(projectRoot, '.private/evals/upstream/mobileworld'),
);
const device = process.env.MOBILEWORLD_DEVICE?.trim() || 'emulator-5554';
const uv = process.env.MOBILEWORLD_UV?.trim() || 'uv';
const taskName = process.env.MOBILEWORLD_TASK?.trim() || '';
if (taskName && !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(taskName)) {
  exitWithStatus(fail(label, 'MOBILEWORLD_TASK must be one canonical task class name.'));
}

for (const [description, candidate] of [
  ['pinned MobileWorld checkout', path.join(upstreamDir, 'src/mobile_world/core/runner.py')],
  ['MobileWorld Python environment', path.join(upstreamDir, '.venv/bin/python')],
  ['Kavi MobileWorld agent', path.join(projectRoot, 'benchmarks/mobileworld/kavi_agent.py')],
]) {
  if (!fs.existsSync(candidate)) {
    exitWithStatus(
      fail(
        label,
        `${description} is missing at ${candidate}. See benchmarks/mobileworld/README.md.`,
      ),
    );
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    env: process.env,
  });
}

const revision = run('git', ['-C', upstreamDir, 'rev-parse', 'HEAD']);
if (revision.status !== 0 || revision.stdout.trim() !== expectedRevision) {
  exitWithStatus(
    fail(
      label,
      `MobileWorld must be pinned to ${expectedRevision}; got ${revision.stdout.trim() || 'unknown'}.`,
    ),
  );
}
const upstreamStatus = run('git', ['-C', upstreamDir, 'status', '--porcelain']);
if (upstreamStatus.status !== 0 || upstreamStatus.stdout.trim()) {
  exitWithStatus(fail(label, 'The pinned MobileWorld checkout must be clean.'));
}
const submodules = run('git', ['-C', upstreamDir, 'submodule', 'status', '--recursive']);
if (
  submodules.status !== 0 ||
  submodules.stdout
    .split('\n')
    .filter(Boolean)
    .some((line) => line.startsWith('-') || line.startsWith('+') || line.startsWith('U'))
) {
  exitWithStatus(
    fail(label, 'MobileWorld submodules are not pinned and initialized. Run the README setup.'),
  );
}
if (run(uv, ['--version']).status !== 0) {
  exitWithStatus(fail(label, `uv is unavailable as ${uv}.`));
}
const adb = run('adb', ['devices']);
if (
  adb.status !== 0 ||
  !adb.stdout.split('\n').some((line) => line.startsWith(`${device}\tdevice`))
) {
  exitWithStatus(fail(label, `Android device ${device} is not healthy in adb devices.`));
}
const awHost = process.env.MOBILEWORLD_AW_HOST?.trim() || 'http://127.0.0.1:6800';
const health = run('curl', ['--fail', '--silent', '--show-error', `${awHost}/health`]);
if (health.status !== 0) {
  exitWithStatus(
    fail(
      label,
      `MobileWorld server is unavailable at ${awHost}. Start it with: cd ${upstreamDir} && uv run mobile-world server --host 127.0.0.1 --port 6800`,
    ),
  );
}

const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
const outputDir = path.resolve(
  process.env.MOBILEWORLD_OUTPUT_DIR ||
    path.join(
      projectRoot,
      '.private/evals/runs/mobileworld',
      `${taskName ? `task-${taskName}` : 'device-pilot'}-${timestamp}`,
    ),
);
if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
  exitWithStatus(fail(label, `Output directory must be fresh: ${outputDir}`));
}
fs.mkdirSync(path.dirname(outputDir), { recursive: true });

process.env.MOBILEWORLD_AW_HOST = awHost;
process.env.MOBILEWORLD_DEVICE = device;
process.env.MOBILEWORLD_OUTPUT_DIR = outputDir;
process.env.MOBILEWORLD_UPSTREAM_DIR = upstreamDir;
process.env.MOBILEWORLD_UV = uv;

console.log(
  `[mobileworld-pilot] device=${device} mode=${taskName || 'ad-hoc'} output=${outputDir}`,
);
status = runJest({
  projectRoot,
  env: process.env,
  testPaths: ['__tests__/acceptance/mobileworldLivePilot.test.ts'],
});
if (status !== 0) {
  exitWithStatus(
    fail(label, `Live device pilot failed. Private evidence remains at ${outputDir}.`),
  );
}

console.log(`[mobileworld-pilot] Live device pilot passed. Evidence: ${outputDir}`);
exitWithStatus(0);
