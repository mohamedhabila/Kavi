import type { Message } from '../../types/message';

export const TOOL_MESSAGE_OUTCOME_STATUSES = ['completed', 'failed'] as const;

export type ToolMessageOutcomeStatus = (typeof TOOL_MESSAGE_OUTCOME_STATUSES)[number];

/**
 * Code-owned terminal outcome published after a tool result has been canonicalized.
 * Result text remains opaque evidence and never determines the terminal status.
 */
export type ToolMessageOutcome = Readonly<{
  version: 1;
  toolCallId: string;
  status: ToolMessageOutcomeStatus;
  content: string;
}>;

export function buildToolMessageOutcome(params: {
  toolCallId: string;
  toolMessage: Pick<Message, 'content' | 'isError'>;
}): ToolMessageOutcome {
  if (!params.toolCallId.trim()) {
    throw new Error('tool_message_outcome_tool_call_id_required');
  }

  return Object.freeze({
    version: 1,
    toolCallId: params.toolCallId,
    status: params.toolMessage.isError === true ? 'failed' : 'completed',
    content: params.toolMessage.content,
  });
}
