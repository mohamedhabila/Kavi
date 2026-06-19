import type { ConversationMode } from '../../types/conversation';
import type { Message } from '../../types/message';
import { hasModelVisibleAttachments } from '../../utils/messageAttachments';
import { assessGraphEntryRequest } from './requestEntrySignals';

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

  const assessment = assessGraphEntryRequest({
    text: params.latestUserMessage?.content,
    hasAttachments: hasModelVisibleAttachments(params.latestUserMessage?.attachments),
  });

  return assessment.action !== 'clarify';
}
