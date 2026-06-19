#!/usr/bin/env node

const { exitWithStatus, runJestHarness } = require('./lib/harness');

exitWithStatus(
  runJestHarness({
    label: 'agent-eval-harness',
    testPaths: [
      '__tests__/acceptance/agentAcceptanceMetrics.test.ts',
      '__tests__/acceptance/acceptanceMetricsEvaluators.test.ts',
      '__tests__/acceptance/tokenEfficiencyMetrics.test.ts',
      '__tests__/acceptance/goalCapabilityDiscoveryMetrics.test.ts',
      '__tests__/acceptance/toolCatalogDiscoveryMetrics.test.ts',
      '__tests__/acceptance/sessionToolActivationMetrics.test.ts',
      '__tests__/acceptance/delegationMetrics.test.ts',
    ],
    failureMessage: 'Agent acceptance metrics below threshold. See failures above.',
    successMessage: 'Agent acceptance metrics passed.',
  }),
);
