import { makeTestAgentRun, makeTestConversation } from '../../helpers/factories';
import {
  settleMessageMemoryPublication,
  settleOpenMessageMemoryPublications,
  type MessageMemoryPublicationSettlementDependencies,
} from '../../../src/services/memory/messageMemoryPublicationSettlement';
import type { TransitionMessageMemoryPublicationResult } from '../../../src/store/chatStoreTypes';
import type { Conversation } from '../../../src/types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../../../src/types/message';
import {
  normalizeMessageMemoryPublication,
  resolveMessageMemoryPublicationTransition,
} from '../../../src/utils/messageMemoryPublication';

type JobProof =
  | Readonly<{ status: 'sealed'; jobId: string; withdrawn: boolean }>
  | Readonly<{ status: 'unsealed' }>
  | null;

function user(id: string, timestamp: number): Message {
  return { id, role: 'user', content: id, timestamp };
}

function final(
  id: string,
  timestamp: number,
  disposition: MessageMemoryPublicationDisposition | undefined,
): Message {
  return {
    id,
    role: 'assistant',
    content: id,
    timestamp,
    assistantMetadata: { kind: 'final', completionStatus: 'complete', finishReason: 'stop' },
    ...(disposition !== undefined
      ? { memoryPublication: { version: 1 as const, disposition } }
      : {}),
  };
}

function conversation(
  id: string,
  disposition: MessageMemoryPublicationDisposition | undefined,
  overrides: Partial<Conversation> = {},
): Conversation {
  return makeTestConversation({
    id,
    title: id,
    messages: [user(`${id}-user`, 1), final(`${id}-final`, 2, disposition)],
    ...overrides,
  });
}

function createHarness(
  initialConversations: Conversation[] = [conversation('conversation-1', null)],
) {
  let conversations = initialConversations;
  let memoryEnabled = true;
  let proof: JobProof = null;
  const findExactIngestionJob = jest.fn(() => proof);
  const publishTurnMemory = jest.fn(async () => {
    proof = { status: 'sealed', jobId: 'job-published', withdrawn: false };
    return { disposition: 'enqueued' as const, jobId: 'job-published' };
  });
  const flushChatState = jest.fn(async () => undefined);
  const transitionMessageMemoryPublication = jest.fn(
    (
      conversationId: string,
      sourceEndMessageId: string,
      disposition: MessageMemoryPublicationDisposition,
    ): TransitionMessageMemoryPublicationResult => {
      const conversationIndex = conversations.findIndex((entry) => entry.id === conversationId);
      if (conversationIndex < 0) return { status: 'rejected', reason: 'source_unavailable' };
      const currentConversation = conversations[conversationIndex]!;
      const messageIndex = currentConversation.messages.findIndex(
        (message) => message.id === sourceEndMessageId,
      );
      if (messageIndex < 0) return { status: 'rejected', reason: 'source_unavailable' };
      const currentMessage = currentConversation.messages[messageIndex]!;
      const transition = resolveMessageMemoryPublicationTransition(
        normalizeMessageMemoryPublication(currentMessage.memoryPublication),
        { version: 1, disposition },
      );
      if (!transition.applied) return { status: 'rejected', reason: 'transition_conflict' };
      if (transition.changed) {
        const messages = [...currentConversation.messages];
        messages[messageIndex] = {
          ...currentMessage,
          memoryPublication: transition.publication,
        };
        const next = [...conversations];
        next[conversationIndex] = { ...currentConversation, messages };
        conversations = next;
      }
      return {
        status: 'applied',
        changed: transition.changed,
        publication: transition.publication,
      };
    },
  );
  const dependencies: MessageMemoryPublicationSettlementDependencies = {
    getConversations: () => conversations,
    isMemoryEnabled: () => memoryEnabled,
    findExactIngestionJob,
    publishTurnMemory,
    transitionMessageMemoryPublication,
    flushChatState,
  };
  return {
    dependencies,
    findExactIngestionJob,
    flushChatState,
    getConversations: () => conversations,
    publishTurnMemory,
    setMemoryEnabled: (enabled: boolean) => {
      memoryEnabled = enabled;
    },
    setProof: (nextProof: JobProof) => {
      proof = nextProof;
    },
    transitionMessageMemoryPublication,
  };
}

describe('message memory publication settlement', () => {
  it('never infers or backfills a historical message without a receipt', async () => {
    const harness = createHarness([conversation('conversation-1', undefined)]);

    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        harness.dependencies,
      ),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      sourceEndMessageId: 'conversation-1-final',
      status: 'unclassified',
    });
    expect(harness.publishTurnMemory).not.toHaveBeenCalled();
    expect(harness.transitionMessageMemoryPublication).not.toHaveBeenCalled();
  });

  it('settles opt-out and side-thread sources without touching the memory database', async () => {
    const disabled = createHarness();
    disabled.setMemoryEnabled(false);
    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        disabled.dependencies,
      ),
    ).resolves.toMatchObject({ status: 'settled', disposition: 'opt_out' });

    const sideThread = createHarness([
      conversation('side-thread', null, {
        isSideThread: true,
        parentConversationId: 'parent-thread',
      }),
      conversation('parent-thread', undefined),
    ]);
    await expect(
      settleMessageMemoryPublication(
        { conversationId: 'side-thread', sourceEndMessageId: 'side-thread-final' },
        sideThread.dependencies,
      ),
    ).resolves.toMatchObject({ status: 'settled', disposition: 'ephemeral_thread' });

    expect(disabled.findExactIngestionJob).not.toHaveBeenCalled();
    expect(sideThread.findExactIngestionJob).not.toHaveBeenCalled();
    expect(disabled.publishTurnMemory).not.toHaveBeenCalled();
    expect(sideThread.publishTurnMemory).not.toHaveBeenCalled();
    expect(disabled.flushChatState).toHaveBeenCalledTimes(1);
    expect(sideThread.flushChatState).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 'sealed', jobId: 'job-existing', withdrawn: false } as const, 'enqueued'],
    [{ status: 'sealed', jobId: 'job-existing', withdrawn: true } as const, 'withdrawn'],
  ])('uses an exact sealed job as durable proof: %j', async (jobProof, disposition) => {
    const harness = createHarness();
    harness.setProof(jobProof);

    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ status: 'settled', disposition });

    expect(harness.findExactIngestionJob).toHaveBeenCalledWith({
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'conversation-1',
      sourceEndMessageId: 'conversation-1-final',
    });
    expect(harness.publishTurnMemory).not.toHaveBeenCalled();
  });

  it('refuses an unsealed existing row instead of falsely marking it enqueued', async () => {
    const harness = createHarness();
    harness.setProof({ status: 'unsealed' });

    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        harness.dependencies,
      ),
    ).rejects.toThrow('memory_publication_settlement_job_identity_unsealed');
    expect(harness.publishTurnMemory).not.toHaveBeenCalled();
    expect(harness.getConversations()[0]!.messages[1]!.memoryPublication?.disposition).toBeNull();
  });

  it('publishes only when no exact job exists and proves the returned job before settlement', async () => {
    const harness = createHarness();

    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
          sourceRunId: 'run-1',
        },
        harness.dependencies,
      ),
    ).resolves.toMatchObject({ status: 'settled', disposition: 'enqueued' });

    expect(harness.publishTurnMemory).toHaveBeenCalledWith('conversation-1', undefined, {
      sourceEndMessageId: 'conversation-1-final',
      memoryConversationId: 'conversation-1',
      sourceRunId: 'run-1',
    });
    expect(harness.findExactIngestionJob).toHaveBeenCalledTimes(2);
    expect(harness.flushChatState).toHaveBeenCalledTimes(1);
  });

  it('leaves the receipt open when publication fails or its durable job cannot be proven', async () => {
    const rejected = createHarness();
    rejected.publishTurnMemory.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        rejected.dependencies,
      ),
    ).rejects.toThrow('provider unavailable');

    const unproven = createHarness();
    unproven.publishTurnMemory.mockResolvedValueOnce({
      disposition: 'enqueued',
      jobId: 'missing-job',
    });
    await expect(
      settleMessageMemoryPublication(
        {
          conversationId: 'conversation-1',
          sourceEndMessageId: 'conversation-1-final',
        },
        unproven.dependencies,
      ),
    ).rejects.toThrow('memory_publication_settlement_enqueue_unproven');

    expect(rejected.getConversations()[0]!.messages[1]!.memoryPublication?.disposition).toBeNull();
    expect(unproven.getConversations()[0]!.messages[1]!.memoryPublication?.disposition).toBeNull();
    expect(rejected.flushChatState).not.toHaveBeenCalled();
    expect(unproven.flushChatState).not.toHaveBeenCalled();
  });

  it('settles a stable sweep sequentially and supplies an unambiguous source run', async () => {
    const first = conversation('first', null, {
      agentRuns: [makeTestAgentRun({ id: 'run-first', userMessageId: 'first-user', createdAt: 1 })],
    });
    const second = conversation('second', null);
    const harness = createHarness([first, second]);
    const proofs = new Map<string, JobProof>();
    harness.dependencies.findExactIngestionJob = jest.fn(
      ({ sourceEndMessageId }) => proofs.get(sourceEndMessageId) ?? null,
    );
    harness.publishTurnMemory.mockImplementation(async (conversationId, _provider, options) => {
      const jobId = `job-${conversationId}`;
      proofs.set(options.sourceEndMessageId, {
        status: 'sealed',
        jobId,
        withdrawn: false,
      });
      return { disposition: 'enqueued', jobId };
    });

    await expect(settleOpenMessageMemoryPublications(harness.dependencies)).resolves.toEqual([
      expect.objectContaining({ conversationId: 'first', disposition: 'enqueued' }),
      expect.objectContaining({ conversationId: 'second', disposition: 'enqueued' }),
    ]);
    expect(harness.publishTurnMemory.mock.calls.map((call) => call[0])).toEqual([
      'first',
      'second',
    ]);
    expect(harness.publishTurnMemory.mock.calls[0]![2].sourceRunId).toBe('run-first');
    expect(harness.publishTurnMemory.mock.calls[1]![2].sourceRunId).toBeUndefined();
    expect(harness.flushChatState).toHaveBeenCalledTimes(2);
  });

  it('fails closed when more than one run claims the same open final', async () => {
    const ambiguous = conversation('ambiguous', null, {
      agentRuns: [
        makeTestAgentRun({ id: 'run-1', userMessageId: 'ambiguous-user', createdAt: 1 }),
        makeTestAgentRun({ id: 'run-2', userMessageId: 'ambiguous-user', createdAt: 1 }),
      ],
    });
    const harness = createHarness([ambiguous]);

    await expect(settleOpenMessageMemoryPublications(harness.dependencies)).rejects.toThrow(
      'memory_publication_settlement_source_run_ambiguous',
    );
    expect(harness.publishTurnMemory).not.toHaveBeenCalled();
  });
});
