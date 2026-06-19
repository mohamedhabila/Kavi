import { mockChatScreenState } from './state';

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
