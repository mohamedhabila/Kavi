import type { ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import { filterModelVisibleAttachments } from '../../utils/messageAttachments';
import { getCommand } from '../../services/commands/builtins';
import { parseCommand } from '../../services/commands/parser';
import { buildGraphEntryRequestFrame } from './requestEntrySignals';

function isRegisteredSlashCommand(content: string | undefined): boolean {
  const command = parseCommand(content);
  return command ? getCommand(command.name) !== undefined : false;
}

export function shouldTrackForegroundAgentRun(params: {
  conversationMode?: ConversationMode;
  defaultConversationMode?: ConversationMode;
  latestUserMessage?: Message;
  messageCount: number;
  reuseAgentRunId?: string;
}): boolean {
  const mode = params.conversationMode ?? params.defaultConversationMode ?? 'agentic';
  if (mode !== 'agentic') {
    return false;
  }

  if (params.reuseAgentRunId?.trim()) {
    return true;
  }

  if (isRegisteredSlashCommand(params.latestUserMessage?.content)) {
    return false;
  }

  const frame = buildGraphEntryRequestFrame({
    text: params.latestUserMessage?.content,
    attachmentCount:
      filterModelVisibleAttachments(params.latestUserMessage?.attachments)?.length ?? 0,
    mode: 'agentic',
    continuation: 'new',
  });

  return frame.decision.action === 'act';
}
