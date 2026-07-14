import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../agents/lifecycle/agentRunStateMachine';
import { resolveConversationWorkspaceTarget } from '../conversationWorkspace/ownership';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import type { TransitionMessageMemoryPublicationResult } from '../../store/chatStoreTypes';
import { useChatStore } from '../../store/useChatStore';
import type { Conversation } from '../../types/conversation';
import type { MessageMemoryPublicationDisposition } from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import {
  isEligibleMessageMemoryPublicationSource,
  isTerminalMessageMemoryPublication,
  normalizeMessageMemoryPublication,
} from '../../utils/messageMemoryPublication';
import { getIngestionJobForSourceTurn } from './ingestionQueueStore';
import { hasSealedIngestionJobIdentity } from './ingestionQueueIdentity';
import { canWriteLongTermMemory } from './policy';
import { advanceConsolidationCursorPastExcludedPublications } from './consolidation/publicationExclusion';
import {
  publishConversationTurnMemory,
  type MemoryTurnPublicationResult,
  type RecordConversationTurnMemory,
} from './turnPublication';
import { isMemoryIngestionSourceWithdrawn } from './withdrawalFence';

type TerminalPublicationDisposition = Exclude<MessageMemoryPublicationDisposition, null>;

export type MessageMemoryPublicationSettlementResult = Readonly<{
  conversationId: string;
  sourceEndMessageId: string;
  status: 'unclassified' | 'terminal' | 'settled';
  disposition?: TerminalPublicationDisposition;
}>;

type ExactIngestionJobProof =
  | Readonly<{ status: 'sealed'; jobId: string; withdrawn: boolean }>
  | Readonly<{ status: 'unsealed' }>
  | null;

export interface MessageMemoryPublicationSettlementDependencies {
  getConversations(): Conversation[];
  isMemoryEnabled(): boolean;
  findExactIngestionJob(params: {
    memoryConversationId: string;
    sourceThreadId: string;
    sourceEndMessageId: string;
  }): ExactIngestionJobProof;
  publishTurnMemory: RecordConversationTurnMemory;
  transitionMessageMemoryPublication(
    conversationId: string,
    sourceEndMessageId: string,
    disposition: MessageMemoryPublicationDisposition,
  ): TransitionMessageMemoryPublicationResult;
  advanceOptOutCursor?(conversation: Conversation, sourceEndMessageId: string): void;
  flushChatState(): Promise<void>;
}

const DEFAULT_DEPENDENCIES: MessageMemoryPublicationSettlementDependencies = {
  getConversations: () => useChatStore.getState().conversations,
  isMemoryEnabled: canWriteLongTermMemory,
  findExactIngestionJob: (params) => {
    const job = getIngestionJobForSourceTurn(params);
    if (!job) return null;
    if (!hasSealedIngestionJobIdentity(job)) return { status: 'unsealed' };
    return {
      status: 'sealed',
      jobId: job.id,
      withdrawn: isMemoryIngestionSourceWithdrawn({
        memoryConversationId: job.memoryConversationId,
        sourceThreadId: job.threadId,
        taskId: job.taskId,
        sourceStartMessageId: job.sourceStartMessageId,
        sourceEndMessageId: job.sourceEndMessageId,
        sourceRunId: job.sourceRunId,
      }),
    };
  },
  publishTurnMemory: publishConversationTurnMemory,
  transitionMessageMemoryPublication: (conversationId, sourceEndMessageId, disposition) =>
    useChatStore
      .getState()
      .transitionMessageMemoryPublication(conversationId, sourceEndMessageId, disposition),
  advanceOptOutCursor: (conversation, sourceEndMessageId) => {
    advanceConsolidationCursorPastExcludedPublications({
      threadId: conversation.id,
      messages: conversation.messages,
      sourceEndMessageIds: [sourceEndMessageId],
    });
  },
  flushChatState: flushChatStorePersistenceNow,
};

function fail(code: string): never {
  throw new Error(code);
}

function readExactSource(
  dependencies: MessageMemoryPublicationSettlementDependencies,
  conversationId: string,
  sourceEndMessageId: string,
): {
  conversation: Conversation;
  disposition: MessageMemoryPublicationDisposition | undefined;
} {
  const conversations = dependencies
    .getConversations()
    .filter((conversation) => conversation.id === conversationId);
  if (conversations.length !== 1) {
    return fail(
      conversations.length === 0
        ? 'memory_publication_settlement_conversation_unavailable'
        : 'memory_publication_settlement_conversation_identity_invalid',
    );
  }

  const conversation = conversations[0]!;
  const sources = conversation.messages.filter((message) => message.id === sourceEndMessageId);
  if (sources.length !== 1) {
    return fail(
      sources.length === 0
        ? 'memory_publication_settlement_source_unavailable'
        : 'memory_publication_settlement_source_identity_invalid',
    );
  }

  const source = sources[0]!;
  const publication = normalizeMessageMemoryPublication(source.memoryPublication);
  if (source.memoryPublication !== undefined && publication === undefined) {
    return fail('memory_publication_settlement_receipt_invalid');
  }
  if (publication && !isEligibleMessageMemoryPublicationSource(source)) {
    return fail('memory_publication_settlement_source_ineligible');
  }
  return { conversation, disposition: publication?.disposition };
}

function result(
  conversationId: string,
  sourceEndMessageId: string,
  status: MessageMemoryPublicationSettlementResult['status'],
  disposition?: TerminalPublicationDisposition,
): MessageMemoryPublicationSettlementResult {
  return {
    conversationId,
    sourceEndMessageId,
    status,
    ...(disposition ? { disposition } : {}),
  };
}

async function transitionOpenSourceToTerminal(params: {
  conversationId: string;
  dependencies: MessageMemoryPublicationSettlementDependencies;
  disposition: TerminalPublicationDisposition;
  sourceEndMessageId: string;
}): Promise<MessageMemoryPublicationSettlementResult> {
  if (params.disposition === 'opt_out') {
    const source = readExactSource(
      params.dependencies,
      params.conversationId,
      params.sourceEndMessageId,
    );
    params.dependencies.advanceOptOutCursor?.(source.conversation, params.sourceEndMessageId);
  }
  const transition = params.dependencies.transitionMessageMemoryPublication(
    params.conversationId,
    params.sourceEndMessageId,
    params.disposition,
  );
  if (transition.status === 'applied') {
    if (transition.changed) await params.dependencies.flushChatState();
    return result(
      params.conversationId,
      params.sourceEndMessageId,
      'settled',
      transition.publication.disposition as TerminalPublicationDisposition,
    );
  }

  const current = readExactSource(
    params.dependencies,
    params.conversationId,
    params.sourceEndMessageId,
  );
  const publication = normalizeMessageMemoryPublication({
    version: 1,
    disposition: current.disposition,
  });
  if (isTerminalMessageMemoryPublication(publication)) {
    return result(
      params.conversationId,
      params.sourceEndMessageId,
      'terminal',
      publication.disposition,
    );
  }
  return fail(`memory_publication_settlement_transition_${transition.reason}`);
}

function resolvePublishedDisposition(params: {
  proof: ExactIngestionJobProof;
  publication: MemoryTurnPublicationResult;
}): TerminalPublicationDisposition {
  if (params.publication.disposition !== 'enqueued') return params.publication.disposition;
  if (params.proof?.status !== 'sealed' || params.proof.jobId !== params.publication.jobId) {
    return fail('memory_publication_settlement_enqueue_unproven');
  }
  return params.proof.withdrawn ? 'withdrawn' : 'enqueued';
}

/**
 * Settle one explicitly open exact-turn receipt. Missing receipts are historical
 * and deliberately never inferred or backfilled.
 */
export async function settleMessageMemoryPublication(
  params: {
    conversationId: string;
    sourceEndMessageId: string;
    sourceRunId?: string;
    activeChatProvider?: LlmProviderConfig;
  },
  dependencies: MessageMemoryPublicationSettlementDependencies = DEFAULT_DEPENDENCIES,
): Promise<MessageMemoryPublicationSettlementResult> {
  let source = readExactSource(dependencies, params.conversationId, params.sourceEndMessageId);
  if (source.disposition === undefined) {
    return result(params.conversationId, params.sourceEndMessageId, 'unclassified');
  }
  if (source.disposition !== null) {
    return result(params.conversationId, params.sourceEndMessageId, 'terminal', source.disposition);
  }

  let targetDisposition: TerminalPublicationDisposition;
  if (!dependencies.isMemoryEnabled()) {
    targetDisposition = 'opt_out';
  } else if (source.conversation.isSideThread) {
    targetDisposition = 'ephemeral_thread';
  } else {
    const memoryConversationId = resolveConversationWorkspaceTarget({
      conversationId: params.conversationId,
      conversations: dependencies.getConversations(),
    }).workspaceConversationId;
    let proof = dependencies.findExactIngestionJob({
      memoryConversationId,
      sourceThreadId: params.conversationId,
      sourceEndMessageId: params.sourceEndMessageId,
    });
    if (proof?.status === 'unsealed') {
      return fail('memory_publication_settlement_job_identity_unsealed');
    }

    if (proof?.status === 'sealed') {
      targetDisposition = proof.withdrawn ? 'withdrawn' : 'enqueued';
    } else {
      const publication = await dependencies.publishTurnMemory(
        params.conversationId,
        params.activeChatProvider,
        {
          sourceEndMessageId: params.sourceEndMessageId,
          memoryConversationId,
          sourceRunId: params.sourceRunId,
        },
      );
      proof =
        publication.disposition === 'enqueued'
          ? dependencies.findExactIngestionJob({
              memoryConversationId,
              sourceThreadId: params.conversationId,
              sourceEndMessageId: params.sourceEndMessageId,
            })
          : null;
      targetDisposition = resolvePublishedDisposition({ proof, publication });
    }
  }

  source = readExactSource(dependencies, params.conversationId, params.sourceEndMessageId);
  if (source.disposition !== null) {
    if (source.disposition === undefined) {
      return fail('memory_publication_settlement_receipt_removed');
    }
    return result(params.conversationId, params.sourceEndMessageId, 'terminal', source.disposition);
  }
  if (!dependencies.isMemoryEnabled()) targetDisposition = 'opt_out';
  if (source.conversation.isSideThread) targetDisposition = 'ephemeral_thread';

  return transitionOpenSourceToTerminal({
    conversationId: params.conversationId,
    dependencies,
    disposition: targetDisposition,
    sourceEndMessageId: params.sourceEndMessageId,
  });
}

function resolveUniqueSourceRunId(
  conversation: Conversation,
  sourceEndMessageId: string,
): string | undefined {
  const matchingRunIds = (conversation.agentRuns ?? []).flatMap((run) => {
    const final = getLatestAssistantProjectionFinalResponse(
      conversation.messages,
      buildAgentRunMessageScope(run),
    );
    return final?.id === sourceEndMessageId ? [run.id] : [];
  });
  if (matchingRunIds.length > 1) {
    return fail('memory_publication_settlement_source_run_ambiguous');
  }
  return matchingRunIds[0];
}

/** Settle every explicit open receipt in stable conversation/message order. */
export async function settleOpenMessageMemoryPublications(
  dependencies: MessageMemoryPublicationSettlementDependencies = DEFAULT_DEPENDENCIES,
): Promise<MessageMemoryPublicationSettlementResult[]> {
  const candidates = dependencies.getConversations().flatMap((conversation) =>
    conversation.messages.flatMap((message) =>
      normalizeMessageMemoryPublication(message.memoryPublication)?.disposition === null
        ? [
            {
              conversationId: conversation.id,
              sourceEndMessageId: message.id,
              sourceRunId: resolveUniqueSourceRunId(conversation, message.id),
            },
          ]
        : [],
    ),
  );
  const settlements: MessageMemoryPublicationSettlementResult[] = [];
  for (const candidate of candidates) {
    settlements.push(await settleMessageMemoryPublication(candidate, dependencies));
  }
  return settlements;
}
