import { useSettingsStore } from '../store/useSettingsStore';
import { useChatStore } from '../store/useChatStore';

type ChatState = ReturnType<typeof useChatStore.getState>;
type SettingsState = ReturnType<typeof useSettingsStore.getState>;

export function selectChatScreenChatSlice(state: ChatState) {
  const activeConversation = state.activeConversationId
    ? state.conversations.find((conversation) => conversation.id === state.activeConversationId) ||
      null
    : null;

  return {
    conversations: state.conversations,
    activeConversation,
    activeConversationId: state.activeConversationId,
    isLoading: state.isLoading,
    createConversation: state.createConversation,
    addMessage: state.addMessage,
    updateMessage: state.updateMessage,
    updateMessageEnrichedContent: state.updateMessageEnrichedContent,
    updateMessageReasoning: state.updateMessageReasoning,
    updateMessageProviderReplay: state.updateMessageProviderReplay,
    updateMessageAssistantMetadata: state.updateMessageAssistantMetadata,
    updateMessageEffect: state.updateMessageEffect,
    editMessage: state.editMessage,
    setLoading: state.setLoading,
    addToolCall: state.addToolCall,
    updateToolCallStatus: state.updateToolCallStatus,
    addConversationLog: state.addConversationLog,
    startAgentRun: state.startAgentRun,
    setAgentRunPhase: state.setAgentRunPhase,
    appendAgentRunCheckpoint: state.appendAgentRunCheckpoint,
    updateAgentRunSummary: state.updateAgentRunSummary,
    updateAgentRunPendingAsyncOperations: state.updateAgentRunPendingAsyncOperations,
    updateAgentRunPlan: state.updateAgentRunPlan,
    updateAgentRunPilotEvaluation: state.updateAgentRunPilotEvaluation,
    setAgentRunAwaitingBackgroundWorkers: state.setAgentRunAwaitingBackgroundWorkers,
    completeAgentRun: state.completeAgentRun,
    updateModelInConversation: state.updateModelInConversation,
    updatePersonaInConversation: state.updatePersonaInConversation,
    updateModeInConversation: state.updateModeInConversation,
  };
}

export function selectChatScreenSettingsSlice(state: SettingsState) {
  return {
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    activeModel: state.activeModel,
    thinkingLevel: state.thinkingLevel,
    systemPrompt: state.systemPrompt,
    setActiveProviderAndModel: state.setActiveProviderAndModel,
    setLastUsedModel: state.setLastUsedModel,
    linkUnderstandingEnabled: state.linkUnderstandingEnabled,
    mediaUnderstandingEnabled: state.mediaUnderstandingEnabled,
    maxLinks: state.maxLinks,
    defaultConversationMode: state.defaultConversationMode,
  };
}
