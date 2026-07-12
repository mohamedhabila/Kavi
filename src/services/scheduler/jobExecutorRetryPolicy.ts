import { descriptorForToolName } from '../../engine/tools/toolLifecycleSemantics';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import { isNonRetryableProviderRequestError } from '../llm/support/requestErrors';

function isToolReplaySafe(toolName: string): boolean {
  const descriptor = descriptorForToolName(toolName);
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.riskHints.some((hint) => hint === 'read_only' || hint === 'idempotent')
  );
}

export function createScheduledJobRetryPolicy(lifecycleSignal?: AbortSignal) {
  let observedUnsafeToolActivity = false;
  let lifecycleCancellationObserved = false;

  return {
    recordControlGraphStatus(status: AgentRunControlGraphState['status']): void {
      lifecycleCancellationObserved = status === 'cancelled' && lifecycleSignal?.aborted === true;
    },
    recordToolActivity(toolName: string): void {
      if (!isToolReplaySafe(toolName)) {
        observedUnsafeToolActivity = true;
      }
    },
    hasObservedUnsafeToolActivity(): boolean {
      return observedUnsafeToolActivity;
    },
    isProviderFailureNonRetryable(error: unknown): boolean {
      return observedUnsafeToolActivity || isNonRetryableProviderRequestError(error);
    },
    isTerminalFailureNonRetryable(hasControlGraphFailure: boolean): boolean {
      return (
        observedUnsafeToolActivity || (hasControlGraphFailure && !lifecycleCancellationObserved)
      );
    },
  };
}
