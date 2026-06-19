import type { ToolCall } from '../../types/message';

export function resolveAssistantToolTurnContent(params: {
  content: string;
  toolCalls: ReadonlyArray<Pick<ToolCall, 'id' | 'name'>>;
}): string {
  return params.content;
}
