import type { ExecutionRecoveryCommand } from '../../src/services/executionJournal/recoveryPlanner';
import type { ExecutionRecoveryQueryResult } from '../../src/services/executionJournal/recoveryQuery';
import type {
  DispatchableExecutionRecoveryCommand,
  ExecutionRecoveryAuthorityResult,
  ExecutionRecoveryAuthoritySnapshot,
  ExecutionRecoveryCoordinatorPorts,
  ExecutionRecoveryDispatchFenceResult,
  ExecutionRecoveryHandlerResult,
  ExecutionRecoveryHandlers,
} from '../../src/services/executionJournal/recoveryCoordinatorTypes';

export const COORDINATOR_SNAPSHOT_DIGEST = 'a'.repeat(64);
export const COORDINATOR_AUTHORITY_DIGEST = 'b'.repeat(64);
export const COORDINATOR_DISPATCH_DIGEST = 'c'.repeat(64);
export const COORDINATOR_RECEIPT_DIGEST = 'd'.repeat(64);
export const COORDINATOR_STATE_DIGEST = 'e'.repeat(64);
export const COORDINATOR_FENCE_DIGEST = 'f'.repeat(64);

const POINTER = {
  runId: 'run-1',
  checkpointId: 'checkpoint-1',
  controlEpoch: 0,
  stateRefId: 'state-1',
  stateDigest: COORDINATOR_STATE_DIGEST,
} as const;

export const COORDINATOR_COMMANDS = {
  resume_model_step: {
    kind: 'resume_model_step',
    ...POINTER,
  },
  resume_persisted_tool_batch: {
    kind: 'resume_persisted_tool_batch',
    ...POINTER,
    plannedEffectIds: ['effect-1'],
    replayEffectIds: [],
    requiresExecutionAuthorityRevalidation: true,
  },
  continue_after_tool_result: {
    kind: 'continue_after_tool_result',
    ...POINTER,
    completedEffectIds: ['effect-1'],
  },
  reconcile_external_handles: {
    kind: 'reconcile_external_handles',
    runId: 'run-1',
    controlEpoch: 0,
    effectIds: ['effect-1'],
    handleIds: ['handle-1'],
  },
  resume_review: {
    kind: 'resume_review',
    ...POINTER,
  },
  finalize_existing_terminal_projection: {
    kind: 'finalize_existing_terminal_projection',
    ...POINTER,
    terminalStatus: 'succeeded',
    terminalAt: 100,
  },
} as const satisfies Record<
  DispatchableExecutionRecoveryCommand['kind'],
  DispatchableExecutionRecoveryCommand
>;

export const COORDINATOR_ROUTING_CASES = [
  ['resume_model_step', 'resumeModelStep', COORDINATOR_COMMANDS.resume_model_step],
  [
    'resume_persisted_tool_batch',
    'resumePersistedToolBatch',
    COORDINATOR_COMMANDS.resume_persisted_tool_batch,
  ],
  [
    'continue_after_tool_result',
    'continueAfterToolResult',
    COORDINATOR_COMMANDS.continue_after_tool_result,
  ],
  [
    'reconcile_external_handles',
    'reconcileExternalHandles',
    COORDINATOR_COMMANDS.reconcile_external_handles,
  ],
  ['resume_review', 'resumeReview', COORDINATOR_COMMANDS.resume_review],
  [
    'finalize_existing_terminal_projection',
    'finalizeExistingTerminalProjection',
    COORDINATOR_COMMANDS.finalize_existing_terminal_projection,
  ],
] as const;

export const COORDINATOR_BLOCK_COMMAND: Extract<ExecutionRecoveryCommand, { kind: 'block' }> = {
  kind: 'block',
  runId: 'run-1',
  controlEpoch: 0,
  reason: 'run_blocked',
  checkpointId: 'checkpoint-1',
  effectIds: [],
  handleIds: [],
};

export function coordinatorPlan(
  command: ExecutionRecoveryCommand = COORDINATOR_COMMANDS.resume_model_step,
): Extract<ExecutionRecoveryQueryResult, { kind: 'recovery_plan' }> {
  return {
    kind: 'recovery_plan',
    runId: 'run-1',
    generation: {
      controlEpoch: 0,
      updatedAt: 100,
      snapshotDigest: COORDINATOR_SNAPSHOT_DIGEST,
    },
    command,
  };
}

export function coordinatorAuthority(
  overrides: Partial<ExecutionRecoveryAuthoritySnapshot> = {},
): ExecutionRecoveryAuthoritySnapshot {
  return {
    kind: 'authority_snapshot',
    runId: 'run-1',
    controlEpoch: 0,
    cancellationState: 'active',
    executionAuthority: 'granted',
    authorityDigest: COORDINATOR_AUTHORITY_DIGEST,
    ...overrides,
  };
}

export function coordinatorAccepted(
  receiptId = 'receipt-1',
  fenceId = 'fence-1',
  fenceDigest = COORDINATOR_FENCE_DIGEST,
): ExecutionRecoveryHandlerResult {
  return {
    kind: 'accepted',
    fenceId,
    fenceDigest,
    receiptId,
    receiptDigest: COORDINATOR_RECEIPT_DIGEST,
  };
}

type HandlerName = keyof ExecutionRecoveryHandlers;

interface HarnessOverrides {
  current?: ExecutionRecoveryQueryResult;
  authority?: ExecutionRecoveryAuthorityResult;
  fence?: ExecutionRecoveryDispatchFenceResult;
}

function makeHandlers(events: string[]) {
  const handler = (name: HandlerName) =>
    jest.fn(async () => {
      events.push(name);
      return coordinatorAccepted(`receipt-${name}`);
    });
  return {
    resumeModelStep: handler('resumeModelStep'),
    resumePersistedToolBatch: handler('resumePersistedToolBatch'),
    continueAfterToolResult: handler('continueAfterToolResult'),
    reconcileExternalHandles: handler('reconcileExternalHandles'),
    resumeReview: handler('resumeReview'),
    finalizeExistingTerminalProjection: handler('finalizeExistingTerminalProjection'),
  } satisfies ExecutionRecoveryHandlers;
}

export function makeHarness(
  command: ExecutionRecoveryCommand = COORDINATOR_COMMANDS.resume_model_step,
  overrides: HarnessOverrides = {},
) {
  const initial = coordinatorPlan(command);
  const events: string[] = [];
  const handlers = makeHandlers(events);
  const queryRecovery = jest.fn(async () => {
    events.push('query');
    return overrides.current ?? initial;
  });
  const readAuthority = jest.fn(async () => {
    events.push('authority');
    return overrides.authority ?? coordinatorAuthority();
  });
  const acquireDispatchFence = jest.fn(async () => {
    events.push('fence');
    return (
      overrides.fence ?? {
        kind: 'fence_acquired',
        dispatchId: 'dispatch-1',
        dispatchDigest: COORDINATOR_DISPATCH_DIGEST,
        fenceId: 'fence-1',
        fenceDigest: COORDINATOR_FENCE_DIGEST,
      }
    );
  });
  const ports = {
    queryRecovery,
    readAuthority,
    acquireDispatchFence,
    handlers,
  } satisfies ExecutionRecoveryCoordinatorPorts;
  return {
    initial,
    events,
    handlers,
    ports,
    queryRecovery,
    readAuthority,
    acquireDispatchFence,
  };
}

export function expectNoHandlerCalls(handlers: ReturnType<typeof makeHandlers>): void {
  for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
}
