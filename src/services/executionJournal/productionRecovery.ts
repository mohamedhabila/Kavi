import { coordinateExecutionRecovery, digestExecutionRecoveryCommand } from './recoveryCoordinator';
import { getExecutionJournalDb } from './database';
import { readExecutionMonitorSchedule } from './monitorRecords';
import {
  createExecutionRecoveryControlStore,
  type ExecutionRecoveryControlStoreOptions,
} from './recoveryControlStore';
import {
  createExecutionExternalHandleReconciliationHandler,
  type CreateExecutionExternalHandleReconciliationHandlerOptions,
} from './externalHandleReconciliation';
import { createExecutionExternalHandleReconciliationStore } from './externalHandleReconciliationStore';
import type {
  ExecutionRecoveryCoordinatorOutcome,
  ExecutionRecoveryCoordinatorPorts,
} from './recoveryCoordinatorTypes';
import { queryExecutionRecovery, type ExecutionRecoveryGeneration } from './recoveryQuery';

export {
  listPersistedExternalRecoveryCandidates,
  readPersistedExternalRecoveryCandidate,
  type ListPersistedExternalRecoveryCandidatesInput,
  type ListPersistedExternalRecoveryCandidatesResult,
  type PersistedExternalRecoveryCandidate,
  type ReadPersistedExternalRecoveryCandidateResult,
} from './recoveryCandidates';

export interface ProductionExecutionRecoveryOptions {
  controlStore?: ExecutionRecoveryControlStoreOptions;
  externalHandleReconciliation?: CreateExecutionExternalHandleReconciliationHandlerOptions;
}

export interface CoordinatePersistedExecutionRecoveryInput {
  runId: string;
  expectedGeneration?: ExecutionRecoveryGeneration;
}

/** Production ports intentionally activate only the effect-safe external reconciliation command. */
export function createProductionExecutionRecoveryPorts(
  options: ProductionExecutionRecoveryOptions = {},
): ExecutionRecoveryCoordinatorPorts {
  const controlStore = createExecutionRecoveryControlStore(options.controlStore);
  const reconciliationStore = createExecutionExternalHandleReconciliationStore(
    options.controlStore,
  );
  return {
    queryRecovery: queryExecutionRecovery,
    readAuthority: controlStore.readAuthority,
    acquireDispatchFence: controlStore.acquireDispatchFence,
    handlers: {
      reconcileExternalHandles: createExecutionExternalHandleReconciliationHandler(
        reconciliationStore,
        options.externalHandleReconciliation,
      ),
    },
  };
}

/** Explicit production caller seam for headless or foreground recovery dispatch. */
export async function coordinatePersistedExecutionRecovery(
  input: CoordinatePersistedExecutionRecoveryInput,
  options: ProductionExecutionRecoveryOptions = {},
): Promise<ExecutionRecoveryCoordinatorOutcome> {
  const ports = createProductionExecutionRecoveryPorts(options);
  const queryResult = await ports.queryRecovery({
    runId: input.runId,
    ...(input.expectedGeneration ? { expectedGeneration: input.expectedGeneration } : {}),
  });
  if (
    queryResult.kind === 'recovery_plan' &&
    queryResult.command.kind === 'reconcile_external_handles'
  ) {
    const monitorSchedule = readExecutionMonitorSchedule(
      options.controlStore?.getDatabase?.() ?? getExecutionJournalDb(),
      queryResult.runId,
      queryResult.command.handleIds,
    );
    const now = options.controlStore?.clock?.() ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('execution_recovery_invalid_clock');
    }
    if (monitorSchedule.nextLegalCheckAt > now) {
      return {
        kind: 'deferred',
        reason: 'monitor_not_due',
        runId: queryResult.runId,
        commandKind: queryResult.command.kind,
        controlEpoch: queryResult.generation.controlEpoch,
        snapshotDigest: queryResult.generation.snapshotDigest,
        commandDigest: await digestExecutionRecoveryCommand(queryResult.command),
        dispatchId: null,
        dispatchDigest: null,
        fenceId: null,
        fenceDigest: null,
      };
    }
  }
  return coordinateExecutionRecovery({ queryResult }, ports);
}
