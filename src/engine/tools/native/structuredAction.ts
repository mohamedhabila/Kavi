import {
  executeNativeAction,
  serializeNativeActionResult,
} from '../../../services/nativeActions/actionService';

export async function executeStructuredNativeAction(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = await executeNativeAction(name, args);
  return serializeNativeActionResult(result);
}
