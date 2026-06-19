// ---------------------------------------------------------------------------
// Tests — Sub-Agent Run Execution (task stack wiring)
// ---------------------------------------------------------------------------
// Focused on verifying that sub-agent spawn/completion lifecycle correctly
// pushes and completes tasks on the conversation task stack.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

const mockRunSubAgentOrchestratorLoop = jest.fn();
const mockFinalizeCompletedSubAgentRun = jest.fn();
const mockFinalizeFailedSubAgentRun = jest.fn();
const mockCreateSubAgentExecutionSession = jest.fn();
const mockResolveSubAgentRunOutput = jest.fn();

jest.mock('../../../src/services/agents/subAgentOrchestratorRun', () => ({
  runSubAgentOrchestratorLoop: (...args: any[]) => mockRunSubAgentOrchestratorLoop(...args),
}));

jest.mock('../../../src/services/agents/lifecycle/terminalizePhase', () => ({
  finalizeCompletedSubAgentRun: (...args: any[]) => mockFinalizeCompletedSubAgentRun(...args),
  finalizeFailedSubAgentRun: (...args: any[]) => mockFinalizeFailedSubAgentRun(...args),
}));

jest.mock('../../../src/services/agents/lifecycle/terminalOutputResolution', () => ({
  resolveSubAgentRunOutput: (...args: any[]) => mockResolveSubAgentRunOutput(...args),
}));

jest.mock('../../../src/services/agents/subAgentExecutionSession', () => ({
  createSubAgentExecutionSession: (...args: any[]) => mockCreateSubAgentExecutionSession(...args),
}));

jest.mock('../../../src/services/usage/conversationUsage', () => ({
  recordConversationUsageEvent: jest.fn(),
}));

import { closeMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  readTaskStack,
  getActiveTaskId,
} from '../../../src/services/memory/taskStack';
import { runPreparedSubAgentSession } from '../../../src/services/agents/lifecycle/runPhase';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function makeSubAgent(overrides: Partial<any> = {}) {
  return {
    sessionId: 'session-1',
    parentConversationId: 'conv-1',
    parentSessionId: '',
    agentRunId: '',
    name: 'Test Worker',
    depth: 1,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status: 'running',
    sandboxPolicy: 'inherit',
    launchState: 'queued',
    lastProgressAt: Date.now(),
    currentActivity: 'Queued',
    activityLog: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<any> = {}) {
  return {
    parentConversationId: 'conv-1',
    prompt: 'Do the thing',
    name: 'Test Worker',
    ...overrides,
  };
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();

  jest.clearAllMocks();

  mockCreateSubAgentExecutionSession.mockReturnValue({
    transcriptToolCalls: new Map(),
    checkpointSessionContext: jest.fn(),
    persistSessionContextNow: jest.fn(),
    trackToolCall: jest.fn(),
  });

  mockResolveSubAgentRunOutput.mockResolvedValue({
    output: 'Done',
    completionState: { status: 'completed' },
  });

  mockFinalizeCompletedSubAgentRun.mockResolvedValue({
    status: 'completed',
    output: 'Done',
    completionState: { status: 'completed' },
  });

  mockFinalizeFailedSubAgentRun.mockResolvedValue({
    status: 'error',
    output: '',
    completionState: { status: 'error' },
    error: 'Failed',
  });

  mockRunSubAgentOrchestratorLoop.mockResolvedValue(undefined);
});

describe('runPreparedSubAgentSession — task stack', () => {
  it('pushes a task onto the stack and marks it active during execution', async () => {
    let stackDuringExecution: ReturnType<typeof readTaskStack> = [];
    mockRunSubAgentOrchestratorLoop.mockImplementation(async () => {
      stackDuringExecution = readTaskStack('conv-1');
    });

    const subAgent = makeSubAgent();
    const config = makeConfig();

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    expect(stackDuringExecution).toHaveLength(1);
    expect(stackDuringExecution[0].title).toBe('Test Worker');
    expect(stackDuringExecution[0].state).toBe('active');

    // After execution, the task is completed
    const stackAfter = readTaskStack('conv-1');
    expect(stackAfter).toHaveLength(1);
    expect(stackAfter[0].state).toBe('completed');
  });

  it('completes the task when the sub-agent finishes successfully', async () => {
    const subAgent = makeSubAgent();
    const config = makeConfig();

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    const stack = readTaskStack('conv-1');
    expect(stack).toHaveLength(1);
    expect(stack[0].state).toBe('completed');
    expect(getActiveTaskId('conv-1')).toBeNull();
  });

  it('completes the task even when the sub-agent fails', async () => {
    mockRunSubAgentOrchestratorLoop.mockRejectedValue(new Error('Provider down'));

    const subAgent = makeSubAgent();
    const config = makeConfig();

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    const stack = readTaskStack('conv-1');
    expect(stack).toHaveLength(1);
    expect(stack[0].state).toBe('completed');
  });

  it('uses the prompt as task title when name is missing', async () => {
    const subAgent = makeSubAgent();
    const config = makeConfig({
      name: undefined,
      prompt: 'Write comprehensive test suite for the auth module',
    });

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    const stack = readTaskStack('conv-1');
    expect(stack[0].title).toBe('Write comprehensive test suite for the auth module');
  });

  it('truncates prompt-based titles to 80 chars', async () => {
    const longPrompt = 'a'.repeat(200);
    const subAgent = makeSubAgent();
    const config = makeConfig({ name: undefined, prompt: longPrompt });

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    const stack = readTaskStack('conv-1');
    expect(stack[0].title.length).toBeLessThanOrEqual(80);
  });

  it('does not push a task when parentConversationId is missing', async () => {
    const subAgent = makeSubAgent();
    const config = makeConfig({ parentConversationId: '' });

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    expect(readTaskStack('conv-1')).toHaveLength(0);
  });

  it('survives a task-stack push failure without breaking execution', async () => {
    // Corrupt the working block to make pushTask throw on write
    const { editWorkingBlock } = require('../../../src/services/memory/workingBlocks');
    editWorkingBlock('task_stack', 'not-valid-json', {
      conversationId: 'conv-1',
      threadId: 'conv-1',
    });

    const subAgent = makeSubAgent();
    const config = makeConfig();

    await runPreparedSubAgentSession({
      prepared: {
        sessionId: 'session-1',
        depth: 1,
        maxIterations: 10,
        sandboxPolicy: 'inherit',
        subAgent,
      },
      config,
      provider: { id: 'test', name: 'Test', enabled: true } as any,
      activeRunControls: new Map(),
      appendActivity: jest.fn(),
      appendTranscriptMessage: jest.fn(),
      announce: jest.fn(),
      clearPendingSessionContextCheckpoint: jest.fn(),
      clearSessionContextEviction: jest.fn(),
      finalizationMaxTranscriptMessages: 100,
      finalizationMessageCharLimit: 1000,
      finalizationMinRemainingMs: 1000,
      finalizationTimeoutCapMs: 30000,
      finalizationToolContentCharLimit: 1000,
      markModelResponseObserved: jest.fn(),
      maxToolResultPreviewChars: 100,
      persistRegistryBestEffort: jest.fn().mockResolvedValue({}),
      refreshSubAgentArtifacts: jest.fn(),
      sanitizeTranscriptMessage: (m: any) => m,
      scheduleRegistryPersist: jest.fn(),
      scheduleSessionContextCheckpoint: jest.fn(),
      scheduleSessionContextEvictionWhenDurable: jest.fn(),
      storeSessionContext: jest.fn(),
      updateAgentProgress: jest.fn(),
    });

    // Execution should complete even though pushTask failed
    expect(mockFinalizeCompletedSubAgentRun).toHaveBeenCalled();
  });
});
