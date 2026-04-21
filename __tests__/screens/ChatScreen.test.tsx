// ---------------------------------------------------------------------------
// Tests — ChatScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { act, cleanup, render, fireEvent, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { ChatInput } from '../../src/components/chat/ChatInput';
import { ChatScreen } from '../../src/screens/ChatScreen';
import { __resetAgentRunCancellationRegistryForTests } from '../../src/services/agents/agentRunCancellation';

const mockPersonas = [
  {
    id: 'default',
    name: 'Assistant',
    description: 'General-purpose helpful AI assistant',
    systemPrompt: 'default prompt',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Programming and software development expert',
    systemPrompt: 'coder prompt',
  },
];

// Mock navigation
const mockOpenDrawer = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    openDrawer: mockOpenDrawer,
    navigate: jest.fn(),
    goBack: jest.fn(),
    closeDrawer: jest.fn(),
  }),
  useIsFocused: () => true,
  useRoute: () => ({ params: {} }),
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../src/components/chat/MessageBubble', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  const getResponseSegmentSnapshots = (responseSegments?: any[]) =>
    (responseSegments ?? []).map((segment) => segment?.subAgentEvent?.snapshot).filter(Boolean);

  const humanizeToolName = (value?: string) => {
    if (!value) {
      return '';
    }

    return value
      .split('_')
      .filter(Boolean)
      .map((segment: string) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  };

  const getActivePhaseTitle = (agentRun?: any) => {
    const activePhase = agentRun?.phases?.find((phase: any) => phase.status === 'active');
    if (activePhase?.title) {
      return activePhase.title;
    }

    if (typeof agentRun?.currentPhase === 'string' && agentRun.currentPhase.length > 0) {
      return agentRun.currentPhase.charAt(0).toUpperCase() + agentRun.currentPhase.slice(1);
    }

    return undefined;
  };

  const getLastToolName = (message: any, agentRun?: any) => {
    const checkpoints = Array.isArray(agentRun?.checkpoints)
      ? [...agentRun.checkpoints].reverse()
      : [];
    const lastToolCheckpoint = checkpoints.find(
      (checkpoint: any) =>
        typeof checkpoint?.title === 'string' && checkpoint.title.startsWith('Tool started: '),
    );
    const checkpointTool = lastToolCheckpoint?.title?.replace('Tool started: ', '');
    const messageTool =
      Array.isArray(message?.toolCalls) && message.toolCalls.length > 0
        ? message.toolCalls[message.toolCalls.length - 1]?.name
        : undefined;

    return checkpointTool || messageTool || undefined;
  };

  const pushText = (nodes: any[], seen: Set<string>, value: unknown, keyPrefix: string) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    nodes.push(React.createElement(Text, { key: `${keyPrefix}-${nodes.length}` }, normalized));
  };

  const MessageBubble = ({
    message,
    agentRun,
    isStreaming,
    responseSegments,
    onEdit,
    onRetry,
    onShareWorkspaceFile,
    onOpenSubAgentDetails,
  }: any) => {
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const nodes: any[] = [];
    const seen = new Set<string>();
    const responseSegmentSnapshots = getResponseSegmentSnapshots(responseSegments);
    const baseSnapshot =
      responseSegmentSnapshots[responseSegmentSnapshots.length - 1] ||
      message?.subAgentEvent?.snapshot;
    const liveSnapshot = baseSnapshot?.sessionId
      ? mockActiveSubAgents.find(
          (candidate: any) => candidate?.sessionId === baseSnapshot.sessionId,
        )
      : undefined;
    const snapshot = liveSnapshot || baseSnapshot;
    const shareableAttachment = Array.isArray(message?.attachments)
      ? message.attachments.find(
          (attachment: any) =>
            typeof attachment?.workspacePath === 'string' && attachment.workspacePath.length > 0,
        )
      : undefined;

    if (isStreaming) {
      nodes.push(
        React.createElement(
          View,
          {
            key: 'streaming',
            testID: 'message-bubble-streaming',
            accessibilityLabel: 'Assistant is typing',
          },
          React.createElement(Text, null, 'Working on it'),
        ),
      );
    }

    pushText(nodes, seen, message?.content, 'message');

    for (const segment of responseSegments ?? []) {
      pushText(nodes, seen, segment?.text, 'segment-text');
      pushText(nodes, seen, segment?.content, 'segment-content');
      pushText(nodes, seen, segment?.reasoning, 'segment-reasoning');
      pushText(nodes, seen, segment?.subAgentEvent?.snapshot?.name, 'segment-sub-agent-name');
      pushText(
        nodes,
        seen,
        segment?.subAgentEvent?.snapshot?.currentActivity,
        'segment-sub-agent-activity',
      );
      pushText(
        nodes,
        seen,
        segment?.subAgentEvent?.snapshot?.activeToolName,
        'segment-sub-agent-tool',
      );
    }

    for (const toolCall of message?.toolCalls ?? []) {
      pushText(nodes, seen, humanizeToolName(toolCall?.name), 'tool-human');
    }

    pushText(nodes, seen, snapshot?.name, 'snapshot-name');
    pushText(nodes, seen, snapshot?.currentActivity, 'snapshot-activity');
    pushText(nodes, seen, snapshot?.activeToolName, 'snapshot-tool');

    if (agentRun) {
      const activePhaseTitle = getActivePhaseTitle(agentRun);
      const lastToolName = getLastToolName(message, agentRun);
      const pilotAction = agentRun?.latestPilotEvaluation?.controlAction;
      const pilotLabel = pilotAction
        ? `${pilotAction.charAt(0).toUpperCase()}${pilotAction.slice(1)}`
        : null;

      nodes.push(
        React.createElement(
          View,
          { key: 'workflow', testID: 'agent-workflow-widget' },
          React.createElement(Text, null, 'Agent workflow'),
          pilotLabel
            ? React.createElement(
                View,
                { testID: 'agent-workflow-pilot-chip' },
                React.createElement(Text, null, `Pilot: ${pilotLabel}`),
              )
            : null,
          React.createElement(
            View,
            { testID: 'agent-workflow-status' },
            activePhaseTitle ? React.createElement(Text, null, `Stage: ${activePhaseTitle}`) : null,
          ),
          lastToolName
            ? React.createElement(Text, null, `Last tool: ${humanizeToolName(lastToolName)}`)
            : null,
          typeof agentRun?.summary?.assistantTurns === 'number'
            ? React.createElement(Text, null, `Turn ${agentRun.summary.assistantTurns}`)
            : null,
          React.createElement(
            TouchableOpacity,
            {
              testID: 'agent-workflow-toggle',
              onPress: () => setDetailsOpen((open: boolean) => !open),
            },
            React.createElement(Text, null, 'Toggle workflow'),
          ),
          detailsOpen
            ? React.createElement(
                View,
                { testID: 'agent-workflow-details' },
                agentRun?.latestPilotEvaluation
                  ? React.createElement(
                      View,
                      { testID: 'agent-workflow-pilot-section' },
                      React.createElement(Text, null, `Action: ${pilotLabel}`),
                      React.createElement(
                        Text,
                        null,
                        `Confidence: ${agentRun.latestPilotEvaluation.confidence.charAt(0).toUpperCase()}${agentRun.latestPilotEvaluation.confidence.slice(1)}`,
                      ),
                      React.createElement(
                        Text,
                        null,
                        `Score: ${agentRun.latestPilotEvaluation.overallScore}/${agentRun.latestPilotEvaluation.maxOverallScore}`,
                      ),
                      agentRun.latestPilotEvaluation.summary
                        ? React.createElement(Text, null, agentRun.latestPilotEvaluation.summary)
                        : null,
                    )
                  : null,
                React.createElement(View, { testID: 'agent-workflow-phase-plan' }),
                React.createElement(View, { testID: 'agent-workflow-timeline' }),
                agentRun?.plan?.objective
                  ? React.createElement(Text, null, agentRun.plan.objective)
                  : null,
                agentRun?.latestSummary
                  ? React.createElement(Text, null, agentRun.latestSummary)
                  : null,
                Array.isArray(agentRun?.plan?.successCriteria) &&
                  agentRun.plan.successCriteria.length
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(Text, null, 'Success criteria'),
                      ...agentRun.plan.successCriteria.map((criterion: string, index: number) =>
                        React.createElement(Text, { key: `success-${index}` }, criterion),
                      ),
                    )
                  : null,
                Array.isArray(agentRun?.plan?.stopConditions) && agentRun.plan.stopConditions.length
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(Text, null, 'Stop conditions'),
                      ...agentRun.plan.stopConditions.map((condition: string, index: number) =>
                        React.createElement(Text, { key: `stop-${index}` }, condition),
                      ),
                    )
                  : null,
                Array.isArray(agentRun?.plan?.workstreams) && agentRun.plan.workstreams.length
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement(Text, null, 'Workstreams'),
                      ...agentRun.plan.workstreams.map((workstream: any, index: number) =>
                        React.createElement(
                          Text,
                          { key: `workstream-${index}` },
                          `${workstream.title} — ${workstream.goal}`,
                        ),
                      ),
                    )
                  : null,
                ...(agentRun?.checkpoints ?? []).flatMap((checkpoint: any, index: number) => {
                  const checkpointNodes = [];
                  if (checkpoint?.title) {
                    checkpointNodes.push(
                      React.createElement(
                        Text,
                        { key: `checkpoint-title-${index}` },
                        checkpoint.title,
                      ),
                    );
                  }
                  if (checkpoint?.detail) {
                    checkpointNodes.push(
                      React.createElement(
                        Text,
                        { key: `checkpoint-detail-${index}` },
                        checkpoint.detail,
                      ),
                    );
                  }
                  return checkpointNodes;
                }),
                typeof agentRun?.summary?.assistantTurns === 'number'
                  ? React.createElement(Text, null, `Turns ${agentRun.summary.assistantTurns}`)
                  : null,
              )
            : null,
        ),
      );
    }

    if (message?.role === 'assistant' && isStreaming && nodes.length === 0) {
      nodes.push(
        React.createElement(View, {
          key: 'typing-indicator',
          accessibilityLabel: 'Assistant is typing',
        }),
      );
    }

    if (snapshot) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'sub-agent-open-details',
            testID: 'sub-agent-open-details',
            onPress: () => onOpenSubAgentDetails?.(snapshot),
          },
          React.createElement(Text, null, snapshot.name || 'Worker details'),
        ),
      );
    }

    if (onEdit && message?.role !== 'assistant' && message?.role !== 'tool') {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'edit',
            onPress: () => onEdit?.(message.id, message.content),
          },
          React.createElement(View, { testID: 'icon-Edit2' }),
        ),
      );
    }

    if (message?.role === 'assistant' && onRetry) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'retry',
            onPress: () => onRetry(message.id),
          },
          React.createElement(View, { testID: 'icon-RotateCcw' }),
        ),
      );
    }

    if (shareableAttachment && onShareWorkspaceFile) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'share-workspace-file',
            testID: 'message-bubble-share-workspace-file',
            onPress: () => onShareWorkspaceFile(shareableAttachment),
          },
          React.createElement(Text, null, 'Share workspace file'),
        ),
      );
    }

    return React.createElement(View, null, ...nodes);
  };

  return { MessageBubble };
});

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      dangerSoft: '#300',
      userBubble: '#060',
      assistantBubble: '#111',
      codeBackground: '#000',
      link: '#0f0',
      toolCard: '#111',
      toolCardHeader: '#222',
      inputBackground: '#222',
      inputBorder: '#444',
      overlay: 'rgba(0,0,0,0.5)',
    },
  }),
  AppPalette: {},
}));

// Mock stores
const mockAddMessage = jest.fn();
const mockUpdateMessage = jest.fn();
const mockUpdateMessageEnrichedContent = jest.fn();
const mockCreateConversation = jest.fn().mockReturnValue('new-conv');
const mockSetLoading = jest.fn();
const mockEditMessage = jest.fn();
const mockUpdateModelInConversation = jest.fn();
const mockSetActiveProviderAndModel = jest.fn();
const mockSetLastUsedModel = jest.fn();
const mockUpdateMessageReasoning = jest.fn();
const mockUpdateMessageProviderReplay = jest.fn();
const mockUpdateMessageAssistantMetadata = jest.fn();
const mockAddToolCall = jest.fn();
const mockUpdateToolCallStatus = jest.fn();
const mockUpdateMessageEffect = jest.fn();
const mockUpdatePersonaInConversation = jest.fn();
const mockUpdateModeInConversation = jest.fn();
const mockRecordConversationUsage = jest.fn();
const mockAddConversationLog = jest.fn();
const mockStartAgentRun = jest.fn();
const mockSetAgentRunPhase = jest.fn();
const mockAppendAgentRunCheckpoint = jest.fn();
const mockUpdateAgentRunSummary = jest.fn();
const mockUpdateAgentRunPendingAsyncOperations = jest.fn();
const mockUpdateAgentRunPlan = jest.fn();
const mockUpdateAgentRunPilotEvaluation = jest.fn();
const mockSetAgentRunAwaitingBackgroundWorkers = jest.fn();
const mockCompleteAgentRun = jest.fn();
const mockRecordAgentRunEvidence = jest.fn();

const createDefaultConversations = (): any[] => [
  {
    id: 'conv1',
    title: 'Test Chat',
    messages: [
      { id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'msg2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
    ] as any[],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    providerId: 'openai',
    model: 'gpt-5.4',
    systemPrompt: 'You are helpful',
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      totalCalls: 0,
    },
    logs: [] as any[],
    agentRuns: [] as any[],
  },
];

const createRunningAgentRun = (overrides: Partial<any> = {}): any => ({
  id: 'run-1',
  userMessageId: 'msg-user-tool',
  goal: 'Complete the current task.',
  status: 'running',
  awaitingBackgroundWorkers: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  currentPhase: 'work',
  phases: [] as any[],
  checkpoints: [] as any[],
  summary: {
    assistantTurns: 1,
    startedTools: 1,
    completedTools: 1,
    failedTools: 0,
    spawnedSubAgents: 0,
  },
  ...overrides,
});

const createStructuredPlan = (overrides: Partial<any> = {}): any => ({
  objective: 'Complete the current task.',
  successCriteria: ['Deliver the result', 'Verify the result'],
  stopConditions: ['Blocked'],
  workstreams: [
    {
      id: 'workstream-1',
      title: 'Implement the fix',
    },
    {
      id: 'workstream-2',
      title: 'Verify the fix',
      dependencies: ['workstream-1'],
    },
  ],
  updatedAt: 1_700_000_000_100,
  ...overrides,
});

const buildMockPilotEvaluation = (overrides: Partial<any> = {}) => ({
  evaluatorVersion: 'pilot-v2',
  evaluatedAt: nextMockTimestamp(),
  objective: 'Complete the current task.',
  completionScore: 5,
  adherenceScore: 4,
  evidenceScore: 4,
  processScore: 4,
  overallScore: 17,
  maxOverallScore: 20,
  approvalThreshold: 16,
  approved: true,
  recommendedAction: 'finalize',
  controlAction: 'accept',
  confidence: 'high',
  summary: 'Pilot approved finalization.',
  rationale: 'The run satisfied the objective with verified evidence.',
  strengths: ['Verified evidence captured.'],
  gaps: [],
  nextActions: [],
  criterionEvaluations: [
    {
      criterion: 'Produce the requested deliverable.',
      score: 5,
      maxScore: 5,
      status: 'met',
      rationale: 'The deliverable is present.',
    },
    {
      criterion: 'Verify the result before finalizing.',
      score: 4,
      maxScore: 5,
      status: 'met',
      rationale: 'The result is verified enough for delivery.',
    },
  ],
  ...overrides,
});

let mockConversations = createDefaultConversations();

const getMockConversations = () => mockConversations;

let mockActiveConvId: string | null = 'conv1';
let mockLoadingState = false;
let mockActiveProviderId: string | null = 'openai';
let mockActiveModel: string | null = 'gpt-5.4';
let mockThinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium';
let mockDefaultConversationMode: 'agentic' | 'direct' = 'agentic';
let mockProvidersList: any[] = [
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
let mockTimestamp = 1_700_100_000_000;

function nextMockTimestamp() {
  mockTimestamp += 1;
  return mockTimestamp;
}

function updateMockConversation(conversationId: string, updater: (conversation: any) => any) {
  mockConversations = mockConversations.map((conversation) =>
    conversation.id === conversationId ? updater(conversation) : conversation,
  );
}

function updateMockAgentRun(
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

function upsertMockToolCall(toolCalls: any[] | undefined, toolCall: any) {
  const existingToolCalls = toolCalls ?? [];
  const existingIndex = existingToolCalls.findIndex((candidate) => candidate.id === toolCall.id);

  if (existingIndex < 0) {
    return [...existingToolCalls, toolCall];
  }

  return existingToolCalls.map((candidate, index) =>
    index === existingIndex ? { ...candidate, ...toolCall } : candidate,
  );
}

jest.mock('../../src/store/useChatStore', () => {
  const getState = () => ({
    conversations: getMockConversations(),
    activeConversationId: mockActiveConvId,
    isLoading: mockLoadingState,
    createConversation: mockCreateConversation,
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
    updateAgentRunPendingAsyncOperations: mockUpdateAgentRunPendingAsyncOperations,
    updateAgentRunPlan: mockUpdateAgentRunPlan,
    updateAgentRunPilotEvaluation: mockUpdateAgentRunPilotEvaluation,
    setAgentRunAwaitingBackgroundWorkers: mockSetAgentRunAwaitingBackgroundWorkers,
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
      providers: mockProvidersList,
      activeProviderId: mockActiveProviderId,
      activeModel: mockActiveModel,
      thinkingLevel: mockThinkingLevel,
      systemPrompt: 'You are helpful',
      linkUnderstandingEnabled: true,
      mediaUnderstandingEnabled: true,
      maxLinks: 3,
      defaultConversationMode: mockDefaultConversationMode,
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

const mockGetProviderApiKey = jest.fn().mockResolvedValue('sk-test');
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

const mockCollectAgentRunFinalizationEvidence = jest.fn();
const mockBuildAgentRunToolResultFallback = jest.fn();
const mockBuildAgentRunVisibleDraftRecoveryText = jest.fn();
const mockBuildMissingFinalResponseFallback = jest.fn();
const mockCanRecoverAgentRunFinalResponse = jest.fn();
const mockHasCompletedExecutionRecoveryEvidence = jest.fn();
const mockHasVerifiedFinalizationEvidence = jest.fn();
const mockSynthesizeAgentRunFinalAnswer = jest.fn();
jest.mock('../../src/services/agents/agentRunFinalization', () => ({
  collectAgentRunFinalizationEvidence: (...args: any[]) =>
    mockCollectAgentRunFinalizationEvidence(...args),
  buildAgentRunToolResultFallback: (...args: any[]) => mockBuildAgentRunToolResultFallback(...args),
  buildAgentRunVisibleDraftRecoveryText: (...args: any[]) =>
    mockBuildAgentRunVisibleDraftRecoveryText(...args),
  buildMissingFinalResponseFallback: (...args: any[]) =>
    mockBuildMissingFinalResponseFallback(...args),
  canRecoverAgentRunFinalResponse: (...args: any[]) => mockCanRecoverAgentRunFinalResponse(...args),
  hasCompletedExecutionRecoveryEvidence: (...args: any[]) =>
    mockHasCompletedExecutionRecoveryEvidence(...args),
  hasVerifiedFinalizationEvidence: (...args: any[]) => mockHasVerifiedFinalizationEvidence(...args),
  synthesizeAgentRunFinalAnswer: (...args: any[]) => mockSynthesizeAgentRunFinalAnswer(...args),
}));

const mockEvaluateAgentRunWithPilot = jest.fn();
jest.mock('../../src/services/agents/agentWorkflowPilot', () => {
  const actual = jest.requireActual('../../src/services/agents/agentWorkflowPilot');
  return {
    ...actual,
    evaluateAgentRunWithPilot: (...args: any[]) => mockEvaluateAgentRunWithPilot(...args),
  };
});

let mockSubAgentListener:
  | ((agent: any, event: 'started' | 'completed' | 'error' | 'cancelled' | 'progress') => void)
  | null = null;
let mockActiveSubAgents: any[] = [];
const mockCancelSubAgent = jest.fn();
jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: jest.fn(() => mockActiveSubAgents),
  cancelSubAgent: (...args: any[]) => mockCancelSubAgent(...args),
  onSubAgentEvent: jest.fn((listener: any) => {
    mockSubAgentListener = listener;
    return () => {
      if (mockSubAgentListener === listener) {
        mockSubAgentListener = null;
      }
    };
  }),
}));

const mockRunOrchestrator = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: any[]) => mockRunOrchestrator(...args),
}));

const mockExportConversationAsMarkdown = jest.fn().mockReturnValue('# Exported');
jest.mock('../../src/services/session/manager', () => ({
  exportConversationAsMarkdown: (...args: any[]) => mockExportConversationAsMarkdown(...args),
}));

const mockShareTextExport = jest.fn().mockResolvedValue({
  fileName: 'Test_Chat.md',
  fileUri: 'file:///cache/test.md',
});
const mockShareConversationWorkspaceFile = jest.fn().mockResolvedValue({
  fileName: 'workspace.txt',
  fileUri: 'file:///docs/workspace.txt',
});
const mockImportConversationWorkspaceAttachment = jest.fn();
jest.mock('../../src/services/share/localShare', () => ({
  shareTextExport: (...args: any[]) => mockShareTextExport(...args),
  shareConversationWorkspaceFile: (...args: any[]) => mockShareConversationWorkspaceFile(...args),
}));

jest.mock('../../src/services/conversationWorkspace/files', () => ({
  importConversationWorkspaceAttachment: (...args: any[]) =>
    mockImportConversationWorkspaceAttachment(...args),
}));

const mockShareAsync = jest.fn().mockResolvedValue(undefined);
const mockIsAvailableAsync = jest.fn().mockResolvedValue(true);
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: any[]) => mockShareAsync(...args),
  isAvailableAsync: (...args: any[]) => mockIsAvailableAsync(...args),
}));

const mockFileWrite = jest.fn();
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((_dir: string, _name: string) => ({
    uri: 'file:///cache/test.md',
    write: mockFileWrite,
  })),
  Paths: { cache: '/cache', document: '/docs' },
}));

// Mock ApprovalBanner to avoid needing full approval store
jest.mock('../../src/components/approval/ApprovalBanner', () => ({
  ApprovalBanner: () => null,
}));

describe('ChatScreen', () => {
  const memoizedChatInputType = (ChatInput as any).type || ChatInput;

  afterEach(() => {
    cleanup();

    try {
      jest.useRealTimers();
    } catch {
      // Ignore when the environment is already using real timers.
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAgentRunCancellationRegistryForTests();
    mockSubAgentListener = null;
    mockActiveSubAgents = [];
    mockConversations = createDefaultConversations();
    mockActiveConvId = 'conv1';
    mockLoadingState = false;
    mockActiveProviderId = 'openai';
    mockActiveModel = 'gpt-5.4';
    mockThinkingLevel = 'medium';
    mockDefaultConversationMode = 'agentic';
    mockProvidersList = [
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
    mockTimestamp = 1_700_100_000_000;
    mockGetProviderApiKey.mockResolvedValue('sk-test');
    mockRunOrchestrator.mockResolvedValue(undefined);
    mockImportConversationWorkspaceAttachment.mockReset();
    mockImportConversationWorkspaceAttachment.mockImplementation(
      async (_conversationId: string, attachment: any) => ({
        imported: true,
        attachment,
      }),
    );
    mockStartAgentRun.mockReturnValue('run-1');
    mockAddMessage.mockImplementation((conversationId: string, message: any) => {
      updateMockConversation(conversationId, (conversation) => {
        const timestamp = message.timestamp ?? nextMockTimestamp();
        return {
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              ...message,
              id: message.id ?? `msg-${timestamp}`,
              timestamp,
            },
          ],
          updatedAt: timestamp,
        };
      });
    });
    mockUpdateMessage.mockImplementation(
      (conversationId: string, messageId: string, content: string) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, content } : message,
          ),
        }));
      },
    );
    mockUpdateMessageReasoning.mockImplementation(
      (conversationId: string, messageId: string, reasoning: string) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, reasoning } : message,
          ),
        }));
      },
    );
    mockUpdateMessageProviderReplay.mockImplementation(
      (conversationId: string, messageId: string, providerReplay: any) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, providerReplay } : message,
          ),
        }));
      },
    );
    mockUpdateMessageAssistantMetadata.mockImplementation(
      (conversationId: string, messageId: string, assistantMetadata: any) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, assistantMetadata } : message,
          ),
        }));
      },
    );
    mockUpdateMessageEffect.mockImplementation(
      (conversationId: string, messageId: string, effectId: string) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) =>
            message.id === messageId ? { ...message, effectId } : message,
          ),
        }));
      },
    );
    mockAddToolCall.mockImplementation(
      (conversationId: string, messageId: string, toolCall: any) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) => {
            if (message.id !== messageId) {
              return message;
            }

            return {
              ...message,
              toolCalls: upsertMockToolCall(message.toolCalls, toolCall),
            };
          }),
        }));
      },
    );
    mockUpdateToolCallStatus.mockImplementation(
      (
        conversationId: string,
        messageId: string,
        toolCallId: string,
        status: string,
        payload?: { result?: string; error?: string; completedAt?: number; progressText?: string },
      ) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message: any) => {
            if (message.id !== messageId) {
              return message;
            }

            return {
              ...message,
              toolCalls: (message.toolCalls ?? []).map((toolCall: any) =>
                toolCall.id === toolCallId
                  ? {
                      ...toolCall,
                      status,
                      result: payload?.result ?? toolCall.result,
                      error: payload?.error ?? toolCall.error,
                      completedAt: payload?.completedAt ?? toolCall.completedAt,
                      progressText: payload?.progressText ?? toolCall.progressText,
                    }
                  : toolCall,
              ),
            };
          }),
        }));
      },
    );
    mockCollectAgentRunFinalizationEvidence.mockImplementation(
      (_messages: any[], _userMessageId: string, iterations: number) => ({
        originalPrompt: 'Test task',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: '',
        lastSubstantiveResult: '',
        resultPreviews: [
          { sourceName: 'sessions_spawn', preview: 'Worker launched successfully.' },
        ],
        toolsUsed: ['sessions_spawn'],
        iterations,
      }),
    );
    mockHasVerifiedFinalizationEvidence.mockImplementation(
      (evidence: any) =>
        !!evidence?.lastSubstantiveResult ||
        (evidence?.resultPreviews?.length ?? 0) > 0 ||
        (evidence?.toolsUsed?.length ?? 0) > 0,
    );
    mockBuildAgentRunToolResultFallback.mockImplementation(
      ({ status }: { status: string }) => `Fallback final response (${status})`,
    );
    mockBuildAgentRunVisibleDraftRecoveryText.mockImplementation(
      ({ visibleDraft, status, evidence }: any) => {
        const fallback = mockBuildAgentRunToolResultFallback({ status, evidence });
        if (visibleDraft.includes('Note: the response stream failed before the answer could finish.')) {
          return visibleDraft;
        }
        return fallback
          ? `${visibleDraft}\n\nNote: the response stream failed before the answer could finish.\n${fallback}`
          : `${visibleDraft}\n\nNote: the response stream failed before the answer could finish.`;
      },
    );
    mockBuildMissingFinalResponseFallback.mockImplementation(
      (status: string) => `Missing final response (${status})`,
    );
    mockCanRecoverAgentRunFinalResponse.mockImplementation(
      ({ evidence, hasProviderContext }: any) =>
        !!evidence?.lastSubstantiveResult ||
        (evidence?.resultPreviews?.length ?? 0) > 0 ||
        (evidence?.toolsUsed?.length ?? 0) > 0 ||
        (hasProviderContext && !!evidence?.lastNonEmptyAssistantContent?.trim?.()),
    );
    mockHasCompletedExecutionRecoveryEvidence.mockImplementation(
      ({ evidence, pendingAsyncOperationCount, liveSubAgentSnapshots }: any) =>
        !evidence?.hasIncompleteToolCalls &&
        (pendingAsyncOperationCount ?? 0) === 0 &&
        !(liveSubAgentSnapshots ?? []).some((snapshot: any) => snapshot.status === 'running') &&
        (!!evidence?.lastSubstantiveResult || (evidence?.resultPreviews?.length ?? 0) > 0),
    );
    mockSetAgentRunPhase.mockImplementation(
      (conversationId: string, phase: string, params?: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          currentPhase: phase,
          updatedAt: params?.timestamp ?? run.updatedAt,
          latestSummary: params?.detail ?? run.latestSummary,
          checkpoints: params?.checkpointTitle
            ? [
                ...(run.checkpoints ?? []),
                {
                  id: `checkpoint-${phase}-${params?.timestamp ?? nextMockTimestamp()}`,
                  timestamp: params?.timestamp ?? nextMockTimestamp(),
                  kind: params?.checkpointKind ?? 'phase',
                  title: params.checkpointTitle,
                  detail: params?.checkpointDetail ?? params?.detail,
                },
              ]
            : run.checkpoints,
        }));
      },
    );
    mockUpdateAgentRunSummary.mockImplementation(
      (conversationId: string, patch: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          updatedAt: patch?.timestamp ?? run.updatedAt,
          latestSummary: patch?.latestSummary ?? run.latestSummary,
          summary: {
            ...run.summary,
            ...patch,
          },
        }));
      },
    );
    mockUpdateAgentRunPendingAsyncOperations.mockImplementation(
      (conversationId: string, operations: any[], params?: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          updatedAt: params?.timestamp ?? run.updatedAt,
          latestSummary: params?.latestSummary ?? run.latestSummary,
          pendingAsyncOperations: operations,
        }));
      },
    );
    mockUpdateAgentRunPlan.mockImplementation(
      (conversationId: string, patch: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          updatedAt: patch?.timestamp ?? run.updatedAt,
          plan: {
            ...(run.plan ?? {}),
            ...patch,
          },
        }));
      },
    );
    mockUpdateAgentRunPilotEvaluation.mockImplementation(
      (conversationId: string, evaluation: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          updatedAt: evaluation?.evaluatedAt ?? run.updatedAt,
          latestPilotEvaluation: evaluation,
        }));
      },
    );
    mockRecordAgentRunEvidence.mockImplementation(
      (conversationId: string, entries: any, params?: any, runId?: string) => {
        const draftEntries = Array.isArray(entries) ? entries : [entries];
        let recordedEntries: any[] | undefined;

        updateMockAgentRun(conversationId, runId, (run: any) => {
          const nextEvidence = [...(run.evidence ?? []), ...draftEntries].map(
            (entry: any, index: number) => ({
              ...entry,
              id: entry?.id ?? `evidence-${index}-${params?.timestamp ?? nextMockTimestamp()}`,
            }),
          );
          recordedEntries = nextEvidence;

          return {
            ...run,
            updatedAt: params?.timestamp ?? run.updatedAt,
            evidence: nextEvidence,
          };
        });

        return recordedEntries;
      },
    );
    mockSetAgentRunAwaitingBackgroundWorkers.mockImplementation(
      (conversationId: string, awaiting: boolean, params?: any, runId?: string) => {
        updateMockAgentRun(conversationId, runId, (run: any) => ({
          ...run,
          awaitingBackgroundWorkers: awaiting,
          updatedAt: params?.timestamp ?? run.updatedAt,
          latestSummary: params?.latestSummary ?? run.latestSummary,
          checkpoints: params?.checkpointTitle
            ? [
                ...(run.checkpoints ?? []),
                {
                  id: `checkpoint-await-${params?.timestamp ?? nextMockTimestamp()}`,
                  timestamp: params?.timestamp ?? nextMockTimestamp(),
                  kind: params?.checkpointKind ?? 'run',
                  title: params.checkpointTitle,
                  detail: params?.checkpointDetail ?? params?.latestSummary,
                },
              ]
            : run.checkpoints,
        }));
      },
    );
    mockCompleteAgentRun.mockImplementation(
      (conversationId: string, params?: any, runId?: string) => {
        updateMockConversation(conversationId, (conversation) => {
          const targetRunId = runId || conversation.activeAgentRunId;
          if (!targetRunId) {
            return conversation;
          }

          return {
            ...conversation,
            activeAgentRunId:
              conversation.activeAgentRunId === targetRunId
                ? undefined
                : conversation.activeAgentRunId,
            agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
              run.id !== targetRunId
                ? run
                : {
                    ...run,
                    status: params?.status ?? 'completed',
                    awaitingBackgroundWorkers: false,
                    pendingAsyncOperations: undefined,
                    updatedAt: params?.timestamp ?? run.updatedAt,
                    latestSummary: params?.latestSummary ?? run.latestSummary,
                    checkpoints: params?.checkpointTitle
                      ? [
                          ...(run.checkpoints ?? []),
                          {
                            id: `checkpoint-complete-${params?.timestamp ?? nextMockTimestamp()}`,
                            timestamp: params?.timestamp ?? nextMockTimestamp(),
                            kind: params?.checkpointKind ?? 'run',
                            title: params.checkpointTitle,
                            detail: params?.checkpointDetail ?? params?.latestSummary,
                          },
                        ]
                      : run.checkpoints,
                  },
            ),
          };
        });
      },
    );
    mockSynthesizeAgentRunFinalAnswer.mockResolvedValue({
      output: 'Synthesized final response',
      providerReplay: {
        openaiResponseOutput: [
          { id: 'final-output', type: 'message', role: 'assistant', content: [] },
        ],
      },
    });
    mockEvaluateAgentRunWithPilot.mockImplementation(async (params: any) => ({
      action: 'finalize',
      outcome: params.candidateOutcome ?? {
        status: 'completed',
        summary: 'Pilot approved finalization.',
      },
      checkpointTitle:
        params.candidateOutcome?.status === 'completed'
          ? 'Pilot approved finalization'
          : 'Pilot finalized with remaining gaps',
      checkpointDetail:
        params.candidateOutcome?.status === 'completed'
          ? 'Pilot score 17/20. Approved.'
          : 'Pilot score 8/20. Finalized with remaining gaps.',
      evaluation:
        params.candidateOutcome?.status === 'completed'
          ? buildMockPilotEvaluation()
          : buildMockPilotEvaluation({
              completionScore: 1,
              adherenceScore: 2,
              evidenceScore: 1,
              processScore: 2,
              overallScore: 6,
              approved: false,
              recommendedAction: 'blocked',
              confidence: 'medium',
              summary: 'Pilot did not approve finalization.',
              rationale: 'The run ended unsuccessfully.',
              strengths: [],
              gaps: ['The run ended unsuccessfully.'],
              criterionEvaluations: [
                {
                  criterion: 'Produce the requested deliverable.',
                  score: 1,
                  maxScore: 5,
                  status: 'blocked',
                  rationale: 'No usable deliverable was produced.',
                },
                {
                  criterion: 'Verify the result before finalizing.',
                  score: 1,
                  maxScore: 5,
                  status: 'blocked',
                  rationale: 'The run ended before verification.',
                },
              ],
            }),
    }));
  });

  it('should render the chat screen', () => {
    const { getByText } = render(<ChatScreen />);
    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Hi there!')).toBeTruthy();
  });

  it('should show empty state when no conversation active', () => {
    mockActiveConvId = null;
    const { getByText } = render(<ChatScreen />);
    expect(getByText('Kavi')).toBeTruthy();
    expect(getByText('Start a new conversation')).toBeTruthy();
  });

  it('should open drawer when menu is pressed', () => {
    const { getByTestId } = render(<ChatScreen />);
    const menuIcon = getByTestId('icon-Menu');
    fireEvent.press(menuIcon.parent || menuIcon);
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('should render the model selector', () => {
    const { getByText } = render(<ChatScreen />);
    expect(getByText('gpt-5.4')).toBeTruthy();
  });

  it('should render the telemetry strip and toggle logs panel', () => {
    const { getByTestId, getByText } = render(<ChatScreen />);

    expect(getByTestId('chat-usage-strip')).toBeTruthy();
    expect(getByText('No usage yet for this conversation.')).toBeTruthy();

    fireEvent.press(getByTestId('chat-logs-toggle'));

    expect(getByTestId('chat-logs-panel')).toBeTruthy();
    expect(getByText('No logs yet.')).toBeTruthy();
  });

  it('should render the full log history inside a scrollable panel', () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        logs: Array.from({ length: 15 }, (_value, index) => ({
          id: `log-${index + 1}`,
          timestamp: 1_700_000_000_000 + index,
          level: 'info',
          kind: 'system',
          title: `Log ${index + 1}`,
          detail: `Detail ${index + 1}`,
        })),
      },
    ];

    const { getByTestId, getByText } = render(<ChatScreen />);

    fireEvent.press(getByTestId('chat-logs-toggle'));

    expect(getByTestId('chat-logs-panel')).toBeTruthy();
    expect(getByTestId('chat-logs-scroll')).toBeTruthy();
    expect(getByText('15/15')).toBeTruthy();
    expect(getByText('Log 1')).toBeTruthy();
    expect(getByText('Log 15')).toBeTruthy();
  });

  it('should render the agent workflow widget inline for persisted agent runs', () => {
    jest.useFakeTimers();

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Audit the repository and apply the fix.',
            status: 'running',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_500,
            currentPhase: 'review',
            latestSummary: 'Still verifying the worker output.',
            latestPilotEvaluation: {
              evaluatorVersion: 'pilot-v1',
              evaluatedAt: 1_700_000_000_450,
              objective: 'Audit the repository and apply the fix.',
              completionScore: 4,
              adherenceScore: 4,
              evidenceScore: 3,
              processScore: 4,
              overallScore: 15,
              maxOverallScore: 20,
              approvalThreshold: 15,
              approved: false,
              recommendedAction: 'continue',
              controlAction: 'continue',
              confidence: 'medium',
              summary: 'Continue autonomously while verifying the worker output.',
              rationale:
                'The workflow has strong progress, but the final verification is still pending.',
              strengths: ['The repository state is already captured.'],
              gaps: ['The final verification pass has not finished yet.'],
              nextActions: ['Run the final verification pass.'],
              criterionEvaluations: [
                {
                  criterion: 'Verification',
                  score: 3,
                  maxScore: 5,
                  status: 'partial',
                  rationale: 'Verification is still in progress.',
                },
              ],
            },
            plan: {
              objective: 'Audit the repository and apply the fix.',
              successCriteria: [
                'The workflow state is persisted.',
                'The workflow card shows the latest timeline.',
              ],
              stopConditions: [
                'Stop when the fix is verified.',
                'Stop if a concrete blocker remains unresolved.',
              ],
              workstreams: [
                {
                  id: 'ws-1',
                  title: 'Repository audit',
                  goal: 'Inspect the current agentic workflow implementation',
                },
                {
                  id: 'ws-2',
                  title: 'UI update',
                  goal: 'Render the workflow card timeline',
                },
              ],
              updatedAt: 1_700_000_000_150,
            },
            summary: {
              assistantTurns: 2,
              startedTools: 2,
              completedTools: 2,
              failedTools: 0,
              spawnedSubAgents: 1,
              durationMs: 12_000,
            },
            phases: [
              { key: 'assess', title: 'Assess', status: 'completed', updatedAt: 1_700_000_000_100 },
              {
                key: 'plan',
                title: 'Plan',
                status: 'completed',
                detail: 'Inspect, patch, and verify.',
                updatedAt: 1_700_000_000_150,
              },
              { key: 'work', title: 'Work', status: 'completed', updatedAt: 1_700_000_000_200 },
              { key: 'review', title: 'Review', status: 'active', updatedAt: 1_700_000_000_400 },
              { key: 'deliver', title: 'Deliver', status: 'pending', updatedAt: 1_700_000_000_500 },
            ],
            checkpoints: [
              {
                id: 'cp-1',
                timestamp: 1_700_000_000_000,
                kind: 'run',
                title: 'Turn started',
                detail: 'Audit the repository and apply the fix.',
              },
              {
                id: 'cp-1b',
                timestamp: 1_700_000_000_100,
                kind: 'tool',
                title: 'Tool started: read_file',
                detail: '{"path":"src/store/useChatStore.ts"}',
              },
              {
                id: 'cp-2',
                timestamp: 1_700_000_000_500,
                kind: 'sub-agent',
                title: 'Worker completed: Backend Architect',
                detail: 'Worker completed the repository scan.',
              },
            ],
          },
        ],
      },
    ];

    try {
      const { getAllByText, getByTestId, getByText, queryByTestId, queryByText } = render(
        <ChatScreen />,
      );

      act(() => {
        jest.runOnlyPendingTimers();
      });

      expect(queryByTestId('agent-run-card')).toBeNull();
      expect(getByTestId('agent-workflow-widget')).toBeTruthy();
      expect(getByTestId('agent-workflow-status')).toBeTruthy();
      expect(getByTestId('agent-workflow-pilot-chip')).toBeTruthy();
      expect(getByText('Agent workflow')).toBeTruthy();
      expect(getByText('Pilot: Continue')).toBeTruthy();
      expect(getByText('Stage: Review')).toBeTruthy();
      expect(getByText('Last tool: Read File')).toBeTruthy();
      expect(getByText('Turn 2')).toBeTruthy();
      expect(queryByTestId('agent-workflow-details')).toBeNull();
      expect(queryByText('Success criteria')).toBeNull();

      act(() => {
        fireEvent.press(getByTestId('agent-workflow-toggle'));
        jest.runOnlyPendingTimers();
      });

      expect(getByTestId('agent-workflow-details')).toBeTruthy();
      expect(getByTestId('agent-workflow-pilot-section')).toBeTruthy();
      expect(getByTestId('agent-workflow-phase-plan')).toBeTruthy();
      expect(getByTestId('agent-workflow-timeline')).toBeTruthy();
      expect(getAllByText('Audit the repository and apply the fix.').length).toBeGreaterThan(0);
      expect(getAllByText('Still verifying the worker output.').length).toBeGreaterThan(0);
      expect(getByText('Confidence: Medium')).toBeTruthy();
      expect(getByText('Score: 15/20')).toBeTruthy();
      expect(getByText('Continue autonomously while verifying the worker output.')).toBeTruthy();
      expect(getByText('Success criteria')).toBeTruthy();
      expect(getByText(/The workflow state is persisted\./)).toBeTruthy();
      expect(getByText('Stop conditions')).toBeTruthy();
      expect(getByText(/Stop if a concrete blocker remains unresolved\./)).toBeTruthy();
      expect(getByText('Workstreams')).toBeTruthy();
      expect(
        getByText(/Repository audit — Inspect the current agentic workflow implementation/),
      ).toBeTruthy();
      expect(getByText('Tool started: read_file')).toBeTruthy();
      expect(getByText(/Turns 2/)).toBeTruthy();
    } finally {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    }
  });

  it('should toggle conversation mode with mode badge', () => {
    mockActiveConvId = null;
    mockCreateConversation.mockReturnValueOnce('new-conv');

    const { getByLabelText } = render(<ChatScreen />);

    // Default is agentic mode — toggle to direct
    // Accessibility label now includes current mode description
    fireEvent.press(getByLabelText(/Switch to direct mode/));

    expect(mockCreateConversation).toHaveBeenCalledWith('openai', 'You are helpful', 'gpt-5.4', {
      personaId: 'default',
      mode: 'direct',
    });
    // For new conversations (no existing convId), handleToggleMode creates the conversation
    // then uses atomic setState on the new convId
  });

  it('should render message input', () => {
    const { getByPlaceholderText } = render(<ChatScreen />);
    expect(getByPlaceholderText('Message...')).toBeTruthy();
  });

  it('should rely on native keyboard behavior for the chat body', () => {
    const { UNSAFE_getByType, queryByTestId } = render(<ChatScreen />);

    expect(queryByTestId('chat-composer-keyboard-avoider')).toBeNull();
    expect(UNSAFE_getByType(FlatList).props.keyboardShouldPersistTaps).toBeUndefined();
    expect(UNSAFE_getByType(FlatList).props.keyboardDismissMode).toBeUndefined();
  });

  it('should render empty state hint text', () => {
    mockActiveConvId = null;
    const { getByText } = render(<ChatScreen />);
    expect(getByText(/Send a message to get started/)).toBeTruthy();
  });

  it('should send message and trigger orchestrator', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test message');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalled();
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('imports attachments into the workspace before storing the user turn', async () => {
    const attachment = {
      id: 'att-1',
      type: 'file',
      uri: 'file:///inbox/report.pdf',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    };
    mockImportConversationWorkspaceAttachment.mockImplementationOnce(
      async (_conversationId: string, candidate: any) => ({
        imported: true,
        attachment: {
          ...candidate,
          uri: 'file:///docs/workspace/attachments/files/att-1-report.pdf',
          workspacePath: 'attachments/files/att-1-report.pdf',
        },
      }),
    );

    const { UNSAFE_getByType } = render(<ChatScreen />);

    await act(async () => {
      await UNSAFE_getByType(memoizedChatInputType).props.onSend('Review this attachment', [
        attachment,
      ]);
    });

    await waitFor(() => {
      expect(mockImportConversationWorkspaceAttachment).toHaveBeenCalledWith('conv1', attachment);
      expect(mockAddMessage).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          role: 'user',
          content: 'Review this attachment',
          attachments: [
            expect.objectContaining({
              uri: 'file:///docs/workspace/attachments/files/att-1-report.pdf',
              workspacePath: 'attachments/files/att-1-report.pdf',
            }),
          ],
        }),
      );
      expect(mockRunOrchestrator).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
        }),
        expect.any(Object),
      );
    });
  });

  it('shows an error and aborts the send when attachment workspace import fails', async () => {
    mockImportConversationWorkspaceAttachment.mockRejectedValueOnce(new Error('boom'));
    const attachment = {
      id: 'att-2',
      type: 'file',
      uri: 'file:///inbox/broken.pdf',
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      size: 128,
    };

    const { UNSAFE_getByType, findByText } = render(<ChatScreen />);

    await act(async () => {
      await UNSAFE_getByType(memoizedChatInputType).props.onSend('Review this attachment', [
        attachment,
      ]);
    });

    expect(mockAddMessage).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(
      await findByText('Unable to add attached files to the workspace. Try again.'),
    ).toBeTruthy();
  });

  it('should create a new conversation when none is active', async () => {
    mockActiveConvId = null;
    // Return existing conv id so the full handleSend flow works after creation
    mockCreateConversation.mockReturnValueOnce('conv1');
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Hello');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith('openai', 'You are helpful', 'gpt-5.4', {
        personaId: 'super-agent',
        mode: 'agentic',
      });
      expect(mockAddMessage).toHaveBeenCalled();
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('should show error when no provider configured', async () => {
    mockProvidersList = [];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No provider configured/);
    expect(error).toBeTruthy();
  });

  it('should show error when no API key configured', async () => {
    mockGetProviderApiKey.mockResolvedValue('');
    mockProvidersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '', // no embedded key either
        model: 'gpt-5.4',
        enabled: true,
      },
    ];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No API key configured/);
    expect(error).toBeTruthy();
  });

  it('should allow an on-device provider without requiring an API key', async () => {
    mockActiveConvId = null;
    mockActiveProviderId = 'local-gemma';
    mockActiveModel = 'gemma-3-1b-it';
    mockProvidersList = [
      {
        id: 'local-gemma',
        name: 'Gemma (on-device)',
        kind: 'on-device',
        baseUrl: '',
        apiKey: '',
        model: 'gemma-3-1b-it',
        enabled: true,
        availableModels: ['gemma-3-1b-it'],
        local: { runtime: 'mediapipe-genai' },
      },
    ];
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        id: 'conv1',
        providerId: 'local-gemma',
        model: 'gemma-3-1b-it',
      },
    ];
    mockCreateConversation.mockReturnValueOnce('conv1');
    mockGetProviderApiKey.mockResolvedValue('');

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Run locally');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockCreateConversation).toHaveBeenCalledWith(
        'local-gemma',
        'You are helpful',
        'gemma-3-1b-it',
        {
          personaId: 'super-agent',
          mode: 'agentic',
        },
      );
      expect(mockRunOrchestrator).toHaveBeenCalled();
    });
  });

  it('should show error when no model selected', async () => {
    mockActiveModel = null;
    mockProvidersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: '', // no model
        enabled: true,
      },
    ];
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText(/No model selected/);
    expect(error).toBeTruthy();
  });

  it('should call orchestrator with correct callbacks', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Run orchestrator');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    // Verify the callbacks object structure
    const [options, callbacks] = mockRunOrchestrator.mock.calls[0];
    expect(options.provider).toBeDefined();
    expect(options.model).toBe('gpt-5.4');
    expect(options.systemPrompt).toBe('You are helpful');
    expect(typeof callbacks.onToken).toBe('function');
    expect(typeof callbacks.onReasoning).toBe('function');
    expect(typeof callbacks.onAssistantStreamReset).toBe('function');
    expect(typeof callbacks.onUserMessageEnriched).toBe('function');
    expect(typeof callbacks.onToolCallQueued).toBe('function');
    expect(typeof callbacks.onToolCallStart).toBe('function');
    expect(typeof callbacks.onToolCallComplete).toBe('function');
    expect(typeof callbacks.onAssistantMessage).toBe('function');
    expect(typeof callbacks.onToolMessage).toBe('function');
    expect(typeof callbacks.onError).toBe('function');
    expect(typeof callbacks.onDone).toBe('function');
    expect(typeof callbacks.onUsage).toBe('function');
    expect(typeof callbacks.onStateChange).toBe('function');
  });

  it('uses the active selected model when the conversation has no stored model override', async () => {
    mockActiveModel = 'gpt-4o-mini';
    mockProvidersList = [
      {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5.4',
        enabled: true,
        availableModels: ['gpt-5.4', 'gpt-4o-mini'],
      },
    ];
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        providerId: 'openai',
        modelOverride: undefined,
      },
    ];

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Use selected model');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [options] = mockRunOrchestrator.mock.calls[0];
    expect(options.model).toBe('gpt-4o-mini');
  });

  it('passes the selected thinking level into the orchestrator request', async () => {
    mockDefaultConversationMode = 'direct';
    mockThinkingLevel = 'high';

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Use direct mode thinking');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [options] = mockRunOrchestrator.mock.calls[0];
    expect(options.thinkingLevel).toBe('high');
  });

  it('throttles streamed token updates instead of writing every token', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Throttle test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockUpdateMessage.mockClear();

    const { act } = require('@testing-library/react-native');
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        callbacks.onToken('a');
      }
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(0);

    act(() => {
      jest.advanceTimersByTime(40);
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(0);

    act(() => {
      jest.advanceTimersByTime(240);
    });

    expect(mockUpdateMessage).toHaveBeenCalledTimes(1);
    expect(mockUpdateMessage).toHaveBeenLastCalledWith('conv1', expect.any(String), 'aaaaaaaaaaaa');

    jest.useRealTimers();
  });

  it('shows each streamed text token immediately', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Immediate token visibility');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Streaming');
    });

    expect(screen.getByText('Streaming')).toBeTruthy();

    act(() => {
      callbacks.onToken(' answer');
    });

    expect(screen.getByText('Streaming answer')).toBeTruthy();

    jest.useRealTimers();
  });

  it('shows the first visible streamed token immediately after hidden internal prefix tokens', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Hidden prefix handling');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Previous internal tool call: tool_catalog');
      callbacks.onToken(' (category="files").\n');
      jest.advanceTimersByTime(24);
    });

    expect(screen.queryByText(/Previous internal tool call:/)).toBeNull();

    act(() => {
      callbacks.onToken('Visible answer');
    });

    expect(screen.getByText('Visible answer')).toBeTruthy();

    jest.useRealTimers();
  });

  it('does not render a synthetic inline reasoning block before reasoning output arrives', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'No fake thinking');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    expect(screen.queryByTestId('assistant-inline-reasoning')).toBeNull();

    act(() => {
      callbacks.onStateChange('thinking');
    });

    expect(screen.queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(screen.getByLabelText('Assistant is typing')).toBeTruthy();

    jest.useRealTimers();
  });

  it('renders queued tool calls as soon as the assistant schedules them', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Queue the tool');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('Inspecting the repository.', [
        {
          id: 'tc-read',
          name: 'read_file',
          arguments: '{"path":"README.md"}',
          status: 'pending',
        },
      ]);
    });

    expect(screen.getByText('Inspecting the repository.')).toBeTruthy();
    expect(screen.getByText('Read File')).toBeTruthy();
    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({
        id: 'tc-read',
        name: 'read_file',
        status: 'pending',
      }),
    );

    jest.useRealTimers();
  });

  it('renders streamed tool_call events immediately before the assistant turn finalizes', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Show queued tools immediately',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToolCallQueued({
        id: 'tc-read-stream',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
        status: 'pending',
      });
    });

    expect(screen.getByText('Read File')).toBeTruthy();
    expect(mockAddToolCall).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('clears the live streamed draft when the orchestrator resets the current turn', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Reset the current turn');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Discarded answer');
      callbacks.onToolCallQueued({
        id: 'tc-reset',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
        status: 'pending',
      });
    });

    expect(screen.getByText('Discarded answer')).toBeTruthy();
    expect(screen.getByText('Read File')).toBeTruthy();

    act(() => {
      callbacks.onAssistantStreamReset?.();
    });

    expect(screen.queryByText('Discarded answer')).toBeNull();
    expect(screen.queryByText('Read File')).toBeNull();

    jest.useRealTimers();
  });

  it('captures a structured plan from streamed assistant text before tool execution starts', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Capture the plan');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onToken('Objective: Audit the repository\n');
      callbacks.onToken('Success Criteria:\n- Verify the fix\n');
      callbacks.onToken('Workstreams:\n1. Inspect | Goal: Find the root cause');
      jest.advanceTimersByTime(24);
    });

    expect(mockUpdateAgentRunPlan).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        objective: 'Audit the repository',
      }),
      'run-1',
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'plan',
      expect.objectContaining({
        checkpointTitle: 'Plan captured',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('strips internal Gemini tool-history lines before storing assistant content', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Sanitize output');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    mockUpdateMessage.mockClear();
    const { act } = require('@testing-library/react-native');

    act(() => {
      callbacks.onAssistantMessage(
        [
          'Previous internal tool call: tool_catalog (category="files").',
          'Previous internal tool result: tool_catalog returned with structured tool catalog data.',
          'Answer after the failed tool.',
        ].join('\n'),
        [],
      );
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'Answer after the failed tool.',
    );

    jest.useRealTimers();
  });

  it('should invoke orchestrator callbacks correctly', async () => {
    jest.useFakeTimers();
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      const { act } = require('@testing-library/react-native');

      callbacks.onStateChange('running');
      act(() => {
        callbacks.onToken('hello');
        jest.advanceTimersByTime(40);
      });

      expect(mockUpdateMessage).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(240);
      });

      expect(mockUpdateMessage).toHaveBeenCalled();

      act(() => {
        callbacks.onReasoning('thinking...');
        jest.advanceTimersByTime(240);
      });
      expect(mockUpdateMessageReasoning).toHaveBeenCalled();

      callbacks.onUserMessageEnriched('msg1', 'Hello\n\n<link_context>Example</link_context>');
      expect(mockUpdateMessageEnrichedContent).toHaveBeenCalledWith(
        'conv1',
        'msg1',
        'Hello\n\n<link_context>Example</link_context>',
      );

      act(() => {
        callbacks.onToolCallQueued({
          id: 'tc0',
          name: 'inspect',
          arguments: '{}',
          status: 'pending',
        });
      });

      expect(mockAddToolCall).not.toHaveBeenCalled();

      act(() => {
        callbacks.onAssistantMessage(
          [
            'Objective: Hello',
            'Success Criteria:',
            '- Deliver the requested result.',
            'Stop Conditions:',
            '- Stop when verified.',
            'Workstreams:',
            '1. Inspect | Goal: Review the request',
          ].join('\n'),
          [{ id: 'tc1', name: 'test', arguments: '{}', status: 'pending' }],
        );
      });

      act(() => {
        callbacks.onToolCallStart({ id: 'tc1', name: 'test', arguments: '{}', status: 'running' });
      });
      expect(mockAddToolCall).toHaveBeenCalled();

      act(() => {
        callbacks.onToolCallComplete({
          id: 'tc1',
          name: 'test',
          arguments: '{}',
          status: 'completed',
          result: 'ok',
        });
      });
      expect(mockUpdateToolCallStatus).toHaveBeenCalled();

      mockActiveSubAgents = [
        {
          sessionId: 'sub-callback-1',
          parentConversationId: 'conv1',
          agentRunId: 'run-1',
          workstreamId: 'workstream-1',
          startedAt: 1_700_000_000_200,
          updatedAt: 1_700_000_000_240,
          status: 'completed',
          sandboxPolicy: 'inherit',
          output: 'Reviewed the request and captured the result.',
        },
      ];

      await act(async () => {
        callbacks.onAssistantMessage('final content', [], {
          openaiResponseOutput: [
            { id: 'msg_prev', type: 'message', role: 'assistant', content: [] },
          ],
        });
        callbacks.onToolMessage('tc1', JSON.stringify({ status: 'error', error: 'Tool failed' }));
        callbacks.onUsage({
          inputTokens: 40,
          outputTokens: 20,
          cacheReadTokens: 15,
          cacheWriteTokens: 5,
          totalTokens: 65,
        });
        callbacks.onDone();
        await Promise.resolve();
      });
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Callback test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockStartAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        goal: 'Callback test',
        userMessageId: expect.any(String),
        summary: expect.objectContaining({ assistantTurns: 1 }),
      }),
    );

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Pilot approved finalization',
          summary: expect.objectContaining({
            assistantTurns: 2,
            startedTools: 1,
            completedTools: 1,
          }),
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );

    expect(mockUpdateMessageProviderReplay).toHaveBeenCalledWith('conv1', expect.any(String), {
      openaiResponseOutput: [{ id: 'msg_prev', type: 'message', role: 'assistant', content: [] }],
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'tc1',
        content: JSON.stringify({ status: 'error', error: 'Tool failed' }),
        isError: true,
      }),
    );
    expect(mockRecordConversationUsage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        inputTokens: 40,
        outputTokens: 20,
        cacheReadTokens: 15,
        cacheWriteTokens: 5,
        totalTokens: 65,
        model: 'gpt-5.4',
        providerId: 'openai',
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        kind: 'usage',
        title: 'Usage recorded',
        detail: expect.stringContaining('cache 15 / 40 · write 5'),
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        status: 'active',
      }),
      'run-1',
    );
    expect(mockUpdateAgentRunPlan).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        objective: 'Hello',
        rawPlan: expect.stringContaining('Objective: Hello'),
      }),
      'run-1',
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Tool started: test',
      }),
      'run-1',
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Tool completed: test',
      }),
      'run-1',
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        kind: 'state',
        level: 'success',
        title: 'Pilot approved finalization',
        detail: 'Pilot score 17/20. Approved.',
      }),
    );
    expect(mockSetLoading).toHaveBeenCalledWith(false);
    jest.useRealTimers();
  });

  it('does not start a tracked agent run for low-signal agentic requests', async () => {
    mockRunOrchestrator.mockImplementationOnce(
      async (_options: any, callbacks: OrchestratorCallbacks) => {
        callbacks.onAssistantMessage(
          'Please clarify the task and tell me the concrete outcome you want.',
          [],
        );
        callbacks.onDone();
      },
    );

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), '---');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockStartAgentRun).not.toHaveBeenCalled();
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });

  it('keeps the run open when background workers are still running after the supervisor turn ends', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Keep monitoring background work');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      true,
      expect.objectContaining({
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('keeps delegated worker monitoring in the work phase while background work is still running', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Monitor the delegated worker before final review',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-monitor-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
        currentActivity: 'Inspecting repository files',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('Checking the delegated worker status.', [
        {
          id: 'tc-status-running',
          name: 'sessions_status',
          arguments: '{"sessionId":"sub-background-monitor-1"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-status-running',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-background-monitor-1"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-status-running',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-background-monitor-1"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'running',
          sessionId: 'sub-background-monitor-1',
          currentActivity: 'Inspecting repository files',
        }),
      });
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockSetAgentRunPhase.mock.calls.some(([, phase]) => phase === 'work')).toBe(true);
    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      true,
      expect.objectContaining({
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('keeps async operation monitoring in the work phase while the operation is still pending', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Keep monitoring the async workflow before final review',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const pendingOperation = {
      key: 'expo-workflow:workflow-101',
      kind: 'expo-workflow',
      resourceId: 'workflow-101',
      displayName: 'Expo workflow 101',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-1', workflowRunId: '101' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-1', workflowRunId: '101' },
    };

    mockSetAgentRunPhase.mockClear();

    act(() => {
      callbacks.onPendingAsyncOperationsChange([pendingOperation]);
      callbacks.onAssistantMessage('Checking the Expo workflow status.', [
        {
          id: 'tc-expo-status',
          name: 'expo_eas_workflow_status',
          arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-expo-status',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-expo-status',
        name: 'expo_eas_workflow_status',
        arguments: '{"projectId":"proj-1","workflowRunId":"101"}',
        status: 'completed',
        result: JSON.stringify({
          projectId: 'proj-1',
          mode: 'github-workflow',
          workflowRun: {
            id: 101,
            status: 'in_progress',
          },
        }),
      });
    });

    expect(mockUpdateAgentRunPendingAsyncOperations).toHaveBeenCalledWith(
      'conv1',
      [pendingOperation],
      expect.objectContaining({ latestSummary: expect.any(String) }),
      'run-1',
    );
    expect(mockSetAgentRunPhase.mock.calls.some(([, phase]) => phase === 'work')).toBe(true);
    expect(mockSetAgentRunPhase.mock.calls.filter(([, phase]) => phase === 'review')).toHaveLength(
      0,
    );
  });

  it('recovers a running async-monitoring run back into work instead of review', async () => {
    const pendingOperation = {
      key: 'expo-workflow:workflow-101',
      kind: 'expo-workflow',
      resourceId: 'workflow-101',
      displayName: 'Expo workflow 101',
      status: 'running',
      lastUpdatedByTool: 'expo_eas_build',
      updatedAt: Date.now(),
      monitorToolNames: ['expo_eas_workflow_status', 'expo_eas_workflow_wait'],
      statusArgs: { projectId: 'proj-1', workflowRunId: '101' },
      waitToolName: 'expo_eas_workflow_wait',
      waitArgs: { projectId: 'proj-1', workflowRunId: '101' },
    };

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-async-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-async-1',
            userMessageId: 'msg1',
            currentPhase: 'review',
            latestSummary: 'Async monitoring was interrupted.',
            pendingAsyncOperations: [pendingOperation],
          }),
        ],
      },
    ];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
        'conv1',
        'work',
        expect.objectContaining({
          checkpointTitle: 'Recovered async workflow monitoring',
          allowRegression: true,
        }),
        'run-async-1',
      );
    });

    expect(
      mockSetAgentRunPhase.mock.calls.some(
        ([, phase, params, runId]) =>
          phase === 'review'
          && params?.checkpointTitle === 'Recovered async workflow monitoring'
          && runId === 'run-async-1',
      ),
    ).toBe(false);
  });

  it('keeps the run open when the supervisor stream fails while background workers are still running', async () => {
    jest.useFakeTimers();

    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Finish after the verifier returns');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-error-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onError(
        new Error(
          'The model response ended before tool planning completed (UNEXPECTED_TOOL_CALL). Partial tool calls were discarded to avoid executing incomplete actions.',
        ),
      );
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      true,
      expect.objectContaining({
        checkpointTitle: 'Waiting for background workers',
        latestSummary: expect.stringContaining('Waiting for 1 background worker to finish.'),
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).not.toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'failed',
        checkpointTitle: 'Turn failed',
      }),
      'run-1',
    );

    jest.useRealTimers();
  });

  it('keeps the run open when a live background worker falls back to the active run id', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Keep monitoring fallback background work',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-fallback-1',
        parentConversationId: 'conv1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ];
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-1',
        agentRuns: [createRunningAgentRun()],
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      true,
      expect.objectContaining({
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('resumes the supervisor with a pilot review when a background worker fails', async () => {
    render(<ChatScreen />);

    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'resume',
      outcome: {
        status: 'failed',
        summary: 'Pilot score 9/20. Recovery is still possible with a better approach.',
      },
      checkpointTitle: 'Pilot review queued',
      checkpointDetail: 'Pilot score 9/20. Recovery is still possible with a better approach.',
      reviewPrompt: '## Pilot Review\n\nAt least one background worker ended unsuccessfully.',
      evaluation: buildMockPilotEvaluation({
        completionScore: 1,
        adherenceScore: 2,
        evidenceScore: 1,
        processScore: 2,
        overallScore: 6,
        approved: false,
        recommendedAction: 'continue',
        confidence: 'medium',
        summary: 'The worker failed and the workflow needs another recovery attempt.',
        rationale: 'A materially different next step is still available.',
        strengths: [],
        gaps: ['The failed worker output is not enough to satisfy the task.'],
        nextActions: ['Diagnose the worker failure and continue with a different approach.'],
        criterionEvaluations: [
          {
            criterion: 'Produce the requested deliverable.',
            score: 1,
            maxScore: 5,
            status: 'blocked',
            rationale: 'No usable deliverable exists yet.',
          },
          {
            criterion: 'Verify the result before finalizing.',
            score: 1,
            maxScore: 5,
            status: 'blocked',
            rationale: 'Verification failed with the worker.',
          },
        ],
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(typeof mockSubAgentListener).toBe('function');

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-pilot',
            role: 'user',
            content: 'Recover the failed background workflow.',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-tool-pilot',
            role: 'assistant',
            content: 'I launched a worker and I am waiting for the result.',
            timestamp: 1_700_000_000_050,
            toolCalls: [
              {
                id: 'tc-spawn-pilot',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Recover the failed workflow"}',
                status: 'completed',
                result: '{"summary":"Worker launched successfully."}',
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_150,
                completedAt: 1_700_000_000_150,
              },
            ],
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-pilot',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 1 background worker to finish.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          }),
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'sub-failed-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_400,
        status: 'error',
        sandboxPolicy: 'inherit',
        output: 'Worker failed while running the verification command.',
      },
    ];

    await act(async () => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'error');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      false,
      expect.objectContaining({
        checkpointTitle: 'Pilot review queued',
      }),
      'run-1',
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'pilot',
      expect.objectContaining({
        status: 'active',
        checkpointTitle: 'Pilot review queued',
      }),
      'run-1',
    );
    expect(mockUpdateAgentRunPilotEvaluation).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        recommendedAction: 'continue',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv1',
        systemPrompt: expect.stringContaining('## Pilot Review'),
      }),
    );
    expect(mockRunOrchestrator.mock.calls[0][0].systemPrompt).toContain(
      'At least one background worker ended unsuccessfully.',
    );
    expect(mockStartAgentRun).not.toHaveBeenCalled();
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });

  it('queues pilot review with advisory structured-plan context when background workers stop with unfinished work remaining', async () => {
    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'resume',
      outcome: {
        status: 'completed',
        summary: 'Pilot found remaining structured work before final delivery.',
      },
      checkpointTitle: 'Pilot review queued',
      checkpointDetail: 'Pilot found remaining structured work before final delivery.',
      reviewPrompt: '## Pilot Review\n\nContinue the next structured workstream before final delivery.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 11,
        approved: false,
        recommendedAction: 'continue',
        controlAction: 'continue',
        summary: 'Pilot found remaining structured work before final delivery.',
        rationale: 'The first workstream completed, but the structured plan still has another required step.',
        gaps: ['Unfinished structured work remains.'],
        nextActions: ['Continue the next structured workstream before final delivery.'],
      }),
    });

    render(<ChatScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(typeof mockSubAgentListener).toBe('function');

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-background-plan',
            role: 'user',
            content: 'Finish the plan before you review it.',
            timestamp: 1_700_000_010_000,
          },
          {
            id: 'assistant-tool-background-plan',
            role: 'assistant',
            content: 'I launched the first workstream.',
            timestamp: 1_700_000_010_050,
            toolCalls: [
              {
                id: 'tc-spawn-background-plan',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Implement the fix"}',
                status: 'completed',
                result: '{"summary":"Worker launched successfully."}',
                startedAt: 1_700_000_010_060,
                updatedAt: 1_700_000_010_070,
                completedAt: 1_700_000_010_070,
              },
            ],
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-background-plan',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 1 background worker to finish.',
            plan: createStructuredPlan(),
          }),
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-plan-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        workstreamId: 'workstream-1',
        startedAt: 1_700_000_010_060,
        updatedAt: 1_700_000_010_500,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Implemented the fix successfully.',
      },
    ];

    await act(async () => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'completed');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateOutcome: expect.objectContaining({
          summary: expect.stringContaining(
            'Structured plan review: Structured plan still has remaining work',
          ),
        }),
        reviewPerspective: expect.objectContaining({
          summary: expect.stringContaining('Structured plan still has remaining work'),
          nextActions: expect.arrayContaining([
            'Primary next workstream: Verify the fix [workstream-2].',
          ]),
        }),
      }),
    );
    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      false,
      expect.objectContaining({
        checkpointTitle: 'Pilot review queued',
        latestSummary: 'Pilot found remaining structured work before final delivery.',
      }),
      'run-1',
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'pilot',
      expect.objectContaining({
        checkpointTitle: 'Pilot review queued',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator.mock.calls[0][0].conversationId).toBe('conv1');
    expect(mockRunOrchestrator.mock.calls[0][0].systemPrompt).toContain(
      '## Pilot Review\n\nContinue the next structured workstream before final delivery.',
    );
    expect(mockRunOrchestrator.mock.calls[0][0].systemPrompt).not.toContain(
      '## Workflow Continuation',
    );
    expect(
      mockRunOrchestrator.mock.calls[0][0].messages.some(
        (message: any) => message.content?.includes('This is a follow-up continuation, not a redo.'),
      ),
    ).toBe(false);
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });

  it('reviews persisted terminal worker snapshots when the live worker registry is empty', async () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-background-complete',
            role: 'user',
            content: 'Wait for the background worker to finish.',
            timestamp: 1_700_000_100_000,
          },
          {
            id: 'assistant-sub-agent-complete',
            role: 'assistant',
            content: 'Worker completed successfully.',
            timestamp: 1_700_000_100_250,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId: 'sub-complete-1',
                parentConversationId: 'conv1',
                agentRunId: 'run-1',
                depth: 0,
                startedAt: 1_700_000_100_050,
                updatedAt: 1_700_000_100_250,
                status: 'completed',
                sandboxPolicy: 'inherit',
                output: 'Worker finished with verified output.',
              },
            },
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-background-complete',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 1 background worker to finish.',
          }),
        ],
      },
    ];
    mockActiveSubAgents = [];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
        expect.objectContaining({
          workers: [
            expect.objectContaining({
              sessionId: 'sub-complete-1',
              status: 'completed',
            }),
          ],
        }),
      );
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Pilot approved finalization',
        }),
        'run-1',
      );
    });
  });

  it('marks a supervisor reply as provisional while background workers are still running', async () => {
    jest.useFakeTimers();

    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Keep monitoring the worker');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    mockActiveSubAgents = [
      {
        sessionId: 'sub-background-join-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: Date.now() - 3000,
        updatedAt: Date.now(),
        status: 'running',
        sandboxPolicy: 'inherit',
      },
    ];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('I am waiting for the worker to finish.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    mockUpdateMessageAssistantMetadata.mockClear();

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    expect(mockUpdateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'background_workers_running',
      }),
    );
    expect(mockSetAgentRunAwaitingBackgroundWorkers).toHaveBeenCalledWith(
      'conv1',
      true,
      expect.objectContaining({
        checkpointTitle: 'Waiting for background workers',
        latestSummary: 'Waiting for 1 background worker to finish.',
      }),
      'run-1',
    );
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('resumes the supervisor when the pilot rejects a foreground completion attempt', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'resume',
      outcome: {
        status: 'completed',
        summary: 'Pilot score 11/20. The draft is not ready for delivery.',
      },
      checkpointTitle: 'Pilot review queued',
      checkpointDetail: 'Pilot score 11/20. The draft is not ready for delivery.',
      reviewPrompt: '## Pilot Review\n\nClose the remaining gaps before final delivery.',
      evaluation: buildMockPilotEvaluation({
        completionScore: 3,
        adherenceScore: 3,
        evidenceScore: 2,
        processScore: 3,
        overallScore: 11,
        approved: false,
        recommendedAction: 'continue',
        confidence: 'medium',
        summary: 'The draft answer still lacks enough verified evidence.',
        rationale: 'The workflow reached a summary but not a production-ready outcome.',
        strengths: ['A draft answer exists.'],
        gaps: ['The result is not verified enough yet.'],
        nextActions: ['Gather stronger verification and revise the answer.'],
        criterionEvaluations: [
          {
            criterion: 'Produce the requested deliverable.',
            score: 3,
            maxScore: 5,
            status: 'partial',
            rationale: 'A draft deliverable exists but is incomplete.',
          },
          {
            criterion: 'Verify the result before finalizing.',
            score: 2,
            maxScore: 5,
            status: 'unmet',
            rationale: 'Verification is still missing.',
          },
        ],
      }),
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Finish the task and verify it');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('The task is done.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    expect(mockUpdateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'pilot_review_pending',
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'pilot',
      expect.objectContaining({
        status: 'active',
        checkpointTitle: 'Pilot review queued',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv1',
        systemPrompt: expect.stringContaining('## Pilot Review'),
      }),
    );
    expect(mockStartAgentRun).toHaveBeenCalledTimes(1);
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });

  it('routes unfinished foreground structured work through pilot review instead of resuming directly from review', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
            plan: createStructuredPlan(),
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'resume',
      outcome: {
        status: 'completed',
        summary: 'Pilot queued a continuation for the unfinished structured plan.',
      },
      checkpointTitle: 'Pilot review queued',
      checkpointDetail: 'Pilot queued a continuation for the unfinished structured plan.',
      reviewPrompt: '## Pilot Review\n\nContinue the first unfinished structured workstream before final delivery.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 10,
        approved: false,
        recommendedAction: 'continue',
        controlAction: 'continue',
        summary: 'Pilot found unfinished structured work.',
        rationale: 'The foreground turn ended after a draft answer even though the structured plan still has required work.',
        gaps: ['The structured plan is incomplete.'],
        nextActions: ['Continue the first unfinished structured workstream before final delivery.'],
      }),
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(
      getByPlaceholderText('Message...'),
      'Finish the task without stopping early',
    );
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('The implementation is done.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateOutcome: expect.objectContaining({
          summary: expect.stringContaining(
            'Structured plan review: Structured plan still has remaining work',
          ),
        }),
        reviewPerspective: expect.objectContaining({
          summary: expect.stringContaining('Structured plan still has remaining work'),
          nextActions: expect.arrayContaining([
            'Primary next workstream: Implement the fix [workstream-1].',
          ]),
        }),
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'pilot',
      expect.objectContaining({
        checkpointTitle: 'Pilot review queued',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator.mock.calls[1][0].conversationId).toBe('conv1');
    expect(mockRunOrchestrator.mock.calls[1][0].systemPrompt).toContain(
      '## Pilot Review\n\nContinue the first unfinished structured workstream before final delivery.',
    );
    expect(mockRunOrchestrator.mock.calls[1][0].systemPrompt).not.toContain(
      '## Workflow Continuation',
    );
    expect(
      mockRunOrchestrator.mock.calls[1][0].messages.some(
        (message: any) => message.content?.includes('This is a follow-up continuation, not a redo.'),
      ),
    ).toBe(false);
    expect(mockCompleteAgentRun).not.toHaveBeenCalled();
  });

  it('finalizes a foreground structured run from persisted completed worker snapshots when live workers are absent', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
            plan: {
              objective: 'Complete the current task.',
              successCriteria: ['Deliver the result'],
              stopConditions: ['Blocked'],
              workstreams: [{ id: 'workstream-1', title: 'Implement the fix' }],
            },
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'finalize',
      outcome: {
        status: 'completed',
        summary: 'Pilot approved finalization from the completed worker output.',
      },
      checkpointTitle: 'Pilot approved finalization',
      checkpointDetail: 'Pilot approved finalization from the completed worker output.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 18,
        approved: true,
        recommendedAction: 'finalize',
        controlAction: 'accept',
        summary: 'The persisted completed worker already satisfies the structured plan.',
        rationale:
          'The only structured workstream already has a completed worker in the transcript, so Pilot should finalize instead of resuming the same work.',
      }),
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Finish the structured task');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    updateMockConversation('conv1', (conversation) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: 'assistant-foreground-complete-worker',
          role: 'assistant',
          content: 'Worker completed successfully.',
          timestamp: 1_700_000_200_250,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-foreground-complete-1',
              parentConversationId: 'conv1',
              agentRunId: 'run-1',
              workstreamId: 'workstream-1',
              depth: 0,
              startedAt: 1_700_000_200_050,
              updatedAt: 1_700_000_200_250,
              status: 'completed',
              sandboxPolicy: 'inherit',
              output: 'Worker finished with verified output.',
            },
          },
        },
      ],
    }));
    mockActiveSubAgents = [];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('The implementation is done.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
        expect.objectContaining({
          workers: [
            expect.objectContaining({
              sessionId: 'sub-foreground-complete-1',
              workstreamId: 'workstream-1',
              status: 'completed',
            }),
          ],
        }),
      );
    });

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
        checkpointTitle: 'Pilot approved finalization',
      }),
      'run-1',
    );
  });

  it('keeps terminal worker lifecycle updates in the work phase while other delegated work is still running', async () => {
    render(<ChatScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(typeof mockSubAgentListener).toBe('function');

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-lifecycle',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 2 background workers to finish.',
          }),
        ],
      },
    ];

    mockActiveSubAgents = [
      {
        sessionId: 'sub-running-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_020_000,
        updatedAt: 1_700_000_020_400,
        status: 'running',
        sandboxPolicy: 'inherit',
        currentActivity: 'Still verifying the fix.',
      },
      {
        sessionId: 'sub-completed-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_020_050,
        updatedAt: 1_700_000_020_450,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'One workstream completed successfully.',
      },
    ];

    await act(async () => {
      mockSubAgentListener?.(mockActiveSubAgents[1], 'completed');
      await Promise.resolve();
    });

    expect(mockConversations[0].agentRuns[0].currentPhase).toBe('work');
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        checkpointTitle: 'Worker completed: sub-completed-1',
      }),
      'run-1',
    );
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('continues an incomplete assistant draft in place when pilot requests a resume', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot
      .mockResolvedValueOnce({
        action: 'resume',
        outcome: {
          status: 'completed',
          summary: 'Pilot score 11/20. The answer needs stronger verification.',
        },
        checkpointTitle: 'Pilot review queued',
        checkpointDetail: 'Pilot score 11/20. The answer needs stronger verification.',
        reviewPrompt:
          '## Pilot Review\n\nContinue the current draft and add stronger verification.\n\nExisting user-visible draft/output to continue:\nDraft answer.',
        reviewUserPrompt:
          'Continue the already-visible answer. Write only the net-new text that should be appended to improve that answer.\n\nVisible answer already shown to the user (do not repeat it verbatim):\nDraft answer.',
        evaluation: buildMockPilotEvaluation({
          completionScore: 3,
          adherenceScore: 3,
          evidenceScore: 2,
          processScore: 3,
          overallScore: 11,
          approved: false,
          recommendedAction: 'continue',
          confidence: 'medium',
          summary: 'The current draft answer should be continued, not replaced.',
          rationale: 'A usable draft exists and needs additional verified detail.',
          strengths: ['A usable draft answer already exists.'],
          gaps: ['The answer still needs stronger verification.'],
          nextActions: ['Append the missing verification detail to the existing answer.'],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 3,
              maxScore: 5,
              status: 'partial',
              rationale: 'A draft deliverable exists but is incomplete.',
            },
            {
              criterion: 'Verify the result before finalizing.',
              score: 2,
              maxScore: 5,
              status: 'unmet',
              rationale: 'Verification detail is still missing.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'completed',
          summary: 'Pilot approved the enriched answer.',
        },
        checkpointTitle: 'Pilot approved finalization',
        checkpointDetail: 'Pilot score 18/20. Approved.',
        evaluation: buildMockPilotEvaluation({
          overallScore: 18,
          approved: true,
          recommendedAction: 'finalize',
          controlAction: 'accept',
          summary: 'The enriched answer is now ready for delivery.',
          rationale: 'The existing answer was extended with the missing verification detail.',
          strengths: ['The original draft was preserved and enriched.'],
          gaps: [],
          nextActions: [],
        }),
      });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Finish the task and verify it',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, firstCallbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      firstCallbacks.onAssistantMessage('Draft answer.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      firstCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    expect(mockRunOrchestrator.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv1',
        systemPrompt: expect.stringContaining('Existing user-visible draft/output to continue:'),
      }),
    );
    expect(mockRunOrchestrator.mock.calls[1][0].systemPrompt).toContain('Draft answer.');
    expect(
      mockRunOrchestrator.mock.calls[1][0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content === 'Draft answer.',
      ),
    ).toHaveLength(1);
    expect(mockRunOrchestrator.mock.calls[1][0].messages.at(-2)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'Draft answer.',
      }),
    );
    expect(mockRunOrchestrator.mock.calls[1][0].messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(
          'Write only the net-new text that should be appended to improve that answer.',
        ),
      }),
    );

    const [, resumedCallbacks] = mockRunOrchestrator.mock.calls[1];

    act(() => {
      resumedCallbacks.onAssistantMessage(' More evidence.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
    });

    await act(async () => {
      resumedCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const continuedAssistantMessages = mockConversations[0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content.includes('Draft answer.'),
      );

      expect(continuedAssistantMessages).toHaveLength(1);
      expect(continuedAssistantMessages[0]).toEqual(
        expect.objectContaining({
          content: 'Draft answer. More evidence.',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    expect(
      mockAddMessage.mock.calls.filter(
        ([, message]) => message.role === 'assistant' && message.content === '',
      ),
    ).toHaveLength(1);
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
        checkpointTitle: 'Pilot approved finalization',
      }),
      'run-1',
    );
  });

  it('continues a visible assistant draft in place when the prior draft lived on a tool-call turn', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot
      .mockResolvedValueOnce({
        action: 'resume',
        outcome: {
          status: 'completed',
          summary: 'Pilot score 11/20. The answer needs stronger verification.',
        },
        checkpointTitle: 'Pilot review queued',
        checkpointDetail: 'Pilot score 11/20. The answer needs stronger verification.',
        reviewPrompt:
          '## Pilot Review\n\nContinue the current draft and add stronger verification.\n\nExisting user-visible draft/output to continue:\nDraft answer.',
        reviewUserPrompt:
          'Continue the already-visible answer. Write only the net-new text that should be appended to improve that answer.\n\nVisible answer already shown to the user (do not repeat it verbatim):\nDraft answer.',
        evaluation: buildMockPilotEvaluation({
          completionScore: 3,
          adherenceScore: 3,
          evidenceScore: 2,
          processScore: 3,
          overallScore: 11,
          approved: false,
          recommendedAction: 'continue',
          confidence: 'medium',
          summary: 'The current draft answer should be continued, not replaced.',
          rationale:
            'A usable draft exists on the prior tool-call turn and needs additional verified detail.',
          strengths: ['A usable draft answer already exists.'],
          gaps: ['The answer still needs stronger verification.'],
          nextActions: ['Append the missing verification detail to the existing answer.'],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 3,
              maxScore: 5,
              status: 'partial',
              rationale: 'A draft deliverable exists but is incomplete.',
            },
            {
              criterion: 'Verify the result before finalizing.',
              score: 2,
              maxScore: 5,
              status: 'unmet',
              rationale: 'Verification detail is still missing.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'completed',
          summary: 'Pilot approved the enriched answer.',
        },
        checkpointTitle: 'Pilot approved finalization',
        checkpointDetail: 'Pilot score 18/20. Approved.',
        evaluation: buildMockPilotEvaluation({
          overallScore: 18,
          approved: true,
          recommendedAction: 'finalize',
          controlAction: 'accept',
          summary: 'The enriched answer is now ready for delivery.',
          rationale: 'The existing answer was extended with the missing verification detail.',
          strengths: ['The original draft was preserved and enriched.'],
          gaps: [],
          nextActions: [],
        }),
      });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Finish the task and verify it',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, firstCallbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      firstCallbacks.onAssistantMessage(
        'Draft answer.',
        [
          {
            id: 'tc-1',
            name: 'sessions_spawn',
            arguments: '{"prompt":"Verify the answer"}',
            status: 'completed',
          },
        ],
        undefined,
        {
          kind: 'intermediate',
          completionStatus: 'complete',
        },
      );
    });

    await act(async () => {
      firstCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    expect(mockRunOrchestrator.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv1',
        systemPrompt: expect.stringContaining('Existing user-visible draft/output to continue:'),
      }),
    );
    expect(mockRunOrchestrator.mock.calls[1][0].systemPrompt).toContain('Draft answer.');
    expect(
      mockRunOrchestrator.mock.calls[1][0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content === 'Draft answer.',
      ),
    ).toHaveLength(1);

    const [, resumedCallbacks] = mockRunOrchestrator.mock.calls[1];

    act(() => {
      resumedCallbacks.onAssistantMessage(' More evidence.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
    });

    await act(async () => {
      resumedCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const continuedAssistantMessages = mockConversations[0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content.includes('Draft answer.'),
      );

      expect(continuedAssistantMessages).toHaveLength(1);
      expect(continuedAssistantMessages[0]).toEqual(
        expect.objectContaining({
          content: 'Draft answer. More evidence.',
          toolCalls: expect.arrayContaining([
            expect.objectContaining({
              id: 'tc-1',
              name: 'sessions_spawn',
            }),
          ]),
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    expect(
      mockAddMessage.mock.calls.filter(
        ([, message]) => message.role === 'assistant' && message.content === '',
      ),
    ).toHaveLength(1);
  });

  it('replaces a restarted pilot continuation instead of appending duplicate content', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const initialDraft = [
      "Based on the official Android documentation as of April 2026, here is a 2-bullet summary of the Android Emulator's core features and requirements:",
      '',
      '- Old bullet A.',
      '- Old bullet B.',
    ].join('\n');
    const restartedDraft = [
      "Based on the official Android documentation as of April 2026, here is a 2-bullet summary of the Android Emulator's core features and requirements:",
      '',
      '- Updated bullet A with better sourcing.',
      '- Updated bullet B with clearer acceleration guidance.',
    ].join('\n');

    mockEvaluateAgentRunWithPilot
      .mockResolvedValueOnce({
        action: 'resume',
        outcome: {
          status: 'completed',
          summary: 'Pilot asked the supervisor to continue the visible answer.',
        },
        checkpointTitle: 'Pilot review queued',
        checkpointDetail:
          'Pilot score 11/20. Continue the current draft with stronger verification.',
        reviewPrompt: `## Pilot Review\n\nContinue the current draft and add stronger verification.\n\nExisting user-visible draft/output to continue:\n${initialDraft}`,
        reviewUserPrompt: `Continue the already-visible answer. Write only the net-new text that should be appended to improve that answer.\n\nVisible answer already shown to the user (do not repeat it verbatim):\n${initialDraft}`,
        evaluation: buildMockPilotEvaluation({
          completionScore: 3,
          adherenceScore: 3,
          evidenceScore: 2,
          processScore: 3,
          overallScore: 11,
          approved: false,
          recommendedAction: 'continue',
          confidence: 'medium',
          summary: 'The current draft should be continued, not duplicated.',
          rationale: 'A usable draft exists and the next pass must refine it in place.',
          strengths: ['A usable draft answer already exists.'],
          gaps: ['The answer still needs stronger verification.'],
          nextActions: ['Continue the existing draft with the missing verification detail.'],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 3,
              maxScore: 5,
              status: 'partial',
              rationale: 'A draft deliverable exists but is incomplete.',
            },
            {
              criterion: 'Verify the result before finalizing.',
              score: 2,
              maxScore: 5,
              status: 'unmet',
              rationale: 'Verification is still missing.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'completed',
          summary: 'Pilot approved the revised draft.',
        },
        checkpointTitle: 'Pilot approved finalization',
        checkpointDetail: 'Pilot score 18/20. Approved.',
        evaluation: buildMockPilotEvaluation({
          overallScore: 18,
          approved: true,
          recommendedAction: 'finalize',
          controlAction: 'accept',
          summary: 'The revised draft is now ready for delivery.',
          rationale: 'The resumed answer replaced the stale draft instead of duplicating it.',
          strengths: ['The final answer contains only the revised summary.'],
          gaps: [],
          nextActions: [],
        }),
      });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Summarize the Android emulator docs.',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, firstCallbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      firstCallbacks.onAssistantMessage(initialDraft, [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      firstCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    expect(
      mockRunOrchestrator.mock.calls[1][0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content === initialDraft,
      ),
    ).toHaveLength(1);

    const [, resumedCallbacks] = mockRunOrchestrator.mock.calls[1];

    act(() => {
      resumedCallbacks.onAssistantMessage(restartedDraft, [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
    });

    await act(async () => {
      resumedCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const continuedAssistantMessages = mockConversations[0].messages.filter(
        (message: any) =>
          message.role === 'assistant' &&
          message.content.includes('Based on the official Android documentation as of April 2026'),
      );

      expect(continuedAssistantMessages).toHaveLength(1);
      expect(continuedAssistantMessages[0]).toEqual(
        expect.objectContaining({
          content: restartedDraft,
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });
  });

  it('preserves the visible draft and appends a failure note instead of replacing it', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    const initialDraft = [
      '- Android Docs Researcher v2: ### Final Worker Report: Task Incomplete Outcome: The request could not be completed due to technical limitations.',
      '- sessions_status: 0 artifacts; preview (319 chars)',
      '- gemini-call-0: 0 artifacts; preview (319 chars)',
      '- Android Documentation Specialist: Queued to start',
    ].join('\n');
    const appendedFailureDraft = [
      initialDraft,
      '',
      'Note: the response stream failed before the answer could finish.',
      'Here are the latest verified findings before the failure:',
      '- Android Documentation Specialist: Based on the official Android Developer documentation as of April 15, 2026, here are two key updates for the Android Emulator.',
    ].join('\n');

    mockEvaluateAgentRunWithPilot
      .mockResolvedValueOnce({
        action: 'resume',
        outcome: {
          status: 'failed',
          summary: 'Pilot requested a failure-safe note for the visible draft.',
        },
        checkpointTitle: 'Pilot review queued',
        checkpointDetail:
          'Pilot score 9/20. Continue the visible draft with a failure-safe note.',
        reviewPrompt: `## Pilot Review\n\nContinue the current draft with a failure-safe note.\n\nExisting user-visible draft/output to continue:\n${initialDraft}`,
        reviewUserPrompt: `Continue the already-visible answer. Write only the net-new text that should be appended to the visible draft.\n\nVisible answer already shown to the user (do not repeat it verbatim):\n${initialDraft}`,
        evaluation: buildMockPilotEvaluation({
          completionScore: 2,
          adherenceScore: 2,
          evidenceScore: 2,
          processScore: 3,
          overallScore: 9,
          approved: false,
          recommendedAction: 'continue',
          confidence: 'medium',
          summary:
            'The failure-safe note should preserve the visible draft and only append net-new information.',
          rationale: 'The visible draft already contains user-visible work and should not be discarded.',
          strengths: ['The draft preserves the latest verified findings.'],
          gaps: ['The visible draft still needs a concise failure note.'],
          nextActions: ['Append a concise failure note without deleting the visible draft.'],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 2,
              maxScore: 5,
              status: 'partial',
              rationale: 'A partial draft exists but it is noisy and repetitive.',
            },
            {
              criterion: 'Summarize only the verified findings.',
              score: 2,
              maxScore: 5,
              status: 'partial',
              rationale: 'The draft needs a cleaner recovery summary.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'failed',
          summary: 'Pilot accepted the appended failure note.',
        },
        checkpointTitle: 'Pilot approved finalization',
        checkpointDetail: 'Pilot score 16/20. Approved.',
        evaluation: buildMockPilotEvaluation({
          overallScore: 16,
          approved: true,
          recommendedAction: 'finalize',
          controlAction: 'accept',
          summary: 'The appended failure note is ready to deliver.',
          rationale: 'The visible draft was preserved and the failure context was appended cleanly.',
          strengths: ['The visible answer preserves previously streamed content.'],
          gaps: [],
          nextActions: [],
        }),
      });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Recover the failed run cleanly',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, firstCallbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      firstCallbacks.onAssistantMessage(initialDraft, [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
      });
    });

    await act(async () => {
      firstCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(2);
    });

    const [, resumedCallbacks] = mockRunOrchestrator.mock.calls[1];

    act(() => {
      resumedCallbacks.onAssistantMessage(appendedFailureDraft, [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
    });

    await act(async () => {
      resumedCallbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const continuedAssistantMessages = mockConversations[0].messages.filter(
        (message: any) =>
          message.role === 'assistant' &&
          message.content.includes('Note: the response stream failed before the answer could finish.'),
      );

      expect(continuedAssistantMessages).toHaveLength(1);
      expect(continuedAssistantMessages[0].content).toBe(appendedFailureDraft);
      expect(
        continuedAssistantMessages[0].content.match(
          /Android Docs Researcher v2: ### Final Worker Report:/g,
        ),
      ).toHaveLength(1);
      expect(continuedAssistantMessages[0].content).toContain(
        'Here are the latest verified findings before the failure:',
      );
    });
  });

  it('reuses a background-worker draft in place when pilot resumes after worker review', async () => {
    mockEvaluateAgentRunWithPilot
      .mockResolvedValueOnce({
        action: 'resume',
        outcome: {
          status: 'failed',
          summary: 'Pilot score 10/20. Continue the existing draft with stronger verification.',
        },
        checkpointTitle: 'Pilot review queued',
        checkpointDetail:
          'Pilot score 10/20. Continue the existing draft with stronger verification.',
        reviewPrompt:
          '## Pilot Review\n\nContinue the current draft and add stronger verification.\n\nExisting user-visible draft/output to continue:\nDraft answer.',
        reviewUserPrompt:
          'Continue the already-visible answer. Write only the net-new text that should be appended to improve that answer.\n\nVisible answer already shown to the user (do not repeat it verbatim):\nDraft answer.',
        evaluation: buildMockPilotEvaluation({
          completionScore: 2,
          adherenceScore: 3,
          evidenceScore: 2,
          processScore: 3,
          overallScore: 10,
          approved: false,
          recommendedAction: 'continue',
          confidence: 'medium',
          summary: 'The existing draft should be continued rather than replaced.',
          rationale:
            'A usable visible draft exists and the worker outcome only requires additive verification.',
          strengths: ['A visible draft answer already exists.'],
          gaps: ['The answer still needs stronger verification.'],
          nextActions: ['Continue the existing draft with the missing verification detail.'],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 3,
              maxScore: 5,
              status: 'partial',
              rationale: 'A draft deliverable exists but is incomplete.',
            },
            {
              criterion: 'Verify the result before finalizing.',
              score: 2,
              maxScore: 5,
              status: 'unmet',
              rationale:
                'The worker outcome still needs to be incorporated into the visible answer.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'completed',
          summary: 'Pilot approved the continued draft.',
        },
        checkpointTitle: 'Pilot approved finalization',
        checkpointDetail: 'Pilot score 18/20. Approved.',
        evaluation: buildMockPilotEvaluation({
          overallScore: 18,
          approved: true,
          recommendedAction: 'finalize',
          controlAction: 'accept',
          summary: 'The continued draft is now ready for delivery.',
          rationale: 'The existing answer was extended with the missing verification detail.',
          strengths: ['The original draft was preserved and enriched.'],
          gaps: [],
          nextActions: [],
        }),
      });

    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage('Added verification.', [], undefined, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
      callbacks.onDone();
    });

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-background-resume',
            role: 'user',
            content: 'Recover the background run and finish the answer.',
            timestamp: 1_700_000_200_000,
          },
          {
            id: 'assistant-draft-background',
            role: 'assistant',
            content: 'Draft answer.',
            timestamp: 1_700_000_200_050,
            assistantMetadata: {
              kind: 'intermediate',
              completionStatus: 'complete',
              finishReason: 'background_workers_running',
            },
          },
          {
            id: 'assistant-worker-background',
            role: 'assistant',
            content: 'Worker failed while verifying the answer.',
            timestamp: 1_700_000_200_100,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'error',
              snapshot: {
                sessionId: 'sub-background-resume-1',
                parentConversationId: 'conv1',
                agentRunId: 'run-1',
                depth: 0,
                startedAt: 1_700_000_200_020,
                updatedAt: 1_700_000_200_100,
                status: 'error',
                sandboxPolicy: 'inherit',
                output: 'Worker failed while verifying the answer.',
              },
            },
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-background-resume',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 1 background worker to finish.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          }),
        ],
      },
    ];
    mockActiveSubAgents = [];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    expect(
      mockRunOrchestrator.mock.calls[0][0].messages.filter(
        (message: any) => message.role === 'assistant' && message.content === 'Draft answer.',
      ),
    ).toHaveLength(1);
    expect(mockRunOrchestrator.mock.calls[0][0].messages.at(-1)).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(
          'Write only the net-new text that should be appended to improve that answer.',
        ),
      }),
    );

    expect(mockUpdateMessageAssistantMetadata).toHaveBeenCalledWith(
      'conv1',
      'assistant-draft-background',
      expect.objectContaining({
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'pilot_review_pending',
      }),
    );

    await waitFor(() => {
      const plainAssistantMessages = mockConversations[0].messages.filter(
        (message: any) => message.role === 'assistant' && !message.subAgentEvent,
      );

      expect(plainAssistantMessages).toHaveLength(1);
      expect(plainAssistantMessages[0]).toEqual(
        expect.objectContaining({
          id: 'assistant-draft-background',
          content: 'Draft answer. Added verification.',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    expect(
      mockAddMessage.mock.calls.filter(([, message]) => message.role === 'assistant'),
    ).toHaveLength(0);
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
        checkpointTitle: 'Pilot approved finalization',
      }),
      'run-1',
    );
  });

  it('does not auto-resume after a deterministic provider 400 request rejection', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });

    mockEvaluateAgentRunWithPilot.mockResolvedValue({
      action: 'resume',
      outcome: {
        status: 'completed',
        summary: 'This retry should be suppressed for deterministic provider request errors.',
      },
      checkpointTitle: 'Pilot review queued',
      checkpointDetail: 'Pilot attempted to resume the failed run.',
      reviewPrompt: '## Pilot Review\n\nResume the run.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 10,
        approved: false,
        recommendedAction: 'continue',
        controlAction: 'continue',
      }),
    });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Continue the Anthropic workflow',
    );
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage(
        'Checking the repository.',
        [
          {
            id: 'tc-read',
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
            status: 'pending',
          },
        ],
        undefined,
        {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      );
      callbacks.onToolCallStart({
        id: 'tc-read',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-read',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
        result:
          'Verified repository state from notes.txt with concrete evidence that would normally qualify for recovery.',
      });
      callbacks.onToolMessage(
        'tc-read',
        'Verified repository state from notes.txt with concrete evidence that would normally qualify for recovery.',
      );
      callbacks.onError(
        new Error(
          'LLM API error 400: invalid_request_error: tool_result blocks must immediately follow tool_use blocks.',
        ),
      );
    });

    await act(async () => {
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'failed',
          checkpointTitle: 'Provider request rejected',
          checkpointDetail:
            'LLM API error 400: invalid_request_error: tool_result blocks must immediately follow tool_use blocks.',
        }),
        'run-1',
      );
    });

    expect(mockEvaluateAgentRunWithPilot).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('should start a new assistant message after a tool-using assistant turn', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Build a game');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const { act } = require('@testing-library/react-native');
    act(() => {
      callbacks.onAssistantMessage('I will create the game files now.', [
        {
          id: 'tc-write',
          name: 'write_file',
          arguments: '{"path":"index.html"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-write',
        name: 'write_file',
        arguments: '{"path":"index.html"}',
        status: 'running',
      });
      callbacks.onToken('Done building it.');
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ role: 'assistant', content: '' }),
    );
  });

  it('starts a new assistant turn for a second tool-only batch so different tools stay separate', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Do the work');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const { act } = require('@testing-library/react-native');

    act(() => {
      callbacks.onAssistantMessage(
        '',
        [
          {
            id: 'tool-catalog',
            name: 'tool_catalog',
            arguments: '{"category":"images"}',
            status: 'pending',
          },
        ],
        undefined,
        {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      );
      callbacks.onAssistantMessage(
        '',
        [
          {
            id: 'tool-image',
            name: 'image_generate',
            arguments: '{"prompt":"cat"}',
            status: 'pending',
          },
        ],
        undefined,
        {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      );
    });

    const assistantMessages = mockConversations[0].messages.filter(
      (message: any) => message.role === 'assistant',
    );
    const toolOnlyMessages = assistantMessages.filter(
      (message: any) => (message.toolCalls?.length ?? 0) > 0,
    );

    expect(toolOnlyMessages).toHaveLength(2);
    expect(toolOnlyMessages[0]).toEqual(
      expect.objectContaining({
        toolCalls: [expect.objectContaining({ id: 'tool-catalog', name: 'tool_catalog' })],
      }),
    );
    expect(toolOnlyMessages[1]).toEqual(
      expect.objectContaining({
        toolCalls: [expect.objectContaining({ id: 'tool-image', name: 'image_generate' })],
      }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ role: 'assistant', content: '' }),
    );
  });

  it('opens a new assistant turn for empty final callbacks after tool use so replay stays on the correct message', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Read the notes file');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const toolTurnReplay = {
      openaiResponseOutput: [
        {
          id: 'fc-tool',
          type: 'function_call',
          call_id: 'call-read',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
        },
      ],
    };
    const finalReplay = {
      openaiResponseOutput: [
        {
          id: 'msg-final',
          type: 'message',
          role: 'assistant',
          content: [],
        },
      ],
    };

    act(() => {
      callbacks.onAssistantMessage(
        'I am reading the file now.',
        [
          {
            id: 'tc-read',
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
            status: 'pending',
          },
        ],
        toolTurnReplay,
        {
          kind: 'intermediate',
          completionStatus: 'complete',
          finishReason: 'tool_calls',
        },
      );
      callbacks.onToolMessage('tc-read', 'file contents');
      callbacks.onAssistantMessage('', [], finalReplay, {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      });
    });

    const assistantMessages = mockConversations[0].messages.filter(
      (message: any) => message.role === 'assistant',
    );
    const toolTurnMessage = assistantMessages.find(
      (message: any) =>
        Array.isArray(message.toolCalls) &&
        message.toolCalls.some((toolCall: any) => toolCall.id === 'tc-read'),
    );
    const finalAssistantMessage = assistantMessages[assistantMessages.length - 1];

    expect(assistantMessages).toHaveLength(3);
    expect(toolTurnMessage).toEqual(
      expect.objectContaining({
        content: 'I am reading the file now.',
        providerReplay: toolTurnReplay,
      }),
    );
    expect(finalAssistantMessage.id).not.toBe(toolTurnMessage?.id);
    expect(finalAssistantMessage).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: '',
        providerReplay: finalReplay,
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
  });

  it('replaces a trailing interrupted text-only assistant turn with a safe fallback final response', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: params.userMessageId,
            goal: params.goal,
            latestSummary: 'Drafting the final answer.',
            summary: {
              assistantTurns: 1,
              startedTools: 0,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 0,
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Explain the cleanup',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
    }));
    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'finalize',
      outcome: {
        status: 'cancelled',
        summary: 'Pilot score 8/20. The interrupted draft cannot be approved as final.',
      },
      checkpointTitle: 'Pilot blocked finalization',
      checkpointDetail: 'Pilot score 8/20. The interrupted draft cannot be approved as final.',
      evaluation: buildMockPilotEvaluation({
        completionScore: 2,
        adherenceScore: 3,
        evidenceScore: 1,
        processScore: 2,
        overallScore: 8,
        approved: false,
        recommendedAction: 'blocked',
        confidence: 'medium',
        summary: 'The interrupted draft answer is not a valid final response.',
        rationale: 'Pilot blocked finalization so the run needs synthesized recovery instead.',
        strengths: [],
        gaps: ['The final answer was interrupted before it was complete.'],
        nextActions: [],
        criterionEvaluations: [
          {
            criterion: 'Produce the requested deliverable.',
            score: 2,
            maxScore: 5,
            status: 'partial',
            rationale: 'Only a partial draft exists.',
          },
          {
            criterion: 'Verify the result before finalizing.',
            score: 1,
            maxScore: 5,
            status: 'unmet',
            rationale: 'No verified final answer exists.',
          },
        ],
      }),
    });

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Explain the cleanup');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    act(() => {
      callbacks.onToken('Interrupted draft answer');
      callbacks.onDone();
    });

    await waitFor(() => {
      const latestAssistantMessage = [...mockConversations[0].messages]
        .reverse()
        .find((message: any) => message.role === 'assistant');

      expect(latestAssistantMessage).toEqual(
        expect.objectContaining({
          content: 'Fallback final response (cancelled)',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    const latestAssistantMessage = [...mockConversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant');

    expect(latestAssistantMessage).toEqual(
      expect.objectContaining({
        content: 'Fallback final response (cancelled)',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
    expect(mockConversations[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'Interrupted draft answer',
        }),
      ]),
    );
    expect(mockSynthesizeAgentRunFinalAnswer).not.toHaveBeenCalled();
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'assistant',
        content: 'Fallback final response (cancelled)',
      }),
    );
  });

  it('cancels live workers when Pilot reaches a terminal decision for the active run', async () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );
    const { listActiveSubAgents } = require('../../src/services/agents/subAgent');
    const baseListActiveSubAgentsImplementation = listActiveSubAgents.getMockImplementation?.();

    try {
      mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          activeAgentRunId: 'run-1',
          agentRuns: [
            createRunningAgentRun({
              userMessageId: params.userMessageId,
              goal: params.goal,
              latestSummary: 'Drafting the final answer.',
              summary: {
                assistantTurns: 1,
                startedTools: 0,
                completedTools: 0,
                failedTools: 0,
                spawnedSubAgents: 0,
              },
            }),
          ],
        }));
        return 'run-1';
      });
      mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
        originalPrompt: 'Explain the cleanup',
        transcriptMessages: [],
        lastNonEmptyAssistantContent: 'Interrupted draft answer',
        lastSubstantiveResult: '',
        resultPreviews: [],
        toolsUsed: [],
        iterations: 0,
      }));
      mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
        action: 'finalize',
        outcome: {
          status: 'cancelled',
          summary: 'Pilot score 8/20. The interrupted draft cannot be approved as final.',
        },
        checkpointTitle: 'Pilot blocked finalization',
        checkpointDetail: 'Pilot score 8/20. The interrupted draft cannot be approved as final.',
        evaluation: buildMockPilotEvaluation({
          completionScore: 2,
          adherenceScore: 3,
          evidenceScore: 1,
          processScore: 2,
          overallScore: 8,
          approved: false,
          recommendedAction: 'blocked',
          confidence: 'medium',
          summary: 'The interrupted draft answer is not a valid final response.',
          rationale: 'Pilot blocked finalization so the run needs synthesized recovery instead.',
          strengths: [],
          gaps: ['The final answer was interrupted before it was complete.'],
          nextActions: [],
          criterionEvaluations: [
            {
              criterion: 'Produce the requested deliverable.',
              score: 2,
              maxScore: 5,
              status: 'partial',
              rationale: 'Only a partial draft exists.',
            },
            {
              criterion: 'Verify the result before finalizing.',
              score: 1,
              maxScore: 5,
              status: 'unmet',
              rationale: 'No verified final answer exists.',
            },
          ],
        }),
      });

      const screen = render(<ChatScreen />);
      fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Explain the cleanup');
      fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

      await waitFor(() => {
        expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
      });

      const workerSnapshot = {
        sessionId: 'worker-pilot-terminal-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        status: 'running',
        startedAt: 1_700_000_000_075,
        updatedAt: 1_700_000_000_125,
      };
      let liveSubAgentReadCount = 0;
      listActiveSubAgents.mockClear();
      listActiveSubAgents.mockImplementation(() => {
        liveSubAgentReadCount += 1;
        if (liveSubAgentReadCount === 1) {
          mockActiveSubAgents = [];
          return [];
        }

        mockActiveSubAgents = [workerSnapshot];
        return mockActiveSubAgents;
      });

      const [, callbacks] = mockRunOrchestrator.mock.calls[0];
      act(() => {
        callbacks.onToken('Interrupted draft answer');
        callbacks.onDone();
      });

      await waitFor(() => {
        expect(mockCancelSubAgent).toHaveBeenCalledWith(
          'worker-pilot-terminal-1',
          'Cancelled because the supervising run reached a terminal state after Pilot review.',
        );
      });

      expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
        'conv1',
        'run-1',
        'Cancelled because the supervising run reached a terminal state after Pilot review.',
      );
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'cancelled',
          checkpointTitle: 'Pilot blocked finalization',
          checkpointDetail: expect.stringContaining('1 background worker was stopped.'),
        }),
        'run-1',
      );
      expect(mockAddConversationLog).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          title: 'Pilot blocked finalization',
          detail: expect.stringContaining('1 background worker was stopped.'),
        }),
      );
    } finally {
      listActiveSubAgents.mockImplementation(
        baseListActiveSubAgentsImplementation ?? (() => mockActiveSubAgents),
      );
      cancelAgentRunOperationsSpy.mockRestore();
    }
  });

  it('backfills a reopened terminal run that is missing a final assistant response', async () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-reopen',
            role: 'user',
            content: 'Summarize the cleanup',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-partial',
            role: 'assistant',
            content: 'Interrupted draft answer',
            timestamp: 1_700_000_000_050,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ],
        activeAgentRunId: undefined,
        agentRuns: [
          {
            ...createRunningAgentRun({
              id: 'run-reopen',
              userMessageId: 'msg-user-reopen',
              status: 'completed',
              awaitingBackgroundWorkers: false,
              currentPhase: 'deliver',
              latestSummary:
                'Background workers finished before the app restarted. Recovering the final response from verified results.',
              summary: {
                assistantTurns: 1,
                startedTools: 0,
                completedTools: 0,
                failedTools: 0,
                spawnedSubAgents: 0,
              },
            }),
            status: 'completed',
            awaitingBackgroundWorkers: false,
          },
        ],
      },
    ];
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Summarize the cleanup',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
    }));

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'assistant',
        content: 'Synthesized final response',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
    expect(mockConversations[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'assistant-partial',
          content: 'Interrupted draft answer',
          assistantMetadata: expect.objectContaining({
            completionStatus: 'incomplete',
          }),
        }),
      ]),
    );
    expect(mockAppendAgentRunCheckpoint).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Final response delivered',
        detail: 'Synthesized final response',
      }),
      'run-reopen',
    );
  });

  it('keeps committed assistant text visible while a tool-start placeholder draft is active', async () => {
    jest.useFakeTimers();

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Delegate the repo audit');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const streamedAssistantMessage = mockConversations[0].messages.find(
      (message: any) => message.role === 'assistant' && message.content === '',
    );

    expect(streamedAssistantMessage).toBeDefined();

    act(() => {
      callbacks.onAssistantMessage('I am delegating the repository audit to a Claude worker.', [
        {
          id: 'tc-spawn',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Audit the repository"}',
          status: 'pending',
        },
      ]);
    });

    expect(
      screen.getAllByText('I am delegating the repository audit to a Claude worker.').length,
    ).toBeGreaterThan(0);

    act(() => {
      callbacks.onToolCallStart({
        id: 'tc-spawn',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit the repository"}',
        status: 'running',
      });
    });

    screen.rerender(<ChatScreen />);

    expect(
      screen.getAllByText('I am delegating the repository audit to a Claude worker.').length,
    ).toBeGreaterThan(0);

    jest.useRealTimers();
  });

  it('should append a background sub-agent completion message to the parent conversation', () => {
    render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    act(() => {
      mockSubAgentListener?.(
        {
          sessionId: 'sub-1',
          parentConversationId: 'conv1',
          agentRunId: 'run-old',
          startedAt: Date.now() - 4000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'inherit',
          output: 'Worker finished the implementation.',
          toolsUsed: ['read_file', 'file_edit'],
        },
        'completed',
      );
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('completed'),
        subAgentEvent: expect.objectContaining({
          type: 'sub-agent',
          event: 'completed',
          snapshot: expect.objectContaining({
            sessionId: 'sub-1',
            status: 'completed',
          }),
        }),
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: expect.stringContaining('sub-1'),
        kind: 'system',
        level: 'success',
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        checkpointTitle: 'Worker completed: sub-1',
      }),
      'run-old',
    );
  });

  it('falls back to the active running run when a worker event omits agentRunId', () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-1',
        agentRuns: [createRunningAgentRun()],
      },
    ];

    render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    act(() => {
      mockSubAgentListener?.(
        {
          sessionId: 'sub-fallback-1',
          parentConversationId: 'conv1',
          startedAt: Date.now() - 4000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'inherit',
          output: 'Worker finished the repository audit.',
          toolsUsed: ['read_file'],
        },
        'completed',
      );
    });

    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        checkpointTitle: 'Worker completed: sub-fallback-1',
      }),
      'run-1',
    );
  });

  it('updates the existing transcript worker widget instead of duplicating it on completion', () => {
    const screen = render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    act(() => {
      mockSubAgentListener?.(
        {
          sessionId: 'sub-dup-1',
          parentConversationId: 'conv1',
          startedAt: Date.now() - 4000,
          updatedAt: Date.now() - 2000,
          status: 'running',
          sandboxPolicy: 'inherit',
          name: 'Planner',
          depth: 1,
          currentActivity: 'Inspecting files',
        },
        'started',
      );
    });

    expect(screen.queryAllByTestId('sub-agent-open-details')).toHaveLength(1);

    act(() => {
      mockSubAgentListener?.(
        {
          sessionId: 'sub-dup-1',
          parentConversationId: 'conv1',
          startedAt: Date.now() - 4000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'inherit',
          name: 'Planner',
          depth: 1,
          output: 'Worker finished the implementation.',
        },
        'completed',
      );
    });

    expect(screen.queryAllByTestId('sub-agent-open-details')).toHaveLength(1);
  });

  it('keeps one transcript worker widget when same-session lifecycle messages are separated by tool output', () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-worker',
            role: 'user',
            content: 'Investigate this',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-worker-started',
            role: 'assistant',
            content: 'Planner started.',
            timestamp: 1_700_000_000_100,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId: 'sub-stable-1',
                parentConversationId: 'conv1',
                name: 'Planner',
                depth: 1,
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_100,
                status: 'running',
                sandboxPolicy: 'inherit',
                currentActivity: 'Inspecting files',
              },
            },
          },
          {
            id: 'tool-worker-ignored',
            role: 'tool',
            content: 'ignored tool output',
            timestamp: 1_700_000_000_150,
          },
          {
            id: 'assistant-worker-completed',
            role: 'assistant',
            content: 'Planner completed.',
            timestamp: 1_700_000_000_200,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId: 'sub-stable-1',
                parentConversationId: 'conv1',
                name: 'Planner',
                depth: 1,
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_200,
                status: 'completed',
                sandboxPolicy: 'inherit',
                output: 'Worker finished the audit.',
              },
            },
          },
        ],
      },
    ];

    const screen = render(<ChatScreen />);

    expect(screen.queryAllByTestId('sub-agent-open-details')).toHaveLength(1);
    expect(screen.getByText('Planner completed.')).toBeTruthy();
    expect(screen.getByText('Inspecting files')).toBeTruthy();
  });

  it('finalizes an awaiting background run only once when terminal worker events race', async () => {
    let resolveFinalization: ((value: { output: string; providerReplay: any }) => void) | undefined;
    mockSynthesizeAgentRunFinalAnswer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalization = resolve;
        }),
    );
    mockCompleteAgentRun.mockImplementation(
      (conversationId: string, params: any, runId: string) => {
        mockConversations = mockConversations.map((conversation) =>
          conversation.id !== conversationId
            ? conversation
            : {
                ...conversation,
                activeAgentRunId: undefined,
                agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
                  run.id !== runId
                    ? run
                    : {
                        ...run,
                        status: params.status ?? 'completed',
                        awaitingBackgroundWorkers: false,
                        pendingAsyncOperations: undefined,
                        latestSummary: params.latestSummary ?? run.latestSummary,
                      },
                ),
              },
        );
      },
    );

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-tool',
            role: 'user',
            content: 'Finish the repository audit',
            timestamp: 1_700_000_000_000,
          },
          {
            id: 'assistant-tool-1',
            role: 'assistant',
            content: 'I launched workers and I am waiting for the results.',
            timestamp: 1_700_000_000_050,
            toolCalls: [
              {
                id: 'tc-spawn',
                name: 'sessions_spawn',
                arguments: '{"prompt":"Audit the repository"}',
                status: 'completed',
                result: '{"summary":"Workers launched successfully."}',
                startedAt: 1_700_000_000_100,
                updatedAt: 1_700_000_000_150,
                completedAt: 1_700_000_000_150,
              },
            ],
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-tool',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 2 background workers to finish.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'sub-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_000_100,
        updatedAt: 1_700_000_000_300,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Worker one completed the repository audit.',
        toolsUsed: ['read_file'],
      },
      {
        sessionId: 'sub-2',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_000_120,
        updatedAt: 1_700_000_000_320,
        status: 'completed',
        sandboxPolicy: 'inherit',
        output: 'Worker two verified the repository audit.',
        toolsUsed: ['grep_search'],
      },
    ];

    render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'completed');
      mockSubAgentListener?.(mockActiveSubAgents[1], 'completed');
    });

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
    });

    act(() => {
      resolveFinalization?.({
        output: 'Synthesized final response',
        providerReplay: {
          openaiResponseOutput: [
            { id: 'final-output', type: 'message', role: 'assistant', content: [] },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(mockCompleteAgentRun).toHaveBeenCalledTimes(1);
    });

    expect(
      mockAddConversationLog.mock.calls.filter(
        ([, entry]) => entry.title === 'Pilot approved finalization',
      ),
    ).toHaveLength(1);
  });

  it('should append a sub-agent started message to the parent conversation', () => {
    render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    act(() => {
      mockSubAgentListener?.(
        {
          sessionId: 'sub-2',
          parentConversationId: 'conv1',
          agentRunId: 'run-1',
          name: 'Backend Architect',
          depth: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          status: 'running',
          sandboxPolicy: 'safe-only',
        },
        'started',
      );
    });

    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Backend Architect'),
        subAgentEvent: expect.objectContaining({
          type: 'sub-agent',
          event: 'started',
          snapshot: expect.objectContaining({
            sessionId: 'sub-2',
            depth: 1,
            sandboxPolicy: 'safe-only',
          }),
        }),
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: expect.stringContaining('Backend Architect'),
        kind: 'system',
        level: 'info',
      }),
    );
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        checkpointTitle: 'Worker started: Backend Architect',
      }),
      'run-1',
    );
  });

  it('opens a filtered worker detail view from a transcript sub-agent card', () => {
    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now(),
      status: 'running',
      sandboxPolicy: 'inherit',
      iterations: 1,
      toolsUsed: ['sessions_spawn'],
    };
    const childSnapshot = {
      sessionId: 'sub-child',
      parentConversationId: 'conv1',
      parentSessionId: 'sub-root',
      name: 'Implementer',
      depth: 1,
      startedAt: Date.now() - 5000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'safe-only',
      output: 'Done.',
      iterations: 2,
      toolsUsed: ['read_file', 'file_edit'],
    };

    mockActiveSubAgents = [rootSnapshot, childSnapshot];
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner started at depth 0 using inherit sandbox access.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: rootSnapshot,
            },
          },
        ],
      },
    ];

    const { getAllByText, getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('sub-agent-open-details'));

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Planner').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
    expect(getByTestId('sub-agent-rollup-card')).toBeTruthy();
  });

  it('keeps transcript-only nested workers in the detail modal after they leave the live registry', () => {
    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'inherit',
      iterations: 1,
      toolsUsed: ['sessions_spawn'],
    };
    const childSnapshot = {
      sessionId: 'sub-child',
      parentConversationId: 'conv1',
      parentSessionId: 'sub-root',
      name: 'Implementer',
      depth: 1,
      startedAt: Date.now() - 5000,
      updatedAt: Date.now(),
      status: 'completed',
      sandboxPolicy: 'safe-only',
      output: 'Done from transcript history.',
      iterations: 2,
      toolsUsed: ['read_file', 'file_edit'],
    };

    mockActiveSubAgents = [rootSnapshot];
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner completed.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: rootSnapshot,
            },
          },
          {
            id: 'msg3',
            role: 'assistant',
            content: 'Implementer completed.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: childSnapshot,
            },
          },
        ],
      },
    ];

    const { getAllByTestId, getAllByText } = render(<ChatScreen />);

    fireEvent.press(getAllByTestId('sub-agent-open-details')[0]);

    expect(getAllByText('Worker tree').length).toBeGreaterThan(0);
    expect(getAllByText('Planner').length).toBeGreaterThan(0);
    expect(getAllByText('Implementer').length).toBeGreaterThan(0);
  });

  it('refreshes transcript worker cards when live progress arrives', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner started at depth 0 using inherit sandbox access.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: rootSnapshot,
            },
          },
        ],
      },
    ];

    const { getByText } = render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockSubAgentListener).toBe('function');
    });

    mockActiveSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now(),
        currentActivity: 'Reading repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(getByText('Reading repository files')).toBeTruthy();
      expect(getByText('read_file')).toBeTruthy();
    });
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        detail: 'Reading repository files',
      }),
      'run-1',
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('coalesces rapid worker progress updates into one throttled transcript refresh', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner started at depth 0 using inherit sandbox access.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: rootSnapshot,
            },
          },
        ],
      },
    ];

    const { getByText, queryByText } = render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockSubAgentListener).toBe('function');
    });

    mockActiveSubAgents = [
      {
        ...rootSnapshot,
        updatedAt: Date.now(),
        currentActivity: 'Scanning repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
    });

    mockActiveSubAgents = [
      {
        ...rootSnapshot,
        updatedAt: Date.now() + 1,
        currentActivity: 'Comparing symbol usage',
        activeToolName: 'text_search',
      },
    ];

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
    });

    expect(queryByText('Comparing symbol usage')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(399);
    });

    expect(queryByText('Comparing symbol usage')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    await waitFor(() => {
      expect(getByText('Comparing symbol usage')).toBeTruthy();
    });
    expect(queryByText('Scanning repository files')).toBeNull();
    expect(getByText('text_search')).toBeTruthy();

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('coalesces rapid worker progress updates into one workflow store update', async () => {
    jest.useFakeTimers();

    const rootSnapshot = {
      sessionId: 'sub-root',
      parentConversationId: 'conv1',
      name: 'Planner',
      depth: 0,
      startedAt: Date.now() - 8000,
      updatedAt: Date.now() - 4000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Run the workers', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Planner started at depth 0 using inherit sandbox access.',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: rootSnapshot,
            },
          },
        ],
      },
    ];

    render(<ChatScreen />);

    await waitFor(() => {
      expect(typeof mockSubAgentListener).toBe('function');
    });

    mockSetAgentRunPhase.mockClear();
    mockUpdateAgentRunSummary.mockClear();

    mockActiveSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now(),
        currentActivity: 'Scanning repository files',
        activeToolName: 'read_file',
      },
    ];

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
    });

    mockActiveSubAgents = [
      {
        ...rootSnapshot,
        agentRunId: 'run-1',
        updatedAt: Date.now() + 1,
        currentActivity: 'Comparing symbol usage',
        activeToolName: 'text_search',
      },
    ];

    act(() => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
    });

    expect(mockSetAgentRunPhase).not.toHaveBeenCalled();
    expect(mockUpdateAgentRunSummary).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockSetAgentRunPhase).toHaveBeenCalledTimes(1);
    expect(mockSetAgentRunPhase).toHaveBeenCalledWith(
      'conv1',
      'work',
      expect.objectContaining({
        detail: 'Comparing symbol usage',
      }),
      'run-1',
    );
    expect(mockUpdateAgentRunSummary).toHaveBeenCalledTimes(1);
    expect(mockUpdateAgentRunSummary).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        latestSummary: 'Comparing symbol usage',
      }),
      'run-1',
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('handles a Claude-style worker loop through the parent conversation path', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the repo with a worker');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    const workerSnapshot = {
      sessionId: 'sub-claude',
      parentConversationId: 'conv1',
      name: 'Claude Researcher',
      depth: 0,
      startedAt: Date.now() - 3000,
      updatedAt: Date.now() - 1000,
      status: 'running',
      sandboxPolicy: 'inherit',
    };

    act(() => {
      callbacks.onAssistantMessage('I am delegating the repository audit to a Claude worker.', [
        {
          id: 'tc-spawn',
          name: 'sessions_spawn',
          arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-spawn',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-spawn',
        name: 'sessions_spawn',
        arguments: '{"prompt":"Audit the repository","name":"Claude Researcher"}',
        status: 'completed',
        result: JSON.stringify({ status: 'running', sessionId: 'sub-claude' }),
      });

      mockSubAgentListener?.(workerSnapshot, 'started');

      mockActiveSubAgents = [
        {
          ...workerSnapshot,
          updatedAt: Date.now(),
          currentActivity: 'Inspecting repository files',
          activeToolName: 'read_file',
        },
      ];
      mockSubAgentListener?.(mockActiveSubAgents[0], 'progress');
      jest.advanceTimersByTime(400);

      callbacks.onAssistantMessage('Checking the Claude worker status.', [
        {
          id: 'tc-status',
          name: 'sessions_status',
          arguments: '{"sessionId":"sub-claude"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-status',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-claude"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-status',
        name: 'sessions_status',
        arguments: '{"sessionId":"sub-claude"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'completed',
          sessionId: 'sub-claude',
          outputPreview: 'Claude verified the repository findings.',
        }),
      });

      mockSubAgentListener?.(
        {
          ...workerSnapshot,
          updatedAt: Date.now() + 1,
          status: 'completed',
          output: 'Claude verified the repository findings.',
          toolsUsed: ['read_file', 'text_search'],
          iterations: 2,
        },
        'completed',
      );

      callbacks.onToken('The Claude worker verified the repository findings.');
      jest.advanceTimersByTime(240);
      callbacks.onAssistantMessage('The Claude worker verified the repository findings.', []);
      callbacks.onDone();
    });

    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({ name: 'sessions_spawn' }),
    );
    expect(mockAddToolCall).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      expect.objectContaining({ name: 'sessions_status' }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        subAgentEvent: expect.objectContaining({
          event: 'started',
          snapshot: expect.objectContaining({ sessionId: 'sub-claude', status: 'running' }),
        }),
      }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        subAgentEvent: expect.objectContaining({
          event: 'completed',
          snapshot: expect.objectContaining({
            sessionId: 'sub-claude',
            status: 'completed',
            output: 'Claude verified the repository findings.',
          }),
        }),
      }),
    );
    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'The Claude worker verified the repository findings.',
    );

    jest.useRealTimers();
  });

  it('surfaces worker output into a separate assistant message and suppresses duplicate late text', async () => {
    jest.useFakeTimers();

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Use the worker result directly');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    act(() => {
      callbacks.onAssistantMessage('I will surface the worker answer.', [
        {
          id: 'tc-surface',
          name: 'sessions_surface_output',
          arguments: '{"sessionId":"sub-surface"}',
          status: 'pending',
        },
      ]);
      callbacks.onToolCallStart({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"sub-surface"}',
        status: 'running',
      });
      callbacks.onToolCallComplete({
        id: 'tc-surface',
        name: 'sessions_surface_output',
        arguments: '{"sessionId":"sub-surface"}',
        status: 'completed',
        result: JSON.stringify({
          status: 'surfaced',
          sessionId: 'sub-surface',
          output: 'Worker-authored final answer',
          outputLength: 26,
          sourceOutputLength: 26,
          selectionApplied: false,
          usedFullOutput: true,
          guidance:
            'This output is intended to be surfaced directly to the user by the runtime. Do not restate the same content in assistant text unless you are adding materially new information.',
        }),
      });
      callbacks.onToolMessage('tc-surface', 'tool result');
      callbacks.onToken('Worker-authored final answer');
      callbacks.onAssistantMessage('Worker-authored final answer', []);
      callbacks.onDone();
    });

    const surfacedAssistantMessages = mockAddMessage.mock.calls.filter(
      ([conversationId, message]) =>
        conversationId === 'conv1' &&
        message.role === 'assistant' &&
        message.content === 'Worker-authored final answer',
    );

    expect(surfacedAssistantMessages).toHaveLength(1);
    expect(surfacedAssistantMessages[0][1]).toEqual(
      expect.objectContaining({
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'incomplete',
          finishReason: 'surfaced_worker_output_pending',
        }),
      }),
    );
    expect(mockUpdateToolCallStatus).toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'tc-surface',
      'completed',
      expect.objectContaining({
        result:
          'Full worker output from sub-surface was surfaced to the user in the assistant response.',
      }),
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        role: 'tool',
        content:
          'Full worker output from sub-surface was surfaced to the user in the assistant response.',
        toolCallId: 'tc-surface',
      }),
    );
    expect(mockUpdateMessage).not.toHaveBeenCalledWith(
      'conv1',
      expect.any(String),
      'Worker-authored final answer',
    );

    jest.useRealTimers();
  });

  it('should not auto-follow while the user is actively dragging the conversation', async () => {
    const scrollToEndSpy = jest
      .spyOn((FlatList as any).prototype, 'scrollToEnd')
      .mockImplementation(() => {});
    const { UNSAFE_getByType, getByPlaceholderText, getByTestId } = render(<ChatScreen />);

    fireEvent.changeText(getByPlaceholderText('Message...'), 'Keep streaming');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    scrollToEndSpy.mockClear();

    const messageList = UNSAFE_getByType(FlatList);

    const { act } = require('@testing-library/react-native');
    act(() => {
      messageList.props.onScrollBeginDrag?.();
      messageList.props.onContentSizeChange?.(400, 1800);
    });

    expect(scrollToEndSpy).not.toHaveBeenCalled();

    scrollToEndSpy.mockRestore();
  });

  it('should handle orchestrator error callback', async () => {
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('Test error'));
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Error test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        'conv1',
        expect.any(String),
        'Error: Test error',
      );
    });
  });

  it('reuses the streamed draft when the API fails mid-stream', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Investigate the stream failure',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    }));
    mockBuildAgentRunToolResultFallback.mockImplementation(({ evidence }: any) =>
      (evidence?.resultPreviews?.length ?? 0) > 0 ? 'Fallback final response (failed)' : undefined,
    );

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the stream failure');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onToken('Interrupted draft answer');
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      const assistantMessages = mockConversations[0].messages.filter(
        (message: any) =>
          message.role === 'assistant' && message.content.includes('Interrupted draft answer'),
      );

      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]).toEqual(
        expect.objectContaining({
          content: [
            'Interrupted draft answer',
            '',
            'Note: the response stream failed before the answer could finish.',
          ].join('\n'),
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });
  });

  it('preserves streamed partial text when the orchestrator throws after tokens', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Investigate the stream failure',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: 'Interrupted draft answer',
      lastSubstantiveResult: '',
      resultPreviews: [],
      toolsUsed: [],
      iterations: 0,
      hasIncompleteToolCalls: false,
    }));
    mockBuildAgentRunToolResultFallback.mockImplementation(({ evidence }: any) =>
      (evidence?.resultPreviews?.length ?? 0) > 0 ? 'Fallback final response (failed)' : undefined,
    );
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onToken('Interrupted draft answer');
      throw new Error('Transport failed after streaming');
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    fireEvent.changeText(getByPlaceholderText('Message...'), 'Investigate the stream failure');
    fireEvent.press(getByTestId('icon-Send').parent || getByTestId('icon-Send'));

    await waitFor(() => {
      const assistantMessages = mockConversations[0].messages.filter(
        (message: any) =>
          message.role === 'assistant' && message.content.includes('Interrupted draft answer'),
      );

      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0]).toEqual(
        expect.objectContaining({
          content: [
            'Interrupted draft answer',
            '',
            'Note: the response stream failed before the answer could finish.',
          ].join('\n'),
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });
  });

  it('recovers a response interruption as a completed run when pilot approves verified evidence', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            latestSummary: 'Synthesizing final answer from verified worker results.',
            summary: {
              assistantTurns: 1,
              startedTools: 3,
              completedTools: 3,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Analyze Android 16 readiness',
      transcriptMessages: [],
      lastNonEmptyAssistantContent: '',
      lastSubstantiveResult:
        'Verified worker findings confirm the requested deliverable is complete.',
      resultPreviews: [
        {
          sourceName: 'Android 16 Researcher',
          preview: 'Compiled Android 16 platform changes and mitigations.',
        },
        {
          sourceName: 'Expo Readiness Researcher',
          preview: 'Verified Expo ecosystem readiness and gaps.',
        },
      ],
      toolsUsed: ['sessions_spawn', 'sessions_status', 'web_fetch'],
      iterations: 3,
      hasIncompleteToolCalls: false,
    }));
    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'finalize',
      outcome: {
        status: 'completed',
        summary:
          'Pilot score 18/20. Verified evidence is sufficient to finalize despite the response interruption.',
      },
      checkpointTitle: 'Pilot approved finalization',
      checkpointDetail:
        'Pilot score 18/20. Verified evidence is sufficient to finalize despite the response interruption.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 18,
        approved: true,
        recommendedAction: 'finalize',
        controlAction: 'accept',
        summary: 'Verified evidence is sufficient to finalize despite the response interruption.',
        rationale:
          'The workflow already satisfied the objective before the final response stream failed.',
      }),
    });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Analyze Android 16 readiness');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Pilot approved finalization',
          latestSummary: 'Synthesized final response',
        }),
        'run-1',
      );
    });
  });

  it('synthesizes a final response instead of delivering the max-iterations placeholder after pilot approval', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            latestSummary: 'Final verification loop still in progress.',
            summary: {
              assistantTurns: 1,
              startedTools: 4,
              completedTools: 4,
              failedTools: 0,
              spawnedSubAgents: 2,
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockCollectAgentRunFinalizationEvidence.mockImplementation(() => ({
      originalPrompt: 'Summarize the verified blocker for the user.',
      transcriptMessages: [],
      lastNonEmptyAssistantContent:
        "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
      lastSubstantiveResult: 'Verified blocker findings are ready for delivery.',
      resultPreviews: [
        {
          sourceName: 'Final Verification Specialist',
          preview: 'Verified blocker findings are ready for delivery.',
        },
      ],
      toolsUsed: ['sessions_spawn', 'sessions_wait', 'sessions_output'],
      iterations: 4,
      hasIncompleteToolCalls: false,
    }));
    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'finalize',
      outcome: {
        status: 'completed',
        summary: 'Pilot score 20/20. Verified evidence is sufficient to finalize now.',
      },
      checkpointTitle: 'Pilot approved finalization',
      checkpointDetail: 'Pilot score 20/20. Verified evidence is sufficient to finalize now.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 20,
        approved: true,
        recommendedAction: 'finalize',
        controlAction: 'accept',
        summary: 'Verified evidence is sufficient to finalize now.',
        rationale:
          'The workflow already completed the objective; the max-iterations placeholder should not be delivered.',
      }),
    });
    mockRunOrchestrator.mockImplementationOnce(async (_options, callbacks) => {
      callbacks.onAssistantMessage(
        "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
        [],
        undefined,
        {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'max_iterations',
        },
      );
      callbacks.onDone();
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Summarize the verified blocker for the user.');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockSynthesizeAgentRunFinalAnswer).toHaveBeenCalledTimes(1);
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'completed',
          checkpointTitle: 'Pilot approved finalization',
          latestSummary: 'Synthesized final response',
        }),
        'run-1',
      );
    });
    const latestAssistantMessage = [...mockConversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant');

    expect(latestAssistantMessage).toEqual(
      expect.objectContaining({
        content: 'Synthesized final response',
        assistantMetadata: expect.objectContaining({
          kind: 'final',
          completionStatus: 'complete',
        }),
      }),
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Final response delivered',
        detail: 'Synthesized final response',
      }),
    );
  });

  it('recovers an interrupted structured run from persisted completed worker snapshots when live workers are absent', async () => {
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: params.userMessageId,
            goal: params.goal,
            plan: {
              objective: 'Complete the current task.',
              successCriteria: ['Deliver the result'],
              stopConditions: ['Blocked'],
              workstreams: [{ id: 'workstream-1', title: 'Implement the fix' }],
            },
          }),
        ],
      }));
      return 'run-1';
    });
    mockEvaluateAgentRunWithPilot.mockResolvedValueOnce({
      action: 'finalize',
      outcome: {
        status: 'completed',
        summary:
          'Pilot approved finalization because the completed worker already satisfies the plan.',
      },
      checkpointTitle: 'Pilot approved finalization',
      checkpointDetail:
        'Pilot approved finalization because the completed worker already satisfies the plan.',
      evaluation: buildMockPilotEvaluation({
        overallScore: 18,
        approved: true,
        recommendedAction: 'finalize',
        controlAction: 'accept',
        summary: 'The interrupted run already has the completed structured deliverable.',
        rationale:
          'Recovery should finalize from the persisted completed worker snapshot instead of reopening the same workstream.',
      }),
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Recover the interrupted structured task');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    updateMockConversation('conv1', (conversation) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: 'assistant-recovery-complete-worker',
          role: 'assistant',
          content: 'Worker completed successfully before the stream failed.',
          timestamp: 1_700_000_300_250,
          subAgentEvent: {
            type: 'sub-agent',
            event: 'completed',
            snapshot: {
              sessionId: 'sub-recovery-complete-1',
              parentConversationId: 'conv1',
              agentRunId: 'run-1',
              workstreamId: 'workstream-1',
              depth: 0,
              startedAt: 1_700_000_300_050,
              updatedAt: 1_700_000_300_250,
              status: 'completed',
              sandboxPolicy: 'inherit',
              output: 'Worker finished with verified output before the interruption.',
            },
          },
        },
      ],
    }));
    mockActiveSubAgents = [];

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];

    await act(async () => {
      callbacks.onError(new Error('OpenAI streaming error'));
      callbacks.onDone();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
        expect.objectContaining({
          workers: [
            expect.objectContaining({
              sessionId: 'sub-recovery-complete-1',
              workstreamId: 'workstream-1',
              status: 'completed',
            }),
          ],
        }),
      );
    });

    expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'completed',
        checkpointTitle: 'Pilot approved finalization',
      }),
      'run-1',
    );
  });

  it('should handle orchestrator rejection', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('Network failed'));
    const { getByPlaceholderText, getByTestId, findByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Fail test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    const error = await findByText('Network failed');
    expect(error).toBeTruthy();
    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('should not show error for cancellation', async () => {
    mockRunOrchestrator.mockRejectedValueOnce(new Error('Request cancelled'));
    const { getByPlaceholderText, getByTestId, queryByText } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Cancel test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockSetLoading).toHaveBeenCalledWith(false);
    });
    expect(queryByText('Request cancelled')).toBeNull();
  });

  it('should not show error banner initially', () => {
    const { queryByTestId } = render(<ChatScreen />);
    expect(queryByTestId('icon-AlertTriangle')).toBeNull();
  });

  it('keeps the active conversation in loading state while a run is still active', () => {
    mockLoadingState = false;
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        activeAgentRunId: 'run-pilot-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-pilot-1',
            userMessageId: 'msg1',
            currentPhase: 'pilot',
            latestSummary: 'Pilot review still active.',
          }),
        ],
      },
    ];

    const screen = render(<ChatScreen />);

    expect(screen.UNSAFE_getByType(memoizedChatInputType).props.isLoading).toBe(true);
  });

  it('should handle stop action', () => {
    mockLoadingState = true;
    mockConversations = [
      {
        ...mockConversations[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Coordinate the current task.',
            status: 'running',
            createdAt: Date.now() - 2000,
            updatedAt: Date.now() - 1000,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          },
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'worker-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        status: 'running',
      },
      {
        sessionId: 'worker-2',
        parentConversationId: 'conv1',
        agentRunId: 'run-other',
        status: 'running',
      },
    ];

    const { getByTestId } = render(<ChatScreen />);
    const stopIcon = getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        latestSummary: 'The current run was cancelled and 1 background worker was stopped.',
        checkpointTitle: 'Turn cancelled',
        checkpointDetail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledTimes(1);
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Generation stopped and workers cancelled',
        detail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
    );
  });

  it('clears the streaming indicator when stopping an in-flight response', async () => {
    mockDefaultConversationMode = 'direct';
    mockRunOrchestrator.mockImplementationOnce(
      async (options: any) =>
        await new Promise<void>((resolve) => {
          options.signal.signal.addEventListener(
            'abort',
            () => resolve(),
            { once: true },
          );
        }),
    );

    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Explain the cleanup');
    fireEvent.press(screen.getByTestId('icon-Send').parent || screen.getByTestId('icon-Send'));

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    act(() => {
      callbacks.onToken('Draft answer');
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-bubble-streaming')).toBeTruthy();
    });

    const stopIcon = screen.getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    await waitFor(() => {
      expect(screen.queryByTestId('message-bubble-streaming')).toBeNull();
    });

    expect(mockSetLoading).toHaveBeenCalledWith(false);
  });

  it('cancels a running pilot-stage workflow even when activeAgentRunId is missing', () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );

    try {
      mockLoadingState = false;
      mockConversations = [
        {
          ...createDefaultConversations()[0],
          activeAgentRunId: undefined,
          agentRuns: [
            createRunningAgentRun({
              id: 'run-pilot-stop-1',
              userMessageId: 'msg1',
              currentPhase: 'pilot',
              latestSummary: 'Pilot review is still running.',
            }),
          ],
        },
      ];

      const { getByTestId } = render(<ChatScreen />);
      const stopIcon = getByTestId('icon-Square');
      fireEvent.press(stopIcon.parent || stopIcon);

      expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
        'conv1',
        'run-pilot-stop-1',
        'Cancelled because the supervising turn was stopped by the user.',
      );
      expect(mockCompleteAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          status: 'cancelled',
          latestSummary: 'The current run was cancelled.',
          checkpointTitle: 'Turn cancelled',
          checkpointDetail: 'The current run was cancelled.',
        }),
        'run-pilot-stop-1',
      );
    } finally {
      cancelAgentRunOperationsSpy.mockRestore();
    }
  });

  it('should cancel fallback-matched workers when stopping the active run', () => {
    mockLoadingState = true;
    mockConversations = [
      {
        ...mockConversations[0],
        activeAgentRunId: 'run-1',
        agentRuns: [
          {
            id: 'run-1',
            userMessageId: 'msg1',
            goal: 'Coordinate the current task.',
            status: 'running',
            createdAt: Date.now() - 2000,
            updatedAt: Date.now() - 1000,
            currentPhase: 'work',
            phases: [],
            checkpoints: [],
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 0,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          },
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'worker-fallback-1',
        parentConversationId: 'conv1',
        status: 'running',
      },
      {
        sessionId: 'worker-fallback-2',
        parentConversationId: 'conv2',
        status: 'running',
      },
    ];

    const { getByTestId } = render(<ChatScreen />);
    const stopIcon = getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        latestSummary: 'The current run was cancelled and 1 background worker was stopped.',
        checkpointTitle: 'Turn cancelled',
        checkpointDetail: 'The current run was cancelled and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-fallback-1',
      'Cancelled because the supervising turn was stopped by the user.',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledTimes(1);
  });

  it('cancels the superseded run operations and workers before starting a new turn', async () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );
    cancelAgentRunOperationsSpy.mockImplementation(() => undefined);

    mockConversations = [
      {
        ...mockConversations[0],
        activeAgentRunId: 'run-1',
        messages: [
          {
            id: 'msg-old-user',
            role: 'user',
            content: 'Finish the prior task',
            timestamp: 1_700_000_000_000,
          },
        ] as any[],
        agentRuns: [
          createRunningAgentRun({
            id: 'run-1',
            userMessageId: 'msg-old-user',
            goal: 'Finish the prior task.',
            awaitingBackgroundWorkers: true,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_100,
          }),
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'worker-superseded-1',
        parentConversationId: 'conv1',
        status: 'running',
        startedAt: 1_700_000_000_050,
        updatedAt: 1_700_000_000_120,
      },
    ];
    mockCompleteAgentRun.mockImplementationOnce(
      (conversationId: string, params: any, runId: string) => {
        const timestamp = nextMockTimestamp();
        updateMockConversation(conversationId, (conversation) => ({
          ...conversation,
          activeAgentRunId:
            conversation.activeAgentRunId === runId ? undefined : conversation.activeAgentRunId,
          agentRuns: (conversation.agentRuns ?? []).map((run: any) =>
            run.id === runId
              ? {
                  ...run,
                  status: params?.status ?? 'completed',
                  awaitingBackgroundWorkers: false,
                  latestSummary: params?.latestSummary,
                  completedAt: timestamp,
                  updatedAt: timestamp,
                }
              : run,
          ),
        }));
      },
    );
    mockStartAgentRun.mockImplementationOnce((conversationId: string, params: any) => {
      updateMockConversation(conversationId, (conversation) => ({
        ...conversation,
        activeAgentRunId: 'run-2',
        agentRuns: [
          ...(conversation.agentRuns ?? []),
          createRunningAgentRun({
            id: 'run-2',
            userMessageId: params.userMessageId,
            goal: params.goal,
            createdAt: 1_700_000_000_200,
            updatedAt: 1_700_000_000_200,
          }),
        ],
      }));
      return 'run-2';
    });

    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Start the replacement task');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockStartAgentRun).toHaveBeenCalledWith(
        'conv1',
        expect.objectContaining({
          goal: 'Start the replacement task',
        }),
      );
    });

    expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
      'conv1',
      'run-1',
      'Superseded by a new user turn.',
    );
    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Run superseded',
        latestSummary:
          'A new user turn started before the previous run finished and 1 background worker was stopped.',
      }),
      'run-1',
    );
    expect(mockCancelSubAgent).toHaveBeenCalledWith(
      'worker-superseded-1',
      'Cancelled because a new user turn superseded the active run.',
    );
    expect(mockAddConversationLog).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        title: 'Previous run superseded and workers cancelled',
        detail:
          'A new user turn started before the previous run finished and 1 background worker was stopped.',
      }),
    );

    cancelAgentRunOperationsSpy.mockRestore();
  });

  it('aborts an in-flight background pilot review when the run is stopped', async () => {
    mockLoadingState = true;

    mockEvaluateAgentRunWithPilot.mockImplementationOnce(
      ({ signal }: any) =>
        new Promise((_resolve, reject) => {
          const abortError = new Error('Background pilot review cancelled.');
          abortError.name = 'AbortError';
          const rejectOnAbort = () => reject(abortError);

          if (signal?.aborted) {
            rejectOnAbort();
            return;
          }

          signal?.addEventListener('abort', rejectOnAbort, { once: true });
        }),
    );

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          {
            id: 'msg-user-stop-background',
            role: 'user',
            content: 'Recover the worker result.',
            timestamp: 1_700_000_400_000,
          },
        ],
        activeAgentRunId: 'run-1',
        agentRuns: [
          createRunningAgentRun({
            userMessageId: 'msg-user-stop-background',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for 1 background worker to finish.',
            summary: {
              assistantTurns: 1,
              startedTools: 1,
              completedTools: 1,
              failedTools: 0,
              spawnedSubAgents: 1,
            },
          }),
        ],
      },
    ];
    mockActiveSubAgents = [
      {
        sessionId: 'sub-stop-background-1',
        parentConversationId: 'conv1',
        agentRunId: 'run-1',
        startedAt: 1_700_000_400_050,
        updatedAt: 1_700_000_400_250,
        status: 'error',
        sandboxPolicy: 'inherit',
        output: 'Worker verification failed.',
      },
    ];

    const screen = render(<ChatScreen />);

    expect(typeof mockSubAgentListener).toBe('function');

    await act(async () => {
      mockSubAgentListener?.(mockActiveSubAgents[0], 'error');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledTimes(1);
    });

    const stopIcon = screen.getByTestId('icon-Square');
    fireEvent.press(stopIcon.parent || stopIcon);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCompleteAgentRun).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
      }),
      'run-1',
    );
    expect(mockUpdateAgentRunPilotEvaluation).not.toHaveBeenCalled();
    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });

  it('should show edit actions on user messages', () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const editIcons = getAllByTestId('icon-Edit2');
    expect(editIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('should show retry actions on assistant messages', () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const retryIcons = getAllByTestId('icon-RotateCcw');
    expect(retryIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('should enter edit mode when edit icon is pressed', () => {
    const { getAllByTestId, getByDisplayValue } = render(<ChatScreen />);
    const editIcons = getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);
    expect(getByDisplayValue('Hello')).toBeTruthy();
  });

  it('should handle retry by re-sending previous user message', async () => {
    const { getAllByTestId } = render(<ChatScreen />);
    const retryIcons = getAllByTestId('icon-RotateCcw');
    fireEvent.press(retryIcons[0].parent || retryIcons[0]);

    await waitFor(() => {
      // retry triggers handleSend with the previous user message content
      expect(mockAddMessage).toHaveBeenCalled();
    });
  });

  it('cancels the active run before retry rewinds the conversation', async () => {
    const cancelAgentRunOperationsSpy = jest.spyOn(
      require('../../src/services/agents/agentRunCancellation'),
      'cancelAgentRunOperations',
    );

    try {
      mockConversations = [
        {
          ...createDefaultConversations()[0],
          activeAgentRunId: 'run-retry-1',
          agentRuns: [
            createRunningAgentRun({
              id: 'run-retry-1',
              userMessageId: 'msg1',
            }),
          ],
        },
      ];
      mockActiveSubAgents = [
        {
          sessionId: 'worker-retry-1',
          parentConversationId: 'conv1',
          agentRunId: 'run-retry-1',
          status: 'running',
        },
      ];
      mockEditMessage.mockImplementation((conversationId: string, messageId: string, content: string) => {
        updateMockConversation(conversationId, (conversation) => {
          const messageIndex = conversation.messages.findIndex((message: any) => message.id === messageId);
          return {
            ...conversation,
            messages: conversation.messages.slice(0, messageIndex + 1).map((message: any) =>
              message.id === messageId ? { ...message, content } : message,
            ),
            agentRuns: [],
            activeAgentRunId: undefined,
          };
        });
      });

      const screen = render(<ChatScreen />);
      const retryIcons = screen.getAllByTestId('icon-RotateCcw');
      fireEvent.press(retryIcons[0].parent || retryIcons[0]);

      await waitFor(() => {
        expect(cancelAgentRunOperationsSpy).toHaveBeenCalledWith(
          'conv1',
          'run-retry-1',
          'Cancelled because the active run was rewound for a retry.',
        );
      });

      expect(mockCancelSubAgent).toHaveBeenCalledWith(
        'worker-retry-1',
        'Cancelled because the active run was rewound for a retry.',
      );
    } finally {
      cancelAgentRunOperationsSpy.mockRestore();
    }
  });

  it('should handle edit send by editing message and re-sending', async () => {
    const { getAllByTestId, getByDisplayValue, getByTestId } = render(<ChatScreen />);
    // Press edit on user message
    const editIcons = getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);

    // Edit the content
    const editInput = getByDisplayValue('Hello');
    fireEvent.changeText(editInput, 'Edited hello');
    // Press send (in edit mode, ChatInput fires onSend which is handleEditSend)
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockEditMessage).toHaveBeenCalledWith('conv1', 'msg1', 'Edited hello');
    });
  });

  it('should restore the unsent draft after cancelling edit mode', () => {
    const screen = render(<ChatScreen />);
    const input = screen.getByPlaceholderText('Message...');

    fireEvent.changeText(input, 'Draft before edit');
    fireEvent.press(
      screen.getAllByTestId('icon-Edit2')[0].parent || screen.getAllByTestId('icon-Edit2')[0],
    );

    expect(screen.getByDisplayValue('Hello')).toBeTruthy();

    const cancelEditIcon = screen.getByTestId('icon-X');
    fireEvent.press(cancelEditIcon.parent || cancelEditIcon);

    expect(screen.getByDisplayValue('Draft before edit')).toBeTruthy();
  });

  it('should clear edit mode when switching conversations', async () => {
    mockConversations = [
      ...createDefaultConversations(),
      {
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: Date.now() },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerId: 'openai',
        model: 'gpt-5.4',
        systemPrompt: 'You are helpful',
        usage: {
          entries: [],
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalTokens: 0,
          totalCost: 0,
          totalCalls: 0,
        },
        logs: [],
        agentRuns: [],
      },
    ];

    const screen = render(<ChatScreen />);
    const editIcons = screen.getAllByTestId('icon-Edit2');
    fireEvent.press(editIcons[0].parent || editIcons[0]);

    expect(screen.getByDisplayValue('Hello')).toBeTruthy();

    act(() => {
      mockActiveConvId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Hello')).toBeNull();
    });
    expect(screen.getByText('Second hello')).toBeTruthy();
    expect(screen.getByText('Second reply')).toBeTruthy();
  });

  it('continues background worker review after switching to another conversation', async () => {
    const workerSnapshot = {
      sessionId: 'worker-conv1-1',
      parentConversationId: 'conv1',
      agentRunId: 'run-conv1-1',
      status: 'completed',
      startedAt: 1_700_000_000_010,
      updatedAt: 1_700_000_000_020,
      depth: 1,
      sandboxPolicy: 'inherit',
      name: 'Verifier',
      output: 'Verified the result in conversation 1.',
    };

    mockConversations = [
      {
        ...createDefaultConversations()[0],
        id: 'conv1',
        messages: [
          { id: 'conv1-user', role: 'user', content: 'Finish conversation 1', timestamp: 1 },
          {
            id: 'conv1-assistant',
            role: 'assistant',
            content: 'Waiting on the verifier.',
            timestamp: 2,
          },
          {
            id: 'conv1-worker',
            role: 'assistant',
            content: 'Verifier completed.',
            timestamp: 3,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: workerSnapshot,
            },
          },
        ],
        activeAgentRunId: 'run-conv1-1',
        agentRuns: [
          createRunningAgentRun({
            id: 'run-conv1-1',
            userMessageId: 'conv1-user',
            awaitingBackgroundWorkers: true,
            latestSummary: 'Waiting for background workers.',
          }),
        ],
      },
      {
        ...createDefaultConversations()[0],
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: 10 },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: 11,
          },
        ],
        activeAgentRunId: undefined,
        agentRuns: [],
      },
    ];
    mockActiveConvId = 'conv2';

    render(<ChatScreen />);

    await waitFor(() => {
      expect(mockEvaluateAgentRunWithPilot).toHaveBeenCalledWith(
        expect.objectContaining({
          run: expect.objectContaining({ id: 'run-conv1-1' }),
          workers: expect.arrayContaining([
            expect.objectContaining({ sessionId: 'worker-conv1-1' }),
          ]),
        }),
      );
    });
  });

  it('should preserve separate drafts for each conversation', () => {
    mockConversations = [
      ...createDefaultConversations(),
      {
        id: 'conv2',
        title: 'Second Chat',
        messages: [
          { id: 'conv2-user', role: 'user', content: 'Second hello', timestamp: Date.now() },
          {
            id: 'conv2-assistant',
            role: 'assistant',
            content: 'Second reply',
            timestamp: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerId: 'openai',
        model: 'gpt-5.4',
        systemPrompt: 'You are helpful',
        usage: {
          entries: [],
          totalInput: 0,
          totalOutput: 0,
          totalCacheRead: 0,
          totalCacheWrite: 0,
          totalTokens: 0,
          totalCost: 0,
          totalCalls: 0,
        },
        logs: [],
        agentRuns: [],
      },
    ];

    const screen = render(<ChatScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('Message...'), 'Draft for first conversation');

    act(() => {
      mockActiveConvId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.queryByDisplayValue('Draft for first conversation')).toBeNull();

    fireEvent.changeText(
      screen.getByPlaceholderText('Message...'),
      'Draft for second conversation',
    );

    act(() => {
      mockActiveConvId = 'conv1';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.getByDisplayValue('Draft for first conversation')).toBeTruthy();

    act(() => {
      mockActiveConvId = 'conv2';
      screen.rerender(<ChatScreen />);
    });

    expect(screen.getByDisplayValue('Draft for second conversation')).toBeTruthy();
  });

  it('should handle model selection via ModelSelector', () => {
    // ModelSelector calls onSelect(providerId, model) which triggers handleModelSelect
    // handleModelSelect calls updateModelInConversation and setLastUsedModel
    const { getByText } = render(<ChatScreen />);
    expect(getByText('gpt-5.4')).toBeTruthy();
    // We can verify the ModelSelector renders and the handleModelSelect is properly wired
    // by checking that the component renders without error
  });

  it('should handle export command result', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Export test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    callbacks.onCommandResult({ action: 'export', response: 'Exporting conversation...' });

    expect(mockExportConversationAsMarkdown).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockShareTextExport).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '# Exported',
          fileName: 'Test_Chat.md',
          mimeType: 'text/markdown',
        }),
      );
    });
  });

  it('should share workspace-backed attachments through the shared share service', async () => {
    mockConversations = [
      {
        ...createDefaultConversations()[0],
        messages: [
          { id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Here is the report.',
            timestamp: Date.now(),
            attachments: [
              {
                id: 'attachment-1',
                type: 'file',
                uri: 'file:///mock/document/workspace/conv1/report.md',
                name: 'report.md',
                workspacePath: 'report.md',
              },
            ],
          },
        ],
      },
    ];

    const { getByTestId } = render(<ChatScreen />);

    fireEvent.press(getByTestId('message-bubble-share-workspace-file'));

    await waitFor(() => {
      expect(mockShareConversationWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv1',
          path: 'report.md',
          dialogTitle: 'report.md',
          fallbackConversationIds: [],
        }),
      );
    });
  });

  it('should handle command result with response but no export', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Command test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    callbacks.onCommandResult({ response: 'Some response' });
    expect(mockUpdateMessage).toHaveBeenCalled();
    expect(mockExportConversationAsMarkdown).not.toHaveBeenCalled();
  });

  it('should apply command result responses to the latest assistant turn after a tool handoff', async () => {
    const { getByPlaceholderText, getByTestId } = render(<ChatScreen />);
    const input = getByPlaceholderText('Message...');
    fireEvent.changeText(input, 'Command follow-up test');
    const sendIcon = getByTestId('icon-Send');
    fireEvent.press(sendIcon.parent || sendIcon);

    await waitFor(() => {
      expect(mockRunOrchestrator).toHaveBeenCalledTimes(1);
    });

    const [, callbacks] = mockRunOrchestrator.mock.calls[0];
    act(() => {
      callbacks.onAssistantMessage('Planning tool work', [
        {
          id: 'tool-1',
          name: 'web_search',
          arguments: '{"query":"cleanup"}',
          status: 'pending',
        },
      ]);
      callbacks.onToken('Fresh assistant turn');
    });

    const latestAssistantMessage = [...mockConversations[0].messages]
      .reverse()
      .find((message: any) => message.role === 'assistant' && message.content === '');

    expect(latestAssistantMessage).toBeTruthy();

    mockUpdateMessage.mockClear();
    act(() => {
      callbacks.onCommandResult({ response: 'Command follow-up response' });
    });

    expect(mockUpdateMessage).toHaveBeenCalledWith(
      'conv1',
      latestAssistantMessage!.id,
      'Command follow-up response',
    );
  });
});
