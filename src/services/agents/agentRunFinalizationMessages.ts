import type { Message } from '../../types/message';

export function getAgentRunFinalizationToolNameForMessage(message: Message): string {
  const toolCallName = message.toolCalls?.[0]?.name;
  if (toolCallName?.trim()) {
    return toolCallName.trim();
  }

  const toolCallId = message.toolCallId?.trim();
  return toolCallId || 'tool';
}
