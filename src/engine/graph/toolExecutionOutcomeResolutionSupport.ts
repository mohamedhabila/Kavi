import type { ToolCallRecord } from '../loopDetection';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';

export function updateToolCallHistoryResult(params: {
  history: ToolCallRecord[] | undefined;
  toolCallId: string;
  toolName: string;
  argumentsText: string | undefined;
  result: string;
  status: ToolMessageOutcome['status'];
}): void {
  if (!params.history) return;

  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const entry = params.history[index];
    const idMatches = entry?.id && entry.id === params.toolCallId;
    const callMatches =
      !entry?.id &&
      entry?.name === params.toolName &&
      entry.arguments === (params.argumentsText ?? '{}');
    if (!entry || (!idMatches && !callMatches)) continue;

    params.history[index] = {
      ...entry,
      result: params.result,
      status: params.status,
    };
    return;
  }
}
