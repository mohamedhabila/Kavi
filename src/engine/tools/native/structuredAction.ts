import {
  executeNativeAction,
  serializeNativeActionResult,
} from '../../../services/nativeActions/actionService';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../../types/toolRuntimeOutcome';

export async function executeStructuredNativeAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolRuntimeOutcome> {
  const result = await executeNativeAction(name, args);
  const content = serializeNativeActionResult(result);
  return result.executionStatus === 'completed'
    ? completedToolOutcome(content)
    : failedToolOutcome(content);
}
