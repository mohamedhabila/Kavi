const mockWaitForStoreHydration = jest.fn().mockResolvedValue(undefined);
const mockFlushChatStorePersistenceNow = jest.fn().mockResolvedValue(undefined);
const mockInitSubAgentRegistry = jest.fn().mockResolvedValue(undefined);
const mockListActiveSubAgents = jest.fn().mockReturnValue([]);
const mockReconcileDurableRecoveryLifecycle = jest.fn().mockResolvedValue(undefined);
const mockRecoverInterruptedForegroundModelExecutions = jest.fn().mockResolvedValue([]);
const mockReleaseStaleModelProjectionOwners = jest.fn().mockResolvedValue(0);
const mockReleaseStaleScheduledProjectionOwners = jest.fn().mockResolvedValue(0);
const mockMaintainForegroundModelExecutionRetention = jest.fn();
const mockMaintainTerminalExecutionRetention = jest.fn();
const mockRepairTerminalAgentRunsMissingFinalResponses = jest.fn().mockResolvedValue([]);
const mockBuildToolEffectRestartDispositionResolver = jest.fn().mockResolvedValue(jest.fn());
const mockListActiveToolEffectRestartInputs = jest.fn().mockReturnValue([]);
const mockChatState = {
  conversations: [] as any[],
  recoverInterruptedAgentRuns: jest.fn(),
};

jest.mock('../../src/store/persistHydration', () => ({
  waitForRequiredStoreHydration: (...args: any[]) => mockWaitForStoreHydration(...args),
}));
jest.mock('../../src/store/chatStorePersistence', () => ({
  flushChatStorePersistenceNow: (...args: any[]) => mockFlushChatStorePersistenceNow(...args),
}));
jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: { getState: () => mockChatState },
}));
jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {},
}));
jest.mock('../../src/services/scheduler/scheduledProjectionRecovery', () => ({
  releaseStaleScheduledProjectionOwners: (...args: any[]) =>
    mockReleaseStaleScheduledProjectionOwners(...args),
}));
jest.mock('../../src/services/agents/subAgent', () => ({
  initSubAgentRegistry: (...args: any[]) => mockInitSubAgentRegistry(...args),
  listActiveSubAgents: (...args: any[]) => mockListActiveSubAgents(...args),
}));
jest.mock('../../src/services/executionJournal/durableRecoveryLifecycle', () => ({
  reconcileDurableRecoveryLifecycle: (...args: any[]) =>
    mockReconcileDurableRecoveryLifecycle(...args),
}));
jest.mock('../../src/services/executionJournal/foregroundModelExecutionRecovery', () => ({
  recoverInterruptedForegroundModelExecutions: (...args: any[]) =>
    mockRecoverInterruptedForegroundModelExecutions(...args),
}));
jest.mock('../../src/services/executionJournal/foregroundExecutionProjectionCleanup', () => ({
  releaseStaleForegroundExecutionProjectionOwners: (...args: any[]) =>
    mockReleaseStaleModelProjectionOwners(...args),
}));
jest.mock('../../src/services/executionJournal/foregroundModelExecutionRetention', () => ({
  maintainForegroundModelExecutionRetention: (...args: any[]) =>
    mockMaintainForegroundModelExecutionRetention(...args),
}));
jest.mock('../../src/services/executionJournal/terminalExecutionRetention', () => ({
  maintainTerminalExecutionRetention: (...args: any[]) =>
    mockMaintainTerminalExecutionRetention(...args),
}));
jest.mock('../../src/services/executionJournal/toolEffectRestartDisposition', () => ({
  buildToolEffectRestartDispositionResolver: (...args: any[]) =>
    mockBuildToolEffectRestartDispositionResolver(...args),
}));
jest.mock('../../src/store/agentRuns/toolCalls', () => ({
  listActiveToolEffectRestartInputs: (...args: any[]) =>
    mockListActiveToolEffectRestartInputs(...args),
}));
jest.mock('../../src/services/agents/agentRunRepair', () => ({
  repairTerminalAgentRunsMissingFinalResponses: (...args: any[]) =>
    mockRepairTerminalAgentRunsMissingFinalResponses(...args),
}));

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  mockWaitForStoreHydration.mockResolvedValue(undefined);
  mockFlushChatStorePersistenceNow.mockResolvedValue(undefined);
  mockInitSubAgentRegistry.mockResolvedValue(undefined);
  mockListActiveSubAgents.mockReturnValue([]);
  mockReconcileDurableRecoveryLifecycle.mockResolvedValue(undefined);
  mockRecoverInterruptedForegroundModelExecutions.mockResolvedValue([]);
  mockReleaseStaleModelProjectionOwners.mockResolvedValue(0);
  mockReleaseStaleScheduledProjectionOwners.mockResolvedValue(0);
  mockRepairTerminalAgentRunsMissingFinalResponses.mockResolvedValue([]);
  mockBuildToolEffectRestartDispositionResolver.mockResolvedValue(jest.fn());
  mockListActiveToolEffectRestartInputs.mockReturnValue([]);
  mockChatState.conversations = [];
});

describe('startup recovery transaction', () => {
  it('holds chat mutation and retention behind the native reconciliation barrier', async () => {
    let releaseNativeRecovery: (() => void) | undefined;
    mockReconcileDurableRecoveryLifecycle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseNativeRecovery = resolve;
        }),
    );
    const { recoverPersistedAgentState } = require('../../src/services/startupRecovery');

    const recovery = recoverPersistedAgentState();
    await flushMicrotasks();
    expect(mockReleaseStaleScheduledProjectionOwners).toHaveBeenCalledTimes(1);
    expect(mockReconcileDurableRecoveryLifecycle).toHaveBeenCalledWith('startup');
    expect(mockRecoverInterruptedForegroundModelExecutions).not.toHaveBeenCalled();
    expect(mockChatState.recoverInterruptedAgentRuns).not.toHaveBeenCalled();
    expect(mockMaintainTerminalExecutionRetention).not.toHaveBeenCalled();

    releaseNativeRecovery?.();
    await recovery;
    expect(
      mockRepairTerminalAgentRunsMissingFinalResponses.mock.invocationCallOrder[0],
    ).toBeLessThan(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]);
    expect(mockFlushChatStorePersistenceNow.mock.invocationCallOrder[0]).toBeLessThan(
      mockMaintainTerminalExecutionRetention.mock.invocationCallOrder[0],
    );
  });

  it('does not prune external proof when recovered chat persistence fails', async () => {
    mockFlushChatStorePersistenceNow.mockRejectedValueOnce(new Error('disk full'));
    const { recoverPersistedAgentState } = require('../../src/services/startupRecovery');

    await expect(recoverPersistedAgentState()).rejects.toThrow('disk full');
    expect(mockMaintainTerminalExecutionRetention).not.toHaveBeenCalled();
  });

  it('fails closed before any other recovery mutation when scheduler projection cleanup fails', async () => {
    mockReleaseStaleScheduledProjectionOwners.mockRejectedValueOnce(
      new Error('scheduler projection cleanup failed'),
    );
    const { recoverPersistedAgentState } = require('../../src/services/startupRecovery');

    await expect(recoverPersistedAgentState()).rejects.toThrow(
      'scheduler projection cleanup failed',
    );
    expect(mockInitSubAgentRegistry).not.toHaveBeenCalled();
    expect(mockReconcileDurableRecoveryLifecycle).not.toHaveBeenCalled();
    expect(mockRecoverInterruptedForegroundModelExecutions).not.toHaveBeenCalled();
    expect(mockChatState.recoverInterruptedAgentRuns).not.toHaveBeenCalled();
  });

  it('repeats the complete transaction on foreground without reinitializing subagents', async () => {
    const {
      triggerForegroundPersistedAgentRecovery,
      triggerPersistedAgentRecovery,
    } = require('../../src/services/startupRecovery');
    await triggerPersistedAgentRecovery();
    jest.clearAllMocks();

    await triggerForegroundPersistedAgentRecovery();

    expect(mockReconcileDurableRecoveryLifecycle).toHaveBeenCalledWith('foreground');
    expect(mockReleaseStaleScheduledProjectionOwners).toHaveBeenCalledTimes(1);
    expect(mockRecoverInterruptedForegroundModelExecutions).toHaveBeenCalledTimes(1);
    expect(mockChatState.recoverInterruptedAgentRuns).toHaveBeenCalledTimes(1);
    expect(mockFlushChatStorePersistenceNow).toHaveBeenCalledTimes(1);
    expect(mockMaintainTerminalExecutionRetention).toHaveBeenCalledTimes(1);
    expect(mockInitSubAgentRegistry).not.toHaveBeenCalled();
  });
});
