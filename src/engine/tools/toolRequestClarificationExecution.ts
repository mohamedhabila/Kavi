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
        error:
          'Provide one question and one to twelve unique semantic missing_information fields.',
      }),
    );
  }

  return completedToolOutcome(JSON.stringify(buildRequestClarificationToolResult(parsed.value)));
}
