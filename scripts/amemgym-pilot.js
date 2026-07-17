#!/usr/bin/env node

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

const label = 'amemgym-pilot';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);
process.env.RUN_E2E_AGENT_EVAL = '1';
process.env.RUN_AMEMGYM_PILOT = '1';

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) exitWithStatus(status);

if (!process.env.OPENAI_API_KEY?.trim() && !process.env.AMEMGYM_SIMULATOR_API_KEY?.trim()) {
  exitWithStatus(fail(label, 'OPENAI_API_KEY is required by the AMemGym user simulator.'));
}

const upstreamDir = path.resolve(
  process.env.AMEMGYM_UPSTREAM_DIR || path.join(projectRoot, '.private/evals/upstream/amemgym'),
);
const dataFile = path.resolve(
  process.env.AMEMGYM_DATA_FILE ||
    path.join(projectRoot, '.private/evals/upstream/amemgym-data/v1.base/data.json'),
);
const python = path.resolve(
  process.env.AMEMGYM_PYTHON || path.join(upstreamDir, '.venv/bin/python'),
);

for (const [description, candidate] of [
  ['pinned AMemGym checkout', path.join(upstreamDir, 'src/amemgym/eval/overall.py')],
  ['pinned AMemGym dataset', dataFile],
  ['AMemGym private Python environment', python],
]) {
  if (!fs.existsSync(candidate)) {
    exitWithStatus(
      fail(label, `${description} is missing at ${candidate}. See benchmarks/amemgym/README.md.`),
    );
  }
}

const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
const outputDir = path.resolve(
  process.env.AMEMGYM_OUTPUT_DIR ||
    path.join(projectRoot, '.private/evals/runs/amemgym', `pilot-${timestamp}`),
);
fs.mkdirSync(path.dirname(outputDir), { recursive: true });

process.env.AMEMGYM_UPSTREAM_DIR = upstreamDir;
process.env.AMEMGYM_DATA_FILE = dataFile;
process.env.AMEMGYM_PYTHON = python;
process.env.AMEMGYM_OUTPUT_DIR = outputDir;
process.env.AMEMGYM_PILOT_MIN_ACCURACY =
  process.env.AMEMGYM_PILOT_MIN_ACCURACY?.trim() || String(2 / 3);
process.env.AMEMGYM_PILOT_PERIOD_INDICES =
  process.env.AMEMGYM_PILOT_PERIOD_INDICES?.trim() || '0,1,3';
process.env.AMEMGYM_SIMULATOR_BASE_URL =
  process.env.AMEMGYM_SIMULATOR_BASE_URL?.trim() || 'https://api.openai.com/v1';
process.env.AMEMGYM_SIMULATOR_MODEL = process.env.AMEMGYM_SIMULATOR_MODEL?.trim() || 'gpt-4.1';

console.log(`[amemgym-pilot] output=${outputDir}`);
status = runJest({
  projectRoot,
  env: process.env,
  testPaths: ['__tests__/acceptance/amemgymLivePilot.test.ts'],
});

if (status !== 0) {
  exitWithStatus(fail(label, `Live pilot failed. Private evidence remains at ${outputDir}.`));
}

console.log(`[amemgym-pilot] Live pilot passed. Evidence: ${outputDir}`);
exitWithStatus(0);
