import type { ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import { filterModelVisibleAttachments } from '../../utils/messageAttachments';
import { buildGraphEntryRequestFrame } from './requestEntrySignals';

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

  const frame = buildGraphEntryRequestFrame({
    text: params.latestUserMessage?.content,
    attachmentCount:
      filterModelVisibleAttachments(params.latestUserMessage?.attachments)?.length ?? 0,
    mode: 'agentic',
    continuation: 'new',
  });

  return frame.decision.action === 'act';
}
