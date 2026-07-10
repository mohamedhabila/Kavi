import { coordinateExecutionRecovery } from './recoveryCoordinator';
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
  return coordinateExecutionRecovery({ queryResult }, ports);
}
