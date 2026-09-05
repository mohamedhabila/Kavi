#!/usr/bin/env node
// Emits GitHub Actions error annotations for the failing Jest suites and tests
// found in a captured `npm run verify` log, so a red check names its cause even
// for readers who cannot open the job log. Annotation output is bounded: GitHub
// keeps at most ten error annotations per step, so the list is truncated
// deliberately and the truncation is announced rather than silent.

'use strict';

const fs = require('node:fs');

const MAX_ANNOTATIONS = 10;
const SUITE_LINE = /^FAIL\s+(\S+)/;
const TEST_LINE = /^\s+●\s+(.+?)\s*$/;
const ANSI_SEQUENCE = /\[[0-9;]*m/g;
const TEST_PATH_SEPARATOR = ' › ';

function collectFailures(logText) {
  const suites = new Set();
  const tests = new Set();
  for (const rawLine of logText.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_SEQUENCE, '');
    const suite = SUITE_LINE.exec(line);
    if (suite) {
      suites.add(suite[1]);
      continue;
    }
    const test = TEST_LINE.exec(line);
    if (test && test[1].includes(TEST_PATH_SEPARATOR) && !test[1].startsWith('Console')) {
      tests.add(test[1]);
    }
  }
  return { suites: [...suites], tests: [...tests] };
}

function escapeAnnotation(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function renderAnnotations({ suites, tests }) {
  if (suites.length === 0 && tests.length === 0) {
    return [
      '::error title=verify failed::No failing Jest suite was found in the log; the failure is in an earlier verify stage (lint, typecheck or a check:* script). Open the job log.',
    ];
  }
  const lines = [
    ...suites.map((suite) => `suite: ${suite}`),
    ...tests.map((test) => `test: ${test}`),
  ];
  const shown = lines.slice(0, MAX_ANNOTATIONS);
  const output = shown.map((line) => `::error title=Jest failure::${escapeAnnotation(line)}`);
  if (lines.length > shown.length) {
    output.push(
      `::warning title=Jest failures truncated::${lines.length - shown.length} more failing entries were not annotated; see the job log.`,
    );
  }
  return output;
}

function main(argv) {
  const logPath = argv[2];
  if (!logPath) {
    process.stderr.write('usage: annotate-verify-failures.js <verify.log>\n');
    return 2;
  }
  let logText;
  try {
    logText = fs.readFileSync(logPath, 'utf8');
  } catch (error) {
    process.stderr.write(`could not read ${logPath}: ${error.message}\n`);
    return 2;
  }
  for (const line of renderAnnotations(collectFailures(logText))) {
    process.stdout.write(`${line}\n`);
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { collectFailures, renderAnnotations };
