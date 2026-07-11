import { mockChatScreenState } from './state';

jest.mock('../../src/services/startupRecovery', () => ({
  recoverPersistedAgentState: jest.fn().mockResolvedValue(undefined),
  triggerForegroundJournalRecovery: jest.fn().mockResolvedValue(undefined),
  triggerPersistedAgentRecovery: jest.fn().mockResolvedValue(undefined),
  waitForPersistedAgentRecoveryReadiness: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/executionJournal/foregroundModelExecutionJournal', () => ({
  activateForegroundModelExecution: jest.fn(async ({ lease }: any) => ({
    ...lease,
    expectedStatus: 'running',
    updatedAt: 2,
    checkpointId: `active-${lease.assistantMessageId}`,
  })),
  completeForegroundModelExecution: jest.fn().mockResolvedValue(undefined),
  createForegroundModelExecution: jest.fn(async (input: any) => ({
    runId: `foreground-model-${input.assistantMessageId}`,
    conversationId: input.conversationId,
    requestMessageId: input.requestMessageId,
    assistantMessageId: input.assistantMessageId,
    taskId: input.taskId ?? null,
    createdAt: 1,
    expectedStatus: 'queued',
    controlEpoch: 0,
    updatedAt: 1,
    checkpointId: `created-${input.assistantMessageId}`,
    checkpointStateDigest: 'a'.repeat(64),
  })),
  foregroundModelProjectionOwnerForLease: (lease: any) => ({
    runId: lease.runId,
    requestMessageId: lease.requestMessageId,
    assistantMessageId: lease.assistantMessageId,
    controlEpoch: lease.controlEpoch,
  }),
}));

jest.mock('../../src/services/executionJournal/foregroundModelExecutionProcessOwnership', () => ({
  relinquishForegroundModelExecutionProcessOwnership: jest.fn(),
}));

export const mockCancelOwnedExternalRecoveries = jest.fn().mockResolvedValue({
  cancelledRunCount: 0,
  settledRunCount: 0,
  issues: [],
});
jest.mock('../../src/services/executionJournal/foregroundExternalRecoveryCancellation', () => ({
  cancelOwnedExternalRecoveries: (...args: any[]) => mockCancelOwnedExternalRecoveries(...args),
}));

jest.mock('../../src/store/foregroundModelProjectionOwnership', () => {
  const ownersEqual = (left: any, right: any) =>
    Boolean(left) &&
    left.runId === right.runId &&
    left.requestMessageId === right.requestMessageId &&
    left.assistantMessageId === right.assistantMessageId &&
    left.controlEpoch === right.controlEpoch;

  return {
    claimForegroundModelProjection: jest.fn((input: any) => {
      const conversation = mockChatScreenState.conversations.find(
        (candidate) => candidate.id === input.conversationId,
      );
      if (!conversation) return 'conversation_missing';
      if (
        conversation.foregroundModelProjectionOwner &&
        !ownersEqual(conversation.foregroundModelProjectionOwner, input.owner)
      ) {
        return 'owner_conflict';
      }
      const assistant = conversation.messages.find(
        (message: any) => message.id === input.owner.assistantMessageId,
      );
      if (assistant && assistant.role !== 'assistant') return 'assistant_invalid';
      if (!assistant && !input.assistantMessage) return 'assistant_missing';
      if (
        input.assistantMessage &&
        (input.assistantMessage.id !== input.owner.assistantMessageId ||
          input.assistantMessage.role !== 'assistant')
      ) {
        return 'assistant_invalid';
      }
      mockChatScreenState.conversations = mockChatScreenState.conversations.map((candidate) =>
        candidate.id !== input.conversationId
          ? candidate
          : {
              ...candidate,
              foregroundModelProjectionOwner: input.owner,
              messages: assistant
                ? candidate.messages
                : [...candidate.messages, input.assistantMessage],
            },
      );
      return 'claimed';
    }),
    ownsForegroundModelProjection: jest.fn((conversationId: string, owner: any) =>
      mockChatScreenState.conversations.some(
        (conversation) =>
          conversation.id === conversationId &&
          ownersEqual(conversation.foregroundModelProjectionOwner, owner),
      ),
    ),
    releaseForegroundModelProjection: jest.fn((input: any) => {
      const conversation = mockChatScreenState.conversations.find(
        (candidate) => candidate.id === input.conversationId,
      );
      if (!conversation) return 'conversation_missing';
      if (!ownersEqual(conversation.foregroundModelProjectionOwner, input.owner)) {
        return 'owner_changed';
      }
      mockChatScreenState.conversations = mockChatScreenState.conversations.map((candidate) =>
        candidate.id === input.conversationId
          ? { ...candidate, foregroundModelProjectionOwner: undefined }
          : candidate,
      );
      return 'released';
    }),
    waitForForegroundModelProjectionAvailability: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('../../src/store/chatStorePersistence', () => ({
  CHAT_STORE_CHECKPOINT_DELAY_MS: 750,
  flushChatStorePersistenceNow: jest.fn().mockResolvedValue(undefined),
  requestChatStorePersistenceCheckpoint: jest.fn(),
}));

export const mockGetProviderApiKey = jest.fn().mockResolvedValue('sk-test');
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: (...args: any[]) => mockGetProviderApiKey(...args),
}));

export const mockCollectAgentRunFinalizationEvidence = jest.fn();
export const mockBuildAgentRunToolResultFallback = jest.fn();
export const mockBuildAgentRunCompletionFallbackOutput = jest.fn();
export const mockBuildAgentRunVisibleDraftRecoveryText = jest.fn();
export const mockBuildMissingFinalResponseFallback = jest.fn();
export const mockCanRecoverAgentRunFinalResponse = jest.fn();
export const mockHasCompletedExecutionRecoveryEvidence = jest.fn();
export const mockHasVerifiedFinalizationEvidence = jest.fn();
export const mockSynthesizeAgentRunFinalAnswer = jest.fn();
jest.mock('../../src/services/agents/lifecycle/finalizePhase', () => ({
  collectAgentRunFinalizationEvidence: (...args: any[]) =>
    mockCollectAgentRunFinalizationEvidence(...args),
  buildAgentRunToolResultFallback: (...args: any[]) => mockBuildAgentRunToolResultFallback(...args),
  buildAgentRunCompletionFallbackOutput: (...args: any[]) =>
    mockBuildAgentRunCompletionFallbackOutput(...args),
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

export const mockEvaluateAgentRunWithPilot = jest.fn();

export const mockCancelSubAgent = jest.fn();
jest.mock('../../src/services/agents/subAgent', () => ({
  listActiveSubAgents: jest.fn(() => mockChatScreenState.activeSubAgents),
  cancelSubAgent: (...args: any[]) => mockCancelSubAgent(...args),
  onSubAgentEvent: jest.fn((listener: any) => {
    mockChatScreenState.subAgentListener = listener;
    return () => {
      if (mockChatScreenState.subAgentListener === listener) {
        mockChatScreenState.subAgentListener = null;
      }
    };
  }),
}));

export function holdMockOrchestratorUntilAbort(options: {
  signal?: AbortController;
}): Promise<void> {
  const signal = options.signal?.signal;
  if (!signal) {
    throw new Error('In-flight orchestrator tests require an AbortController.');
  }
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export const mockRunOrchestrator = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: (...args: any[]) => mockRunOrchestrator(...args),
}));

export const mockExportConversationAsMarkdown = jest.fn().mockReturnValue('# Exported');
jest.mock('../../src/services/session/manager', () => ({
  exportConversationAsMarkdown: (...args: any[]) => mockExportConversationAsMarkdown(...args),
}));

export const mockShareTextExport = jest.fn().mockResolvedValue({
  fileName: 'Test_Chat.md',
  fileUri: 'file:///cache/test.md',
});
export const mockShareConversationWorkspaceFile = jest.fn().mockResolvedValue({
  fileName: 'workspace.txt',
  fileUri: 'file:///docs/workspace.txt',
});
export const mockImportConversationWorkspaceAttachment = jest.fn();
jest.mock('../../src/services/share/localShare', () => ({
  shareTextExport: (...args: any[]) => mockShareTextExport(...args),
  shareConversationWorkspaceFile: (...args: any[]) => mockShareConversationWorkspaceFile(...args),
}));

jest.mock('../../src/services/conversationWorkspace/attachments', () => ({
  importConversationWorkspaceAttachment: (...args: any[]) =>
    mockImportConversationWorkspaceAttachment(...args),
}));

export const mockShareAsync = jest.fn().mockResolvedValue(undefined);
export const mockIsAvailableAsync = jest.fn().mockResolvedValue(true);
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: any[]) => mockShareAsync(...args),
  isAvailableAsync: (...args: any[]) => mockIsAvailableAsync(...args),
}));

export const mockFileWrite = jest.fn();
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((_dir: string, _name: string) => ({
    uri: 'file:///cache/test.md',
    write: mockFileWrite,
  })),
  Paths: { cache: '/cache', document: '/docs' },
}));
