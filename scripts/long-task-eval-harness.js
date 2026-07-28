#!/usr/bin/env node

const { exitWithStatus, runJestHarness } = require('./lib/harness');

// This is a deterministic fault-injection gate for the persistence and recovery
// invariants that long-running mobile work depends on. It intentionally does not
// claim real wall-clock execution while an OS has suspended or killed the app;
// physical-device lifecycle runs remain a separate release requirement.
exitWithStatus(
  runJestHarness({
    label: 'long-task-structural-eval-harness',
    testPaths: [
      '__tests__/engine/foregroundRunInterruptedResponseRecovery.test.ts',
      '__tests__/integration/externalToolRecoveryLifecycle.test.ts',
      '__tests__/integration/iosDurableRecoveryRestart.test.ts',
      '__tests__/services/androidDurableRecoveryLifecycle.test.ts',
      '__tests__/services/iosDurableRecoveryLifecycle.test.ts',
      '__tests__/services/schedulerEngine.test.ts',
      '__tests__/services/schedulerJobExecutorPersistenceDurability.test.ts',
      '__tests__/services/schedulerJobExecutorRecovery.test.ts',
      '__tests__/services/schedulerSuccessfulRunProcedureCommit.test.ts',
      '__tests__/services/schedulerWakeNotifications.test.ts',
      '__tests__/services/subAgent-durability.recovery.test.ts',
      '__tests__/store/restartAgentRunEffectRecovery.test.ts',
    ],
    failureMessage:
      'Long-task persistence or recovery invariants failed. Treat the affected lifecycle as release-blocking.',
    successMessage:
      'Long-task structural persistence and recovery invariants passed. Physical-device lifecycle evidence is still required.',
  }),
);
