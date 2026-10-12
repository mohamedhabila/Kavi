#!/usr/bin/env node

// LongMemEval live benchmark: each question is asked through the app's own conversation
// path after its history, and LongMemEval's reference judge scores the answer.

const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');

const label = 'longmemeval';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);

let status = requireE2eAgentEvalEnv(label);
if (status !== 0) {
  exitWithStatus(status);
}
if (!process.env.LONGMEMEVAL_DATA?.trim()) {
  exitWithStatus(
    fail(
      label,
      'Set LONGMEMEVAL_DATA to a LongMemEval file (longmemeval_oracle.json or longmemeval_s_cleaned.json from huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).',
    ),
  );
}

status = runJest({
  projectRoot,
  testPaths: ['__tests__/acceptance/longMemEvalLive.test.ts'],
  // LongMemEval's dates carry no zone: the run reads them, and runs its clock, in UTC.
  env: { ...process.env, RUN_LONGMEMEVAL: '1', TZ: 'UTC' },
});
exitWithStatus(status);
