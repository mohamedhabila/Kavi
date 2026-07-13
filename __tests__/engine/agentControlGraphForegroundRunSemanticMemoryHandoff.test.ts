import { runOrchestrator } from '../../src/engine/orchestrator';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import { resolveForegroundRunPreflight } from '../../src/engine/graph/foregroundRun/preflight';
import { scheduleMemoryIngestionDrainFromAppState } from '../../src/services/memory/lifecycle';
import {
  waitForSemanticMemoryHandoff,
  type SemanticMemoryHandoffConsistencyResult,
} from '../../src/services/memory/semanticMemoryHandoffConsistency';
import { __resetOnDeviceGuardsForTests } from '../../src/services/memory/onDeviceGuards';
import type { Conversation, SemanticMemoryHandoff } from '../../src/types/conversation';
import {
  createConversation,
  createExecutionContext,
  createProvider,
  createReadyPreflightResult,
} from '../helpers/foregroundRunExecutionContextHarness';

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn(),
}));

jest.mock('../../src/engine/graph/foregroundRun/preflight', () => ({
  resolveForegroundRunPreflight: jest.fn(),
}));

jest.mock('../../src/services/memory/lifecycle', () => ({
  scheduleMemoryIngestionDrainFromAppState: jest.fn(),
}));

jest.mock('../../src/services/memory/semanticMemoryHandoffConsistency', () => ({
  waitForSemanticMemoryHandoff: jest.fn(),
}));

const mockedRunOrchestrator = runOrchestrator as jest.MockedFunction<typeof runOrchestrator>;
const mockedResolveForegroundRunPreflight = resolveForegroundRunPreflight as jest.MockedFunction<
  typeof resolveForegroundRunPreflight
>;
const mockedScheduleMemoryIngestionDrain =
  scheduleMemoryIngestionDrainFromAppState as jest.MockedFunction<
    typeof scheduleMemoryIngestionDrainFromAppState
  >;
const mockedWaitForSemanticMemoryHandoff = waitForSemanticMemoryHandoff as jest.MockedFunction<
  typeof waitForSemanticMemoryHandoff
>;

const HANDOFF: SemanticMemoryHandoff = {
  version: 1,
  memoryConversationId: 'source-conversation',
  sourceThreadId: 'source-conversation',
  sourceEndMessageId: 'source-assistant',
};

function consistencyResult(
  overrides: Partial<SemanticMemoryHandoffConsistencyResult>,
): SemanticMemoryHandoffConsistencyResult {
  return {
    outcome: 'ready',
    durationMs: 0,
    waitedMs: 0,
    queryCount: 1,
    matchedJobCount: 1,
    initialJobStatus: 'completed_enriched',
    finalJobStatus: 'completed_enriched',
    unavailableReason: null,
    ...overrides,
  };
}

function createSubject(overrides: Partial<Conversation> = {}) {
  const conversation = createConversation({
    mode: 'chitchat',
    semanticMemoryHandoff: HANDOFF,
    ...overrides,
  });
  const provider = createProvider('target-provider', 'target-model');
  const context = createExecutionContext({
    conversation,
    providers: [provider],
    ensureCanonicalConversation: jest.fn(),
    recordConversationTurnMemory: jest.fn(),
  });
  mockedResolveForegroundRunPreflight.mockResolvedValue(
    createReadyPreflightResult({ conversation, provider }),
  );
  return { context, conversation };
}

describe('foreground semantic memory handoff barrier', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    __resetOnDeviceGuardsForTests();
  });

  it('consumes an enriched handoff before model execution or native effects can start', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(consistencyResult({}));
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedScheduleMemoryIngestionDrain).toHaveBeenCalledTimes(1);
    expect(mockedWaitForSemanticMemoryHandoff).toHaveBeenCalledWith({
      handoff: HANDOFF,
      signal: expect.any(AbortSignal),
    });
    expect(context.getCurrentConversation().semanticMemoryHandoff).toBeUndefined();
    expect(context.durability.flushChatState).toHaveBeenCalled();
    expect(context.durability.createModelExecution).toHaveBeenCalledTimes(1);
    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockedScheduleMemoryIngestionDrain.mock.invocationCallOrder[0]).toBeLessThan(
      mockedWaitForSemanticMemoryHandoff.mock.invocationCallOrder[0],
    );
    expect(mockedWaitForSemanticMemoryHandoff.mock.invocationCallOrder[0]).toBeLessThan(
      context.durability.createModelExecution.mock.invocationCallOrder[0],
    );
    expect(context.durability.createModelExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockedRunOrchestrator.mock.invocationCallOrder[0],
    );
  });

  it('gates a real side-thread run against its parent workspace and exact source thread', async () => {
    const sideHandoff: SemanticMemoryHandoff = {
      version: 1,
      memoryConversationId: 'parent-conversation',
      sourceThreadId: 'previous-side-thread',
      sourceEndMessageId: 'previous-side-assistant',
    };
    const { context, conversation } = createSubject({
      id: 'new-side-thread',
      isSideThread: true,
      parentConversationId: 'parent-conversation',
      semanticMemoryHandoff: sideHandoff,
    });
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(consistencyResult({}));
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedWaitForSemanticMemoryHandoff).toHaveBeenCalledWith({
      handoff: sideHandoff,
      signal: expect.any(AbortSignal),
    });
    expect(mockedRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'new-side-thread',
        memoryConversationId: 'parent-conversation',
        workspaceConversationId: 'parent-conversation',
      }),
      expect.any(Object),
    );
    expect(context.getCurrentConversation().semanticMemoryHandoff).toBeUndefined();
  });

  it.each([
    ['timed_out', 'pending', null],
    ['unavailable', null, 'durable_read_failed'],
    ['unavailable', 'pending', 'policy_changed'],
  ] as const)(
    'fails closed on %s and retains the handoff for a safe retry',
    async (outcome, finalJobStatus, unavailableReason) => {
      const { context, conversation } = createSubject();
      mockedWaitForSemanticMemoryHandoff.mockResolvedValue(
        consistencyResult({
          outcome,
          finalJobStatus,
          unavailableReason,
        }),
      );

      await executeForegroundConversationRun({ context, conversationId: conversation.id });

      expect(context.store.startAgentRun).not.toHaveBeenCalled();
      expect(context.durability.createModelExecution).not.toHaveBeenCalled();
      expect(mockedRunOrchestrator).not.toHaveBeenCalled();
      expect(context.getCurrentConversation().semanticMemoryHandoff).toEqual(HANDOFF);
      expect(context.getCurrentConversation().messages.at(-1)).toEqual(
        expect.objectContaining({
          role: 'assistant',
          isError: true,
          assistantMetadata: expect.objectContaining({ completionStatus: 'incomplete' }),
        }),
      );
      expect(context.helpers.setChatError).toHaveBeenCalledWith(
        'Memory from the previous conversation is not ready yet. Please retry, or restate the detail you need.',
      );
    },
  );

  it('consumes a terminally unavailable handoff and surfaces restatement guidance', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(
      consistencyResult({
        outcome: 'unavailable',
        initialJobStatus: 'completed_structural',
        finalJobStatus: 'completed_structural',
        unavailableReason: 'terminal_job',
      }),
    );

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.getCurrentConversation().semanticMemoryHandoff).toBeUndefined();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.helpers.setChatError).toHaveBeenCalledWith(expect.stringContaining('restate'));
  });

  it('consumes a missing-job handoff so the fresh conversation cannot remain bricked', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(
      consistencyResult({
        outcome: 'unavailable',
        queryCount: 4,
        matchedJobCount: 0,
        initialJobStatus: null,
        finalJobStatus: null,
        unavailableReason: 'missing_job',
      }),
    );
    mockedRunOrchestrator.mockImplementation(async (_options, callbacks) => {
      callbacks.onDone();
      return { terminalDisposition: 'command' };
    });

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.getCurrentConversation().semanticMemoryHandoff).toBeUndefined();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(mockedWaitForSemanticMemoryHandoff).toHaveBeenCalledTimes(1);
    expect(context.durability.createModelExecution).toHaveBeenCalledTimes(1);
    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('fails closed and retains the handoff when synchronization throws', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockRejectedValue(new Error('unexpected read failure'));

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.getCurrentConversation().semanticMemoryHandoff).toEqual(HANDOFF);
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.helpers.setChatError).toHaveBeenCalledWith(expect.stringContaining('retry'));
  });

  it('restores the handoff if its durable consumption cannot be flushed', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(consistencyResult({}));
    context.durability.flushChatState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('handoff flush failed'));

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.getCurrentConversation().semanticMemoryHandoff).toEqual(HANDOFF);
    expect(context.getCurrentConversation().modelProjectionOwner).toBeUndefined();
    expect(context.durability.releaseModelProjection).toHaveBeenCalledTimes(1);
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.helpers.setChatError).toHaveBeenCalledWith(expect.stringContaining('retry'));
  });

  it('does not release a projection it no longer owns while restoring a failed flush', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(consistencyResult({}));
    context.durability.flushChatState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('handoff flush failed'));
    const mutateProjection = context.durability.mutateModelProjection.getMockImplementation()!;
    context.durability.mutateModelProjection
      .mockImplementationOnce(mutateProjection)
      .mockReturnValueOnce({ kind: 'owner_changed' });

    await expect(
      executeForegroundConversationRun({ context, conversationId: conversation.id }),
    ).rejects.toThrow('semantic_memory_handoff_restore_owner_changed');

    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  it('does not terminalize or release after ownership is lost following a successful flush', async () => {
    const { context, conversation } = createSubject();
    mockedWaitForSemanticMemoryHandoff.mockResolvedValue(consistencyResult({}));
    context.durability.ownsModelProjection.mockReturnValueOnce(true).mockReturnValueOnce(false);

    await executeForegroundConversationRun({ context, conversationId: conversation.id });

    expect(context.durability.mutateModelProjection).toHaveBeenCalledTimes(1);
    expect(context.durability.releaseModelProjection).not.toHaveBeenCalled();
    expect(context.durability.createModelExecution).not.toHaveBeenCalled();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
    expect(context.helpers.setChatError).toHaveBeenCalledWith(
      'Foreground response ownership changed.',
    );
  });
});
