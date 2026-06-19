import type { LlmProviderConfig } from '../../../types/provider';
import type { SubAgentConfig } from '../../../types/subAgent';
import type { TokenUsage } from '../../../types/usage';
import { recordConversationUsageEvent } from '../../usage/conversationUsage';

export function createSubAgentUsageRecorder(params: {
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  sessionId: string;
}): (
  usage: TokenUsage,
  source: 'sub-agent' | 'sub-agent-finalizer',
  options?: { recordSessionUsage?: boolean },
) => void {
  return (usage, source, options): void => {
    recordConversationUsageEvent({
      conversationId: params.config.parentConversationId,
      usage: {
        model: usage.model || params.config.model || params.provider.model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.cacheWriteTokens ?? 0,
        totalTokens: usage.totalTokens,
      },
      providerId: params.provider.id,
      source,
      sessionId: params.sessionId,
      parentSessionId: params.config.parentSessionId,
      agentRunId: params.config.agentRunId,
      recordSessionUsage: options?.recordSessionUsage,
      emitLog: true,
    });
  };
}
