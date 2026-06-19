#!/usr/bin/env node

const { exitWithStatus, runJestHarness } = require('./lib/harness');

exitWithStatus(
  runJestHarness({
    label: 'memory-eval-harness',
    testPaths: ['__tests__/acceptance/memoryAcceptanceMetrics.test.ts'],
    failureMessage: 'Memory acceptance metrics below threshold. See failures above.',
    successMessage: 'Memory acceptance metrics passed.',
  }),
);
