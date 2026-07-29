jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { handleTerminalBackgroundReview } from '../../src/screens/terminalBackgroundReviewHandler';
import { completeTerminalBackgroundReviewRun } from '../../src/screens/terminalBackgroundCompletion';
import { closeMemoryDb } from '../../src/services/memory/database';
import { setDurableMemoryPolicyEnabled } from '../../src/services/memory/memoryAuthority';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { AgentRun } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';

jest.mock('../../src/screens/terminalBackgroundCompletion', () => ({
  completeTerminalBackgroundReviewRun: jest.fn(),
}));

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const run: AgentRun = {
  id: 'run-1',
  userMessageId: 'user-1',
  goal: 'Finish background work',
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
  currentPhase: 'work',
  phases: [],
  checkpoints: [],
  summary: {
    assistantTurns: 1,
    startedTools: 1,
    completedTools: 1,
    failedTools: 0,
    spawnedSubAgents: 1,
  },
  controlGraph: {
    version: 1,
    status: 'waiting_async',
    iteration: 1,
    expectedToolCalls: [],
    observedToolResults: [],
    pendingAsyncCount: 1,
    lastModelToolNames: [],
    asyncWork: {
      pendingOperations: [],
      awaitingBackgroundWorkers: true,
      updatedAt: 2,
    },
    performance: {
      modelTurnCount: 1,
      modelDurationMs: 1,
      toolExecutionCount: 1,
      toolExecutionDurationMs: 1,
      lastCandidateToolCount: 1,
      lastActiveToolCount: 1,
      maxActiveToolCount: 1,
      lastActiveToolTokenEstimate: 1,
      maxActiveToolTokenEstimate: 1,
      updatedAt: 2,
    },
    turnDirectives: {
      forceFinalText: false,
      requireWorkflowTool: false,
      incompleteFinalTextRecoveryCount: 0,
    },
    audit: [],
    updatedAt: 2,
    goals: [],
  },
};

const conversation: Conversation = {
  id: 'conversation-1',
  title: 'Background run',
  messages: [{ id: 'user-1', role: 'user', content: run.goal, timestamp: 1 }],
  createdAt: 1,
  updatedAt: 2,
  agentRuns: [run],
};

function mutatePersistedFinalContent(content: string): void {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((candidate) =>
      candidate.id !== conversation.id
        ? candidate
        : {
            ...candidate,
            messages: candidate.messages.map((message) =>
              message.id === 'final-1' ? { ...message, content } : message,
            ),
          },
    ),
  }));
}

async function waitForMockCall(mock: jest.Mock): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mock.mock.calls.length > 0) return;
    await Promise.resolve();
  }
  throw new Error('expected mock call did not occur');
}

function invoke(
  recordConversationTurnMemory: jest.Mock,
  options?: {
    candidateStatus?: 'completed' | 'failed';
    ensureAgentRunFinalResponse?: jest.Mock;
    flushChatState?: jest.Mock;
    targetRun?: AgentRun;
    resumeAgentRun?: jest.Mock;
  },
): Promise<void> {
  const controller = new AbortController();
  const ensureAgentRunFinalResponse =
    options?.ensureAgentRunFinalResponse ??
    jest.fn().mockImplementation(async () => {
      useChatStore.getState().addMessage(conversation.id, {
        id: 'final-1',
        role: 'assistant',
        content: 'Final answer',
        timestamp: 9,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
          finishReason: 'stop',
        },
      });
      return 'Final answer';
    });
  if (!recordConversationTurnMemory.getMockImplementation()) {
    recordConversationTurnMemory.mockResolvedValue({ disposition: 'enqueued', jobId: 'job-1' });
  }
  const currentConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversation.id)!;
  return handleTerminalBackgroundReview({
    appendConversationLog: jest.fn(),
    assertNotAborted: jest.fn(),
    completeAgentRun: jest.fn(),
    conversationId: conversation.id,
    context: {
      conversation: currentConversation,
      targetRun: options?.targetRun ?? run,
      candidateSummary: 'Worker completed.',
      candidateStatus: options?.candidateStatus ?? 'completed',
    },
    ensureAgentRunFinalResponse,
    flushChatState: options?.flushChatState ?? jest.fn().mockResolvedValue(undefined),
    recordConversationTurnMemory,
    resumeAgentRun: options?.resumeAgentRun,
    reviewTimestamp: 10,
    runId: run.id,
    signal: controller.signal,
    setAgentRunPhase: jest.fn(),
    updateAgentRunAsyncWork: jest.fn(),
    updateAgentRunControlGraph: jest.fn(),
    updateAgentRunSummary: jest.fn(),
    updateMessageAssistantMetadata: jest.fn(),
    transitionMessageMemoryPublication: useChatStore.getState().transitionMessageMemoryPublication,
  });
}

describe('terminal background review memory closeout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    setDurableMemoryPolicyEnabled(true);
    useChatStore.setState({
      conversations: [conversation],
      activeConversationId: conversation.id,
      isLoading: false,
    });
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  afterEach(() => {
    closeMemoryDb();
  });

  it('durably publishes memory before the terminal compare-and-set', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
    const recordConversationTurnMemory = jest.fn();

    await invoke(recordConversationTurnMemory);

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(recordConversationTurnMemory).toHaveBeenCalledWith(conversation.id, undefined, {
      sourceEndMessageId: 'final-1',
      memoryConversationId: conversation.id,
      sourceRunId: run.id,
    });
    expect(completeTerminalBackgroundReviewRun).toHaveBeenCalledWith(
      expect.objectContaining({ updateAgentRunControlGraph: expect.any(Function) }),
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(completeTerminalBackgroundReviewRun).mock.invocationCallOrder[0],
    );
  });

  it('reuses the durable publication after losing the terminal compare-and-set race', async () => {
    jest
      .mocked(completeTerminalBackgroundReviewRun)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const recordConversationTurnMemory = jest.fn();

    await invoke(recordConversationTurnMemory);
    await invoke(recordConversationTurnMemory);

    expect(recordConversationTurnMemory).toHaveBeenCalledTimes(1);
    expect(
      useChatStore.getState().conversations[0].messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: 'enqueued' });
    expect(completeTerminalBackgroundReviewRun).toHaveBeenCalledTimes(2);
  });

  it('keeps completion pending until the publication and both receipt flushes settle', async () => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
    let resolvePublication!: (value: { disposition: 'enqueued'; jobId: string }) => void;
    const publicationPromise = new Promise<{ disposition: 'enqueued'; jobId: string }>(
      (resolve) => {
        resolvePublication = resolve;
      },
    );
    const recordConversationTurnMemory = jest.fn(() => publicationPromise);
    const flushChatState = jest.fn().mockResolvedValue(undefined);

    const review = invoke(recordConversationTurnMemory, { flushChatState });
    await waitForMockCall(recordConversationTurnMemory);

    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(flushChatState).toHaveBeenCalledTimes(1);
    expect(
      useChatStore.getState().conversations[0].messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });

    resolvePublication({ disposition: 'enqueued', jobId: 'job-1' });
    await review;

    expect(flushChatState).toHaveBeenCalledTimes(3);
    expect(flushChatState.mock.invocationCallOrder[0]).toBeLessThan(
      recordConversationTurnMemory.mock.invocationCallOrder[0],
    );
    expect(recordConversationTurnMemory.mock.invocationCallOrder[0]).toBeLessThan(
      flushChatState.mock.invocationCallOrder[1],
    );
    expect(flushChatState.mock.invocationCallOrder[1]).toBeLessThan(
      jest.mocked(completeTerminalBackgroundReviewRun).mock.invocationCallOrder[0],
    );
    expect(
      jest.mocked(completeTerminalBackgroundReviewRun).mock.invocationCallOrder[0],
    ).toBeLessThan(flushChatState.mock.invocationCallOrder[2]);
  });

  it('leaves an open receipt and review-eligible run when publication rejects', async () => {
    const publicationError = new Error('publication failed');
    const recordConversationTurnMemory = jest.fn().mockRejectedValue(publicationError);
    const flushChatState = jest.fn().mockResolvedValue(undefined);

    await expect(invoke(recordConversationTurnMemory, { flushChatState })).rejects.toBe(
      publicationError,
    );

    expect(flushChatState).toHaveBeenCalledTimes(1);
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().conversations[0].messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });
  });

  it('rejects a source mutation after publication without completing the run', async () => {
    let resolvePublication!: (value: { disposition: 'enqueued'; jobId: string }) => void;
    const recordConversationTurnMemory = jest.fn(
      () =>
        new Promise<{ disposition: 'enqueued'; jobId: string }>((resolve) => {
          resolvePublication = resolve;
        }),
    );
    const review = invoke(recordConversationTurnMemory);
    await waitForMockCall(recordConversationTurnMemory);

    mutatePersistedFinalContent('Mutated answer');
    resolvePublication({ disposition: 'enqueued', jobId: 'job-1' });

    await expect(review).rejects.toThrow('background_terminal_memory_source_changed');
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().conversations[0].messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: null });
  });

  it.each([1, 2])(
    'revalidates the exact source after receipt flush %i',
    async (mutationFlushNumber) => {
      const recordConversationTurnMemory = jest
        .fn()
        .mockResolvedValue({ disposition: 'enqueued', jobId: 'job-1' });
      const flushChatState = jest.fn().mockImplementation(async () => {
        if (flushChatState.mock.calls.length === mutationFlushNumber) {
          mutatePersistedFinalContent(`Mutated during flush ${mutationFlushNumber}`);
        }
      });

      await expect(invoke(recordConversationTurnMemory, { flushChatState })).rejects.toThrow(
        'background_terminal_memory_source_changed',
      );

      expect(recordConversationTurnMemory).toHaveBeenCalledTimes(mutationFlushNumber - 1);
      expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ disposition: 'enqueued', jobId: 'job-1' }, 'enqueued'],
    [{ disposition: 'opt_out', jobId: null }, 'opt_out'],
    [{ disposition: 'ephemeral_thread', jobId: null }, 'ephemeral_thread'],
    [{ disposition: 'withdrawn', jobId: null }, 'withdrawn'],
  ] as const)(
    'persists the %s publication disposition before completion',
    async (result, expected) => {
      jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
      const recordConversationTurnMemory = jest.fn().mockResolvedValue(result);
      const flushChatState = jest.fn().mockResolvedValue(undefined);

      await invoke(recordConversationTurnMemory, { flushChatState });

      expect(
        useChatStore
          .getState()
          .conversations[0].messages.find((message) => message.id === 'final-1')?.memoryPublication,
      ).toEqual({ version: 1, disposition: expected });
      expect(flushChatState).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    ['opt_out', false],
    ['ephemeral_thread', true],
  ] as const)('skips publication when the initial receipt is %s', async (expected, sideThread) => {
    jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
    useSettingsStore.setState({ disableLongTermMemory: expected === 'opt_out' });
    useChatStore.setState((state) => ({
      conversations: state.conversations.map((candidate) =>
        candidate.id === conversation.id ? { ...candidate, isSideThread: sideThread } : candidate,
      ),
    }));
    const recordConversationTurnMemory = jest.fn();
    const flushChatState = jest.fn().mockResolvedValue(undefined);

    await invoke(recordConversationTurnMemory, { flushChatState });

    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
    expect(
      useChatStore.getState().conversations[0].messages.find((message) => message.id === 'final-1')
        ?.memoryPublication,
    ).toEqual({ version: 1, disposition: expected });
    expect(flushChatState).toHaveBeenCalledTimes(2);
  });

  it('does not transition a completed review when final delivery was not persisted', async () => {
    const recordConversationTurnMemory = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue('Unpersisted preview');

    await invoke(recordConversationTurnMemory, { ensureAgentRunFinalResponse });

    expect(ensureAgentRunFinalResponse).toHaveBeenCalledTimes(1);
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });

  it('does not transition a failed review when its final report was not persisted', async () => {
    const recordConversationTurnMemory = jest.fn();
    const ensureAgentRunFinalResponse = jest.fn().mockResolvedValue('Unpersisted failure');

    await invoke(recordConversationTurnMemory, {
      candidateStatus: 'failed',
      ensureAgentRunFinalResponse,
    });

    expect(ensureAgentRunFinalResponse).toHaveBeenCalledTimes(1);
    expect(completeTerminalBackgroundReviewRun).not.toHaveBeenCalled();
    expect(recordConversationTurnMemory).not.toHaveBeenCalled();
  });

  it.each(['user_constraint_state_conflict', 'goal_evidence_incomplete'])(
    'fails blocked required goals without resuming them (%s)',
    async (blockedReason) => {
      jest.mocked(completeTerminalBackgroundReviewRun).mockReturnValue(true);
      const blockedRun: AgentRun = {
        ...run,
        controlGraph: {
          ...run.controlGraph!,
          goals: [
            {
              id: 'blocked-goal',
              title: 'Required result',
              status: 'blocked',
              dependencies: [],
              evidence: [],
              successCriteria: ['evidence.tool:read_file'],
              completionPolicy: 'blocking',
              blockedReason,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
      };
      useChatStore.setState({
        conversations: [{ ...conversation, agentRuns: [blockedRun] }],
        activeConversationId: conversation.id,
        isLoading: false,
      });
      const resumeAgentRun = jest.fn();

      await invoke(jest.fn(), { targetRun: blockedRun, resumeAgentRun });

      expect(resumeAgentRun).not.toHaveBeenCalled();
      expect(completeTerminalBackgroundReviewRun).toHaveBeenCalledWith(
        expect.objectContaining({
          completion: expect.objectContaining({ status: 'failed' }),
        }),
      );
    },
  );
});
