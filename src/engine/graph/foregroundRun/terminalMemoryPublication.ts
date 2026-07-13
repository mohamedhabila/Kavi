import type { OrchestratorTerminalDisposition } from '../../orchestrator/types';
import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../../../types/message';
import type { ChatState } from '../../../store/chatStoreTypes';
import type { RecordConversationTurnMemory } from '../../../services/memory/turnPublication';
import { canWriteLongTermMemory } from '../../../services/memory/policy';
import { resolveConversationWorkspaceTarget } from '../../../services/conversationWorkspace/ownership';
import {
  isTerminalMessageMemoryPublication,
  normalizeMessageMemoryPublication,
} from '../../../utils/messageMemoryPublication';
import type { ResolvedFinalizationProviderContext } from './contracts';
import type { ForegroundRunTerminalStatus } from './terminalLifecycle';
import {
  fingerprintForegroundTerminalMemorySource,
  resolveForegroundTerminalMemorySource,
} from './terminalMemorySource';

type ForegroundJournalStatus = ForegroundRunTerminalStatus;
type TerminalPublicationDisposition = Exclude<MessageMemoryPublicationDisposition, null>;

function findTrackedRun(
  conversation: Conversation | undefined,
  runId: string | undefined,
): AgentRun | undefined {
  return runId ? conversation?.agentRuns?.find((run) => run.id === runId) : undefined;
}

function normalizeJournalStatus(
  status: ForegroundRunTerminalStatus,
  trackedRun: AgentRun | undefined,
): ForegroundJournalStatus {
  if (status !== 'succeeded') return status;
  if (trackedRun?.status === 'failed') return 'failed';
  if (trackedRun?.status === 'cancelled') return 'cancelled';
  return status;
}

function isTrackedRunContinuing(run: AgentRun | undefined): boolean {
  return (
    run?.status === 'running' &&
    (run.controlGraph?.status === 'yielded' ||
      run.controlGraph?.status === 'waiting_async' ||
      run.controlGraph?.asyncWork.awaitingBackgroundWorkers === true ||
      (run.controlGraph?.asyncWork.pendingOperations.length ?? 0) > 0)
  );
}

function resolveInitialPublicationDisposition(params: {
  conversation: Conversation;
  source: Message;
  transitionMessageMemoryPublication: ChatState['transitionMessageMemoryPublication'];
}): MessageMemoryPublicationDisposition {
  const current = normalizeMessageMemoryPublication(params.source.memoryPublication);
  if (params.source.memoryPublication !== undefined && current === undefined) {
    throw new Error('foreground_terminal_memory_publication_invalid');
  }
  if (isTerminalMessageMemoryPublication(current)) return current.disposition;

  const disposition: MessageMemoryPublicationDisposition = !canWriteLongTermMemory()
    ? 'opt_out'
    : params.conversation.isSideThread
      ? 'ephemeral_thread'
      : null;
  const transition = params.transitionMessageMemoryPublication(
    params.conversation.id,
    params.source.id,
    disposition,
  );
  if (transition.status !== 'applied') {
    throw new Error(`foreground_terminal_memory_publication_${transition.reason}`);
  }
  return transition.publication.disposition;
}

function transitionToTerminalPublication(params: {
  conversationId: string;
  disposition: TerminalPublicationDisposition;
  sourceMessageId: string;
  transitionMessageMemoryPublication: ChatState['transitionMessageMemoryPublication'];
}): void {
  const transition = params.transitionMessageMemoryPublication(
    params.conversationId,
    params.sourceMessageId,
    params.disposition,
  );
  if (transition.status !== 'applied') {
    throw new Error(`foreground_terminal_memory_publication_${transition.reason}`);
  }
}

function assertMemoryConversationCurrent(params: {
  conversationId: string;
  conversations: readonly Conversation[];
  memoryConversationId: string;
}): void {
  const matches = params.conversations.filter(
    (conversation) => conversation.id === params.conversationId,
  );
  if (matches.length !== 1) {
    throw new Error('foreground_terminal_memory_conversation_changed');
  }
  const current = resolveConversationWorkspaceTarget({
    conversationId: params.conversationId,
    conversations: params.conversations,
  }).workspaceConversationId;
  if (current !== params.memoryConversationId) {
    throw new Error('foreground_terminal_memory_conversation_changed');
  }
}

function revalidateTerminalMemorySource(params: {
  conversationId: string;
  currentAssistantMessageId: string;
  expectedFingerprint: string;
  expectedSourceId: string;
  getConversation: () => Conversation | undefined;
  getConversations: () => Conversation[];
  memoryConversationId: string;
  runId: string | undefined;
  status: ForegroundRunTerminalStatus;
}): Conversation {
  const conversation = params.getConversation();
  const source = resolveForegroundTerminalMemorySource({
    conversation,
    currentAssistantMessageId: params.currentAssistantMessageId,
    runId: params.runId,
    status: params.status,
  });
  if (source?.id !== params.expectedSourceId || !conversation) {
    throw new Error('foreground_terminal_memory_source_changed');
  }
  if (
    fingerprintForegroundTerminalMemorySource({
      conversation,
      source,
      sourceRunId: params.runId,
    }) !== params.expectedFingerprint
  ) {
    throw new Error('foreground_terminal_memory_source_changed');
  }
  assertMemoryConversationCurrent({
    conversationId: params.conversationId,
    conversations: params.getConversations(),
    memoryConversationId: params.memoryConversationId,
  });
  return conversation;
}

function resolveMissingSourceJournalStatus(params: {
  allowIncompleteHandoff: boolean;
  conversation: Conversation | undefined;
  currentAssistantMessageId: string;
  journalStatus: ForegroundJournalStatus;
  orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  runId: string | undefined;
  trackedRun: AgentRun | undefined;
}): ForegroundJournalStatus {
  if (
    params.journalStatus !== 'succeeded' ||
    params.orchestratorTerminalDisposition === 'command'
  ) {
    return params.journalStatus;
  }

  if (params.allowIncompleteHandoff && params.runId && params.trackedRun?.status === 'running') {
    return params.journalStatus;
  }
  if (params.runId && isTrackedRunContinuing(params.trackedRun)) {
    return params.journalStatus;
  }
  if (params.runId) {
    throw new Error('foreground_terminal_memory_agent_final_unavailable');
  }

  const currentAssistant = params.conversation?.messages.find(
    (message) => message.id === params.currentAssistantMessageId && message.role === 'assistant',
  );
  if (
    currentAssistant?.assistantMetadata?.kind === 'final' &&
    currentAssistant.assistantMetadata.completionStatus === 'incomplete'
  ) {
    return 'failed';
  }
  throw new Error('foreground_terminal_memory_untracked_final_unavailable');
}

export async function publishForegroundTerminalMemory(params: {
  allowIncompleteHandoff: boolean;
  assertProjectionOwnership: () => void;
  conversation: Conversation | undefined;
  conversationId: string;
  currentAssistantMessageId: string;
  finalizationProviderContext: ResolvedFinalizationProviderContext;
  flushChatState: () => Promise<void>;
  getConversation: () => Conversation | undefined;
  getConversations: () => Conversation[];
  memoryConversationId: string;
  orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  runId: string | undefined;
  status: ForegroundRunTerminalStatus;
  transitionMessageMemoryPublication: ChatState['transitionMessageMemoryPublication'];
}): Promise<{
  conversation: Conversation | undefined;
  journalStatus: ForegroundJournalStatus;
  projectionMessageId: string;
  terminalMemorySourceId?: string;
}> {
  let conversation = params.conversation;
  let projectionMessageId = params.currentAssistantMessageId;
  const trackedRun = findTrackedRun(conversation, params.runId);
  let journalStatus = normalizeJournalStatus(params.status, trackedRun);
  const source = resolveForegroundTerminalMemorySource({
    conversation,
    currentAssistantMessageId: projectionMessageId,
    runId: params.runId,
    status: params.status,
  });

  if (!source) {
    journalStatus = resolveMissingSourceJournalStatus({
      allowIncompleteHandoff: params.allowIncompleteHandoff,
      conversation,
      currentAssistantMessageId: projectionMessageId,
      journalStatus,
      orchestratorTerminalDisposition: params.orchestratorTerminalDisposition,
      runId: params.runId,
      trackedRun,
    });
    await params.flushChatState();
    params.assertProjectionOwnership();
    return {
      conversation: params.getConversation(),
      journalStatus,
      projectionMessageId,
    };
  }
  if (!conversation) {
    throw new Error('foreground_terminal_memory_conversation_unavailable');
  }

  const sourceSnapshotFingerprint = fingerprintForegroundTerminalMemorySource({
    conversation,
    source,
    sourceRunId: params.runId,
  });
  assertMemoryConversationCurrent({
    conversationId: params.conversationId,
    conversations: params.getConversations(),
    memoryConversationId: params.memoryConversationId,
  });
  projectionMessageId = source.id;
  const initialDisposition = resolveInitialPublicationDisposition({
    conversation,
    source,
    transitionMessageMemoryPublication: params.transitionMessageMemoryPublication,
  });

  await params.flushChatState();
  params.assertProjectionOwnership();
  conversation = revalidateTerminalMemorySource({
    conversationId: params.conversationId,
    currentAssistantMessageId: projectionMessageId,
    expectedFingerprint: sourceSnapshotFingerprint,
    expectedSourceId: source.id,
    getConversation: params.getConversation,
    getConversations: params.getConversations,
    memoryConversationId: params.memoryConversationId,
    runId: params.runId,
    status: params.status,
  });

  if (initialDisposition === null) {
    const publication = await params.recordConversationTurnMemory(
      params.conversationId,
      {
        ...params.finalizationProviderContext.provider,
        model: params.finalizationProviderContext.model,
      },
      {
        sourceEndMessageId: source.id,
        memoryConversationId: params.memoryConversationId,
        sourceRunId: params.runId,
      },
    );
    params.assertProjectionOwnership();
    conversation = revalidateTerminalMemorySource({
      conversationId: params.conversationId,
      currentAssistantMessageId: projectionMessageId,
      expectedFingerprint: sourceSnapshotFingerprint,
      expectedSourceId: source.id,
      getConversation: params.getConversation,
      getConversations: params.getConversations,
      memoryConversationId: params.memoryConversationId,
      runId: params.runId,
      status: params.status,
    });
    transitionToTerminalPublication({
      conversationId: params.conversationId,
      disposition: publication.disposition,
      sourceMessageId: source.id,
      transitionMessageMemoryPublication: params.transitionMessageMemoryPublication,
    });
    await params.flushChatState();
    params.assertProjectionOwnership();
    conversation = revalidateTerminalMemorySource({
      conversationId: params.conversationId,
      currentAssistantMessageId: projectionMessageId,
      expectedFingerprint: sourceSnapshotFingerprint,
      expectedSourceId: source.id,
      getConversation: params.getConversation,
      getConversations: params.getConversations,
      memoryConversationId: params.memoryConversationId,
      runId: params.runId,
      status: params.status,
    });
  }

  return {
    conversation,
    journalStatus,
    projectionMessageId,
    terminalMemorySourceId: source.id,
  };
}
