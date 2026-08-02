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
      '__tests__/android/longHorizonExecutionService.test.ts',
      '__tests__/engine/agentControlGraphForegroundRunReservation.test.ts',
      '__tests__/engine/builtin-executor.wrappers.session-wait-resolution.test.ts',
      '__tests__/engine/builtin-executor.wrappers.session.test.ts',
      '__tests__/engine/builtin-session-prompt.test.ts',
      '__tests__/engine/codeExecutionTools.test.ts',
      '__tests__/engine/foregroundRunInterruptedResponseRecovery.test.ts',
      '__tests__/engine/delegatedWorkerSpawn.test.ts',
      '__tests__/engine/graphSessionBackgroundHandoff.test.ts',
      '__tests__/engine/longHorizonIterationBudget.test.ts',
      '__tests__/engine/loopDetection.repeat-detectors.test.ts',
      '__tests__/engine/loopDetection.semantic-progress.test.ts',
      '__tests__/engine/pendingAsyncOperations.test.ts',
      '__tests__/engine/toolCallLifecycle.codeExecutionDurableDispatch.test.ts',
      '__tests__/engine/toolCallLifecycle.sessionContext.test.ts',
      '__tests__/integration/externalToolRecoveryLifecycle.test.ts',
      '__tests__/integration/iosDurableRecoveryRestart.test.ts',
      '__tests__/services/androidDurableRecoveryLifecycle.test.ts',
      '__tests__/services/androidLongHorizonExecution.test.ts',
      '__tests__/services/androidLongHorizonRunCancellation.test.ts',
      '__tests__/services/compactionSummaryContinuity.test.ts',
      '__tests__/services/iosDurableRecoveryLifecycle.test.ts',
      '__tests__/services/schedulerEngine.test.ts',
      '__tests__/services/schedulerJobExecutorPersistenceDurability.test.ts',
      '__tests__/services/schedulerJobExecutorRecovery.test.ts',
      '__tests__/services/schedulerSuccessfulRunProcedureCommit.test.ts',
      '__tests__/services/schedulerWakeNotifications.test.ts',
      '__tests__/services/startupRecovery.transaction.test.ts',
      '__tests__/services/sub-agent.lifecycle.test.ts',
      '__tests__/services/subAgentAdaptiveHorizon.test.ts',
      '__tests__/services/subAgent-durability.recovery.test.ts',
      '__tests__/services/subAgentEffectFreeRestartRecovery.integration.test.ts',
      '__tests__/services/subAgentLifecycleRecovery.test.ts',
      '__tests__/services/subAgentLongHorizonLease.test.ts',
      '__tests__/services/subAgentRestartRecovery.test.ts',
      '__tests__/services/agents/sessionContextMessages.test.ts',
      '__tests__/services/agents/subAgentRunConfig.test.ts',
      '__tests__/screens/useForegroundRequest.test.tsx',
      '__tests__/store/chatConversationCompaction.test.ts',
      '__tests__/store/chatPersistenceProjectionCache.test.ts',
      '__tests__/store/restartAgentRunEffectRecovery.test.ts',
    ],
    failureMessage:
      'Long-task persistence or recovery invariants failed. Treat the affected lifecycle as release-blocking.',
    successMessage:
      'Long-task structural persistence and recovery invariants passed. Physical-device lifecycle evidence is still required.',
  }),
);
