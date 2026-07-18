import { failedToolOutcome } from '../../types/toolRuntimeOutcome';
import type { ToolRuntimeExecution } from './runtimeExecution';
import { buildMobileControllerDeferredExecution } from './runtimeExecution';
import type { MobileControllerExecutionBinding } from './runtimeBinding';

function failure(code: string, error: string): ToolRuntimeExecution {
  return failedToolOutcome(
    JSON.stringify({ status: 'error', code, error, retryable: code === 'action_invalid' }),
  );
}

export async function executeMobileControllerTool(
  argumentsText: string,
  binding: MobileControllerExecutionBinding | undefined,
): Promise<ToolRuntimeExecution> {
  if (!binding) {
    return failure('controller_unavailable', 'No admitted mobile controller is bound.');
  }
  let action: unknown;
  try {
    action = argumentsText ? JSON.parse(argumentsText) : {};
  } catch {
    return failure('arguments_invalid', 'The mobile action arguments are not valid JSON.');
  }
  const deferred = buildMobileControllerDeferredExecution({
    capability: binding.capability,
    action,
    beforeObservation: binding.currentObservation,
  });
  return deferred ?? failure('action_invalid', 'The action is invalid for the current capability.');
}
