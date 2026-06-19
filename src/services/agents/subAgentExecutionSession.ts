import type { LlmProviderConfig } from '../../types/provider';
import type { Message, ToolCall } from '../../types/message';
import type { SubAgentConfig } from '../../types/subAgent';
import { cloneJsonLike, coerceToolCallStatus } from './lifecycle/sessionContextMessages';

export function createSubAgentExecutionSession(params: {
  sessionId: string;
  config: SubAgentConfig;
  provider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  systemPrompt: string;
  messages: Message[];
  getIteration: () => number;
  scheduleSessionContextCheckpoint: (
    context: {
      sessionId: string;
      config: SubAgentConfig;
      provider: LlmProviderConfig;
      allProviders?: LlmProviderConfig[];
      systemPrompt: string;
      conversationSummary: string;
      messages: Message[];
    },
    options?: { immediate?: boolean },
  ) => void;
  clearPendingSessionContextCheckpoint: (sessionId: string) => void;
  clearSessionContextEviction: (sessionId: string) => void;
  storeSessionContext: (context: {
    sessionId: string;
    config: SubAgentConfig;
    provider: LlmProviderConfig;
    allProviders?: LlmProviderConfig[];
    systemPrompt: string;
    conversationSummary: string;
    messages: Message[];
  }) => void;
  scheduleRegistryPersist: () => void;
}) {
  const transcriptToolCalls = new Map<string, ToolCall>();

  function checkpointSessionContext(
    conversationSummary?: string,
    options?: { immediate?: boolean },
  ): void {
    params.scheduleSessionContextCheckpoint(
      {
        sessionId: params.sessionId,
        config: params.config,
        provider: params.provider,
        allProviders: params.allProviders,
        systemPrompt: params.systemPrompt,
        conversationSummary: conversationSummary?.trim() || '',
        messages: params.messages,
      },
      options,
    );
  }

  function persistSessionContextNow(conversationSummary?: string): void {
    params.clearPendingSessionContextCheckpoint(params.sessionId);
    params.clearSessionContextEviction(params.sessionId);
    params.storeSessionContext({
      sessionId: params.sessionId,
      config: params.config,
      provider: params.provider,
      allProviders: params.allProviders,
      systemPrompt: params.systemPrompt,
      conversationSummary: conversationSummary?.trim() || '',
      messages: params.messages,
    });
    params.scheduleRegistryPersist();
  }

  function trackToolCall(
    toolCallLike: Partial<ToolCall> | undefined,
    fallbackStatus: ToolCall['status'],
  ): ToolCall {
    const fallbackId = `${params.sessionId}-tool-${Math.max(params.getIteration(), 0)}-${fallbackStatus}`;
    const id =
      typeof toolCallLike?.id === 'string' && toolCallLike.id.trim().length > 0
        ? toolCallLike.id
        : fallbackId;
    const existing = transcriptToolCalls.get(id);
    const nextToolCall: ToolCall = {
      id,
      name:
        typeof toolCallLike?.name === 'string' && toolCallLike.name.trim().length > 0
          ? toolCallLike.name
          : existing?.name || 'tool',
      arguments:
        typeof toolCallLike?.arguments === 'string'
          ? toolCallLike.arguments
          : existing?.arguments || '{}',
      ...(toolCallLike?.raw
        ? { raw: cloneJsonLike(toolCallLike.raw) }
        : existing?.raw
          ? { raw: cloneJsonLike(existing.raw) }
          : {}),
      status: coerceToolCallStatus(toolCallLike?.status, fallbackStatus),
      startedAt: toolCallLike?.startedAt ?? existing?.startedAt,
      updatedAt: toolCallLike?.updatedAt ?? Date.now(),
      completedAt: toolCallLike?.completedAt ?? existing?.completedAt,
      progressText: toolCallLike?.progressText ?? existing?.progressText,
      result: typeof toolCallLike?.result === 'string' ? toolCallLike.result : existing?.result,
      error: typeof toolCallLike?.error === 'string' ? toolCallLike.error : existing?.error,
    };
    transcriptToolCalls.set(id, nextToolCall);
    return nextToolCall;
  }

  return {
    transcriptToolCalls,
    checkpointSessionContext,
    persistSessionContextNow,
    trackToolCall,
  };
}
