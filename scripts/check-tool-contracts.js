#!/usr/bin/env node

const { exitWithStatus, runJestHarness } = require('./lib/harness');

exitWithStatus(
  runJestHarness({
    label: 'check-tool-contracts',
    testPaths: ['__tests__/scripts/checkToolContracts.harness.test.ts'],
    failureMessage: 'Builtin tool contract coverage below threshold.',
    successMessage: 'All registered tools have explicit contract.capabilities.',
  }),
);
