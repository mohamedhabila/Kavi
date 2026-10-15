import {
  buildRequestClarificationToolResult,
  parseRequestClarificationArgs,
} from '../../services/agents/requestClarification';
import { completedToolOutcome, failedToolOutcome } from '../../types/toolRuntimeOutcome';

export function executeRequestClarification(args: unknown) {
  const parsed = parseRequestClarificationArgs(args);
  if (!parsed.ok) {
    return failedToolOutcome(
      JSON.stringify({
        status: 'error',
        code: parsed.error,
        error: parsed.detail,
      }),
    );
  }

  return completedToolOutcome(JSON.stringify(buildRequestClarificationToolResult(parsed.value)));
}
