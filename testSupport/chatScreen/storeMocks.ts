import { mockChatScreenState, mockGetConversations } from './state';
import { mockPersonas } from './componentMocks';

export const mockUpdateMessageEnrichedContent = jest.fn();
export const mockCreateConversation = jest.fn().mockReturnValue('new-conv');
export const mockGetOrCreateCanonicalThread = jest.fn().mockReturnValue('new-conv');
export const mockAddMessage = jest.fn();
export const mockUpdateMessage = jest.fn();
export const mockSetLoading = jest.fn();
export const mockEditMessage = jest.fn();
export const mockUpdateModelInConversation = jest.fn();
export const mockSetActiveProviderAndModel = jest.fn();
export const mockSetLastUsedModel = jest.fn();
export const mockUpdateMessageReasoning = jest.fn();
export const mockUpdateMessageProviderReplay = jest.fn();
export const mockUpdateMessageAssistantMetadata = jest.fn();
export const mockAddToolCall = jest.fn();
export const mockUpdateToolCallStatus = jest.fn();
export const mockUpdateMessageEffect = jest.fn();
export const mockUpdatePersonaInConversation = jest.fn();
export const mockUpdateModeInConversation = jest.fn();
export const mockRecordConversationUsage = jest.fn();
export const mockAddConversationLog = jest.fn();
export const mockStartAgentRun = jest.fn();
export const mockSetAgentRunPhase = jest.fn();
export const mockAppendAgentRunCheckpoint = jest.fn();
export const mockUpdateAgentRunSummary = jest.fn();
export const mockUpdateAgentRunAsyncWork = jest.fn();
export const mockUpdateAgentRunControlGraph = jest.fn();
export const mockUpdateAgentRunPlan = jest.fn();
export const mockCompleteAgentRun = jest.fn();
export const mockRecordAgentRunEvidence = jest.fn();

jest.mock('../../src/store/useChatStore', () => {
  const getState = () => ({
    conversations: mockGetConversations(),
    activeConversationId: mockChatScreenState.activeConversationId,
    isLoading: mockChatScreenState.loadingState,
    createConversation: mockCreateConversation,
    getOrCreateCanonicalThread: mockGetOrCreateCanonicalThread,
    addMessage: mockAddMessage,
    updateMessage: mockUpdateMessage,
    updateMessageEnrichedContent: mockUpdateMessageEnrichedContent,
    updateMessageReasoning: mockUpdateMessageReasoning,
    updateMessageProviderReplay: mockUpdateMessageProviderReplay,
    updateMessageAssistantMetadata: mockUpdateMessageAssistantMetadata,
    updateMessageEffect: mockUpdateMessageEffect,
    editMessage: mockEditMessage,
    setLoading: mockSetLoading,
    addToolCall: mockAddToolCall,
    updateToolCallStatus: mockUpdateToolCallStatus,
    recordConversationUsage: mockRecordConversationUsage,
    addConversationLog: mockAddConversationLog,
    startAgentRun: mockStartAgentRun,
    setAgentRunPhase: mockSetAgentRunPhase,
    appendAgentRunCheckpoint: mockAppendAgentRunCheckpoint,
    updateAgentRunSummary: mockUpdateAgentRunSummary,
    updateAgentRunAsyncWork: mockUpdateAgentRunAsyncWork,
    updateAgentRunControlGraph: mockUpdateAgentRunControlGraph,
    updateAgentRunPlan: mockUpdateAgentRunPlan,
    completeAgentRun: mockCompleteAgentRun,
    recordAgentRunEvidence: mockRecordAgentRunEvidence,
    updateModelInConversation: mockUpdateModelInConversation,
    updatePersonaInConversation: mockUpdatePersonaInConversation,
    updateModeInConversation: mockUpdateModeInConversation,
  });

  const useChatStore = (selector: (s: any) => any) => selector(getState());
  useChatStore.getState = getState;
  useChatStore.setState = jest.fn();
  return { useChatStore };
});

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: any) => any) => {
    const state = {
      providers: mockChatScreenState.providersList,
      activeProviderId: mockChatScreenState.activeProviderId,
      activeModel: mockChatScreenState.activeModel,
      thinkingLevel: mockChatScreenState.thinkingLevel,
      systemPrompt: 'You are helpful',
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
      defaultConversationMode: mockChatScreenState.defaultConversationMode,
      setActiveProviderAndModel: mockSetActiveProviderAndModel,
      setLastUsedModel: mockSetLastUsedModel,
    };
    return selector(state);
  },
}));

jest.mock('../../src/services/agents/store', () => ({
  usePersonaConfigStore: (selector: (state: any) => any) =>
    selector({ customPersonas: [], overrides: {} }),
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: () => mockPersonas,
  getAvailablePersonas: () => mockPersonas,
}));
