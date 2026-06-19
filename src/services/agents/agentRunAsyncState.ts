import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunControlGraphAsyncWorkState,
} from '../../types/agentRun';

export const TERMINAL_AGENT_RUN_ASYNC_OPERATION_STATUSES = new Set<
  AgentRunAsyncOperation['status']
>(['completed', 'failed', 'cancelled', 'timeout']);

const MAX_AGENT_RUN_ASYNC_OPERATIONS = 8;

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

export function normalizeAgentRunAsyncOperationArgs(
  value: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map<[string, string | number | boolean] | null>(([entryKey, entryValue]) => {
      const normalizedKey = entryKey.trim();
      if (!normalizedKey) {
        return null;
      }

      if (typeof entryValue === 'string') {
        const normalizedValue = entryValue.trim();
        return normalizedValue ? [normalizedKey, normalizedValue] : null;
      }

      if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        return [normalizedKey, entryValue];
      }

      return null;
    })
    .filter((entry): entry is [string, string | number | boolean] => entry !== null);

  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
}

export function normalizeAgentRunAsyncOperations(
  operations: ReadonlyArray<AgentRunAsyncOperation> | undefined,
): AgentRunAsyncOperation[] | undefined {
  const normalizedOperations = (operations ?? [])
    .map<AgentRunAsyncOperation | null>((operation, index) => {
      const normalizedResourceId = operation.resourceId?.trim();
      if (
        !normalizedResourceId ||
        TERMINAL_AGENT_RUN_ASYNC_OPERATION_STATUSES.has(operation.status)
      ) {
        return null;
      }

      const normalizedMonitorToolNames = Array.from(
        new Set(
          (operation.monitorToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
        ),
      );
      if (normalizedMonitorToolNames.length === 0) {
        return null;
      }

      return {
        key: operation.key?.trim() || `${operation.kind}:${normalizedResourceId}:${index}`,
        kind: operation.kind,
        resourceId: normalizedResourceId,
        displayName: operation.displayName?.trim() || normalizedResourceId,
        status: operation.status,
        blocksFinalization: operation.blocksFinalization !== false,
        lastUpdatedByTool: operation.lastUpdatedByTool?.trim() || 'recovered_async_state',
        updatedAt: normalizeTimestamp(operation.updatedAt),
        monitorToolNames: normalizedMonitorToolNames,
        ...(operation.waitToolName?.trim() ? { waitToolName: operation.waitToolName.trim() } : {}),
        ...(operation.statusArgs
          ? { statusArgs: normalizeAgentRunAsyncOperationArgs(operation.statusArgs) }
          : {}),
        ...(operation.waitArgs
          ? { waitArgs: normalizeAgentRunAsyncOperationArgs(operation.waitArgs) }
          : {}),
      };
    })
    .filter((operation): operation is AgentRunAsyncOperation => operation !== null)
    .slice(0, MAX_AGENT_RUN_ASYNC_OPERATIONS);

  return normalizedOperations.length > 0 ? normalizedOperations : undefined;
}

export function areAgentRunAsyncOperationsEqual(
  left: ReadonlyArray<AgentRunAsyncOperation> | undefined,
  right: ReadonlyArray<AgentRunAsyncOperation> | undefined,
): boolean {
  const normalizedLeft = normalizeAgentRunAsyncOperations(left) ?? [];
  const normalizedRight = normalizeAgentRunAsyncOperations(right) ?? [];

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((leftOperation, index) => {
    const rightOperation = normalizedRight[index];
    return (
      leftOperation.key === rightOperation.key &&
      leftOperation.kind === rightOperation.kind &&
      leftOperation.resourceId === rightOperation.resourceId &&
      leftOperation.displayName === rightOperation.displayName &&
      leftOperation.status === rightOperation.status &&
      leftOperation.blocksFinalization === rightOperation.blocksFinalization &&
      leftOperation.lastUpdatedByTool === rightOperation.lastUpdatedByTool &&
      leftOperation.updatedAt === rightOperation.updatedAt &&
      leftOperation.waitToolName === rightOperation.waitToolName &&
      JSON.stringify(leftOperation.monitorToolNames) ===
        JSON.stringify(rightOperation.monitorToolNames) &&
      JSON.stringify(leftOperation.statusArgs ?? {}) ===
        JSON.stringify(rightOperation.statusArgs ?? {}) &&
      JSON.stringify(leftOperation.waitArgs ?? {}) === JSON.stringify(rightOperation.waitArgs ?? {})
    );
  });
}

export function normalizeAgentRunControlGraphAsyncWorkState(
  state: Partial<AgentRunControlGraphAsyncWorkState> | undefined,
): AgentRunControlGraphAsyncWorkState {
  return {
    awaitingBackgroundWorkers: state?.awaitingBackgroundWorkers === true,
    pendingOperations: normalizeAgentRunAsyncOperations(state?.pendingOperations) ?? [],
    updatedAt: normalizeTimestamp(state?.updatedAt),
  };
}

export function areAgentRunControlGraphAsyncWorkStatesEqual(
  left: Partial<AgentRunControlGraphAsyncWorkState> | undefined,
  right: Partial<AgentRunControlGraphAsyncWorkState> | undefined,
): boolean {
  const normalizedLeft = normalizeAgentRunControlGraphAsyncWorkState(left);
  const normalizedRight = normalizeAgentRunControlGraphAsyncWorkState(right);

  return (
    normalizedLeft.awaitingBackgroundWorkers === normalizedRight.awaitingBackgroundWorkers &&
    normalizedLeft.updatedAt === normalizedRight.updatedAt &&
    areAgentRunAsyncOperationsEqual(
      normalizedLeft.pendingOperations,
      normalizedRight.pendingOperations,
    )
  );
}

export function getAgentRunPendingAsyncOperations(run: AgentRun): AgentRunAsyncOperation[] {
  const graphOperations = normalizeAgentRunAsyncOperations(
    run.controlGraph?.asyncWork?.pendingOperations,
  );
  return graphOperations ?? [];
}

export function isAgentRunAwaitingBackgroundWorkers(run: AgentRun): boolean {
  return run.controlGraph?.asyncWork?.awaitingBackgroundWorkers === true;
}
