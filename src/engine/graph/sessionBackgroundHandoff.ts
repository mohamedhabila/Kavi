import { parseJsonRecord } from '../asyncTracking/support';
import { normalizeToolName } from '../tools/toolNameNormalization';

const BACKGROUND_SESSION_TOOL_NAMES = new Set(['sessions_spawn', 'sessions_send']);

export function didSessionToolStartBackgroundWork(params: {
  toolName: string;
  toolArguments: string | undefined;
  toolResult: string;
  isError?: boolean;
}): boolean {
  const toolName = normalizeToolName(params.toolName);
  if (params.isError || !BACKGROUND_SESSION_TOOL_NAMES.has(toolName)) {
    return false;
  }

  const toolArguments = parseJsonRecord(params.toolArguments);
  if (
    (toolName === 'sessions_spawn' && toolArguments?.waitForCompletion !== false) ||
    (toolName === 'sessions_send' && toolArguments?.waitForCompletion === true)
  ) {
    return false;
  }

  const toolResult = parseJsonRecord(params.toolResult);
  return (
    toolResult?.status === 'running' &&
    typeof toolResult.sessionId === 'string' &&
    toolResult.sessionId.trim().length > 0
  );
}
