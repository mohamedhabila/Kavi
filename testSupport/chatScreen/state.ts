import { createDefaultConversations, resetMockTimestamp } from './fixtures';

let mockConversations = createDefaultConversations();

export const mockGetConversations = () => mockConversations;

let mockActiveConvId: string | null = 'conv1';
let mockLoadingState = false;
let mockActiveProviderId: string | null = 'openai';
let mockActiveModel: string | null = 'gpt-5.4';
let mockThinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium';
let mockDefaultConversationMode: 'agentic' | 'chitchat' = 'agentic';
const createDefaultProvidersList = (): any[] => [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-5.4',
    enabled: true,
    availableModels: ['gpt-5.4'],
  },
];

let mockProvidersList: any[] = createDefaultProvidersList();

type MockSubAgentListener =
  | ((agent: any, event: 'started' | 'completed' | 'error' | 'cancelled' | 'progress') => void)
  | null;

let mockSubAgentListener: MockSubAgentListener = null;
let mockActiveSubAgents: any[] = [];

export const mockChatScreenState = {
  get conversations() {
    return mockConversations;
  },
  set conversations(value: any[]) {
    mockConversations = value;
  },
  get activeConversationId() {
    return mockActiveConvId;
  },
  set activeConversationId(value: string | null) {
    mockActiveConvId = value;
  },
  get loadingState() {
    return mockLoadingState;
  },
  set loadingState(value: boolean) {
    mockLoadingState = value;
  },
  get activeProviderId() {
    return mockActiveProviderId;
  },
  set activeProviderId(value: string | null) {
    mockActiveProviderId = value;
  },
  get activeModel() {
    return mockActiveModel;
  },
  set activeModel(value: string | null) {
    mockActiveModel = value;
  },
  get thinkingLevel() {
    return mockThinkingLevel;
  },
  set thinkingLevel(value: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') {
    mockThinkingLevel = value;
  },
  get defaultConversationMode() {
    return mockDefaultConversationMode;
  },
  set defaultConversationMode(value: 'agentic' | 'chitchat') {
    mockDefaultConversationMode = value;
  },
  get providersList() {
    return mockProvidersList;
  },
  set providersList(value: any[]) {
    mockProvidersList = value;
  },
  get subAgentListener() {
    return mockSubAgentListener;
  },
  set subAgentListener(value: typeof mockSubAgentListener) {
    mockSubAgentListener = value;
  },
  get activeSubAgents() {
    return mockActiveSubAgents;
  },
  set activeSubAgents(value: any[]) {
    mockActiveSubAgents = value;
  },
};
export function updateMockConversation(
  conversationId: string,
  updater: (conversation: any) => any,
) {
  mockConversations = mockConversations.map((conversation) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

export function updateMockAgentRun(
  conversationId: string,
  runId: string | undefined,
  updater: (run: any, conversation: any) => any,
) {
  updateMockConversation(conversationId, (conversation) => {
    const targetRunId = runId || conversation.activeAgentRunId;
    if (!targetRunId) {
      return conversation;
    }

    return {
      ...conversation,
      agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
        run.id === targetRunId ? updater(run, conversation) : run,
      ),
    };
  });
}

export function upsertMockToolCall(toolCalls: any[] | undefined, toolCall: any) {
  const existingToolCalls = toolCalls ?? [];
  const existingIndex = existingToolCalls.findIndex((candidate) => candidate.id === toolCall.id);

  if (existingIndex < 0) {
    return [...existingToolCalls, toolCall];
  }

  return existingToolCalls.map((candidate, index) =>
    index === existingIndex ? { ...candidate, ...toolCall } : candidate,
  );
}

export function resetMockChatScreenState() {
  mockConversations = createDefaultConversations();
  mockActiveConvId = 'conv1';
  mockLoadingState = false;
  mockActiveProviderId = 'openai';
  mockActiveModel = 'gpt-5.4';
  mockThinkingLevel = 'medium';
  mockDefaultConversationMode = 'agentic';
  mockProvidersList = createDefaultProvidersList();
  mockSubAgentListener = null;
  mockActiveSubAgents = [];
  resetMockTimestamp();
}
