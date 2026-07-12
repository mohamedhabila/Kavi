import { useChatStore } from '../../store/useChatStore';
import type { ConversationMode } from '../../types/conversation';
import type {
  AssistantMessageMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import { generateId } from '../../utils/id';
import { resolveConversationPersonaForMode } from '../../engine/graph/conversation/modeTransitions';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';

type ChatState = Pick<
  ReturnType<typeof useChatStore.getState>,
  | 'addMessage'
  | 'addToolCall'
  | 'updateMessage'
  | 'updateMessageProviderReplay'
  | 'updateMessageAssistantMetadata'
  | 'updateToolCallStatus'
>;

type ConversationModeState = Pick<
  ReturnType<typeof useChatStore.getState>,
  'conversations' | 'updateModeInConversation' | 'updatePersonaInConversation'
>;

export interface PendingAssistantResponse {
  content: string;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
}

export class ScheduledToolTurnLedger {
  private readonly assistantMessageIds = new Map<string, string>();
  private readonly completedToolCallIds = new Set<string>();
  private readonly terminalResultIds = new Set<string>();

  constructor(
    private readonly chatState: ChatState,
    private readonly conversationId: string,
  ) {}

  persist(toolCall: ToolCall, assistantMessageId: string, activeToolCallIds: Set<string>): string {
    const existingMessageId = this.assistantMessageIds.get(toolCall.id);
    if (existingMessageId) return existingMessageId;
    this.chatState.addToolCall(this.conversationId, assistantMessageId, toolCall);
    activeToolCallIds.add(toolCall.id);
    this.assistantMessageIds.set(toolCall.id, assistantMessageId);
    return assistantMessageId;
  }

  persistAll(
    toolCalls: ToolCall[],
    assistantMessageId: string,
    activeToolCallIds: Set<string>,
  ): void {
    for (const toolCall of toolCalls) {
      this.persist(toolCall, assistantMessageId, activeToolCallIds);
    }
  }

  markCompleted(toolCallId: string): void {
    this.completedToolCallIds.add(toolCallId);
  }

  private wasCompleted(toolCallId: string): boolean {
    return this.completedToolCallIds.has(toolCallId);
  }

  appendTerminalResult(toolCallId: string, result: string, content: string): boolean {
    const assistantMessageId = this.assistantMessageIds.get(toolCallId);
    if (!assistantMessageId) return false;
    const isError = isToolResultErrorLike(result);
    if (!this.wasCompleted(toolCallId)) {
      this.chatState.updateToolCallStatus(
        this.conversationId,
        assistantMessageId,
        toolCallId,
        isError ? 'failed' : 'completed',
        { result, ...(isError ? { error: result } : {}) },
      );
    }
    this.chatState.addMessage(this.conversationId, {
      id: `${assistantMessageId}_tool_${toolCallId}`,
      role: 'tool',
      content,
      toolCallId,
      isError,
    });
    this.terminalResultIds.add(toolCallId);
    return true;
  }

  isBatchSettled(toolCallId: string): boolean {
    const assistantMessageId = this.assistantMessageIds.get(toolCallId);
    if (!assistantMessageId) return false;
    for (const [candidateId, candidateMessageId] of this.assistantMessageIds) {
      if (candidateMessageId === assistantMessageId && !this.terminalResultIds.has(candidateId)) {
        return false;
      }
    }
    return true;
  }
}

export function synchronizeScheduledConversationMode(
  chatState: ConversationModeState,
  conversationId: string,
  mode: ConversationMode,
): string {
  const personaId = resolveConversationPersonaForMode({
    conversationPersonaId: chatState.conversations.find(
      (conversation) => conversation.id === conversationId,
    )?.personaId,
    nextMode: mode,
  });
  chatState.updateModeInConversation(conversationId, mode);
  chatState.updatePersonaInConversation(conversationId, personaId);
  return personaId;
}

export function appendOrUpdateAssistantToolTurn(params: {
  chatState: ChatState;
  conversationId: string;
  activeAssistantMessageId: string;
  activeToolCallIds: Set<string>;
  content: string;
  toolCallIds: string[];
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
}): { assistantMessageId: string; toolCallIds: Set<string> } {
  const startsNewTurn = params.toolCallIds.some((id) => !params.activeToolCallIds.has(id));
  if (startsNewTurn) {
    const assistantMessageId = generateId();
    params.chatState.addMessage(params.conversationId, {
      id: assistantMessageId,
      role: 'assistant',
      content: params.content,
      providerReplay: params.providerReplay,
      assistantMetadata: params.assistantMetadata,
    });
    return { assistantMessageId, toolCallIds: new Set(params.toolCallIds) };
  }

  if (params.content) {
    params.chatState.updateMessage(
      params.conversationId,
      params.activeAssistantMessageId,
      params.content,
    );
  }
  if (params.providerReplay) {
    params.chatState.updateMessageProviderReplay(
      params.conversationId,
      params.activeAssistantMessageId,
      params.providerReplay,
    );
  }
  if (params.assistantMetadata) {
    params.chatState.updateMessageAssistantMetadata(
      params.conversationId,
      params.activeAssistantMessageId,
      params.assistantMetadata,
    );
  }
  return {
    assistantMessageId: params.activeAssistantMessageId,
    toolCallIds: params.activeToolCallIds,
  };
}

export function appendAssistantResponseAfterTool(params: {
  chatState: ChatState;
  conversationId: string;
  content: string;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
  isError?: boolean;
}): string {
  const assistantMessageId = generateId();
  params.chatState.addMessage(params.conversationId, {
    id: assistantMessageId,
    role: 'assistant',
    content: params.content,
    providerReplay: params.providerReplay,
    assistantMetadata: params.assistantMetadata,
    isError: params.isError,
  });
  return assistantMessageId;
}

export function buildTerminalFailureMetadata(
  assistantMetadata?: AssistantMessageMetadata,
): AssistantMessageMetadata {
  return {
    ...assistantMetadata,
    kind: 'final',
    completionStatus: 'incomplete',
    finishReason: 'response_failed',
  };
}
