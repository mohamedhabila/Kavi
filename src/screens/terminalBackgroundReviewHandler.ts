import type { AgentControlGraphTerminalBackgroundReviewContext } from '../engine/graph/terminalBackgroundReviewContext';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
  getLatestAssistantProjectionFinalResponsePreview,
} from '../services/agents/lifecycle/agentRunStateMachine';
import { useChatStore } from '../store/useChatStore';
import type { Conversation, ConversationLogEntry } from '../types/conversation';
import type { Message, MessageMemoryPublicationDisposition } from '../types/message';
import { findLatestPreferredAgentRunAssistantMessageId } from '../engine/graph/foregroundRun/assistantMessages';
import { resolveConversationWorkspaceTarget } from '../services/conversationWorkspace/ownership';
import {
  EnsureAgentRunFinalResponse,
  ResumeAgentRun,
} from '../engine/graph/foregroundRun/contracts';
import { completeTerminalBackgroundReviewRun } from './terminalBackgroundCompletion';
import type { RecordConversationTurnMemory } from '../services/memory/turnPublication';
import { hasIncompleteBlockingGoals, hasResumableBlockingGoals } from '../engine/goals/types';
import { canWriteLongTermMemory } from '../services/memory/policy';
import { fingerprintForegroundTerminalMemorySource } from '../engine/graph/foregroundRun/terminalMemorySource';
import {
  isTerminalMessageMemoryPublication,
  normalizeMessageMemoryPublication,
} from '../utils/messageMemoryPublication';

type ChatStore = ReturnType<typeof useChatStore.getState>;

type TerminalMemoryPublicationDisposition = Exclude<MessageMemoryPublicationDisposition, null>;

function resolveUniqueConversation(conversationId: string): Conversation {
  const matches = useChatStore
    .getState()
    .conversations.filter((conversation) => conversation.id === conversationId);
  if (matches.length !== 1) {
    throw new Error('background_terminal_memory_conversation_changed');
  }
  return matches[0];
}

function resolveUniqueMessage(conversation: Conversation, messageId: string): Message {
  const matches = conversation.messages.filter((message) => message.id === messageId);
  if (matches.length !== 1) {
    throw new Error('background_terminal_memory_source_changed');
  }
  return matches[0];
}

function resolveUniqueRun(conversation: Conversation, runId: string) {
  const matches = (conversation.agentRuns ?? []).filter((run) => run.id === runId);
  if (matches.length !== 1) {
    throw new Error('background_terminal_memory_run_changed');
  }
  return matches[0];
}

function resolveInitialPublicationDisposition(params: {
  conversation: Conversation;
  source: Message;
  transitionMessageMemoryPublication: ChatStore['transitionMessageMemoryPublication'];
}): MessageMemoryPublicationDisposition {
  const current = normalizeMessageMemoryPublication(params.source.memoryPublication);
  if (params.source.memoryPublication !== undefined && current === undefined) {
    throw new Error('background_terminal_memory_publication_invalid');
  }
  if (isTerminalMessageMemoryPublication(current)) {
    return current.disposition;
  }

  const requestedDisposition: MessageMemoryPublicationDisposition = !canWriteLongTermMemory()
    ? 'opt_out'
    : params.conversation.isSideThread
      ? 'ephemeral_thread'
      : null;
  const transition = params.transitionMessageMemoryPublication(
    params.conversation.id,
    params.source.id,
    requestedDisposition,
  );
  if (transition.status !== 'applied') {
    throw new Error(`background_terminal_memory_publication_${transition.reason}`);
  }
  return transition.publication.disposition;
}

function transitionToTerminalPublication(params: {
  conversationId: string;
  disposition: TerminalMemoryPublicationDisposition;
  sourceMessageId: string;
  transitionMessageMemoryPublication: ChatStore['transitionMessageMemoryPublication'];
}): void {
  const transition = params.transitionMessageMemoryPublication(
    params.conversationId,
    params.sourceMessageId,
    params.disposition,
  );
  if (transition.status !== 'applied') {
    throw new Error(`background_terminal_memory_publication_${transition.reason}`);
  }
}

function assertTerminalMemorySourceCurrent(params: {
  conversationId: string;
  expectedFingerprint: string;
  expectedMemoryConversationId: string;
  runId: string;
  sourceMessageId: string;
}): Conversation {
  const conversation = resolveUniqueConversation(params.conversationId);
  const run = resolveUniqueRun(conversation, params.runId);
  const latestFinalMessageId = findLatestPreferredAgentRunAssistantMessageId(
    conversation.messages,
    buildAgentRunMessageScope(run),
  );
  if (latestFinalMessageId !== params.sourceMessageId) {
    throw new Error('background_terminal_memory_source_changed');
  }
  const source = resolveUniqueMessage(conversation, params.sourceMessageId);
  const fingerprint = fingerprintForegroundTerminalMemorySource({
    conversation,
    source,
    sourceRunId: params.runId,
  });
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId: params.conversationId,
    conversations: useChatStore.getState().conversations,
  });
  if (
    fingerprint !== params.expectedFingerprint ||
    workspaceTarget.workspaceConversationId !== params.expectedMemoryConversationId
  ) {
    throw new Error('background_terminal_memory_source_changed');
  }
  return conversation;
}

export async function handleTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  assertNotAborted: () => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  conversationId: string;
  context: AgentControlGraphTerminalBackgroundReviewContext;
  ensureAgentRunFinalResponse?: EnsureAgentRunFinalResponse | null;
  flushChatState: () => Promise<void>;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resumeAgentRun?: ResumeAgentRun | null;
  reviewTimestamp: number;
  runId: string;
  signal: AbortSignal;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
  transitionMessageMemoryPublication: ChatStore['transitionMessageMemoryPublication'];
}): Promise<void> {
  const { conversation, targetRun, candidateSummary, candidateStatus } = params.context;
  const goals = targetRun.controlGraph?.goals ?? [];

  if (hasResumableBlockingGoals(goals) && params.resumeAgentRun) {
    params.setAgentRunPhase(
      params.conversationId,
      'work',
      {
        status: 'active',
        detail: candidateSummary,
        checkpointTitle: 'Goals still open',
        checkpointDetail: candidateSummary,
      },
      params.runId,
    );
    await params.resumeAgentRun({
      conversationId: params.conversationId,
      runId: params.runId,
      additionalSystemPrompt:
        'Background workers finished, but goals are still open. Continue executing the active goal set.',
      additionalUserPrompt: candidateSummary,
      assistantDraftMode: 'continue',
    });
    return;
  }

  const status =
    candidateStatus === 'completed' && !hasIncompleteBlockingGoals(goals) ? 'completed' : 'failed';
  const checkpointTitle =
    status === 'completed' ? 'Background workers finished' : 'Background worker review failed';
  const runMessageScope = buildAgentRunMessageScope(targetRun);
  let latestSummary = candidateSummary;

  if (!getLatestAssistantProjectionFinalResponsePreview(conversation.messages, runMessageScope)) {
    const preferredAssistantMessageId = findLatestPreferredAgentRunAssistantMessageId(
      conversation.messages,
      runMessageScope,
    );
    const finalResponsePreview = await params.ensureAgentRunFinalResponse?.({
      conversationId: params.conversationId,
      runId: params.runId,
      status,
      preferredAssistantMessageId,
      timestamp: params.reviewTimestamp,
      signal: params.signal,
    });
    params.assertNotAborted();
    if (finalResponsePreview) {
      latestSummary = finalResponsePreview;
    }
  }

  const settledConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  const settledRun = settledConversation?.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  if (!settledConversation || !settledRun) return;
  const settledRunMessageScope = buildAgentRunMessageScope(settledRun);
  const settledFinalResponse = getLatestAssistantProjectionFinalResponse(
    settledConversation.messages,
    settledRunMessageScope,
  );
  if (!settledFinalResponse) return;
  latestSummary = settledFinalResponse.content.trim();

  const sourceFingerprint = fingerprintForegroundTerminalMemorySource({
    conversation: settledConversation,
    source: settledFinalResponse,
    sourceRunId: params.runId,
  });
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId: params.conversationId,
    conversations: useChatStore.getState().conversations,
  });
  const memoryConversationId = workspaceTarget.workspaceConversationId;
  const initialDisposition = resolveInitialPublicationDisposition({
    conversation: settledConversation,
    source: settledFinalResponse,
    transitionMessageMemoryPublication: params.transitionMessageMemoryPublication,
  });

  await params.flushChatState();
  params.assertNotAborted();
  assertTerminalMemorySourceCurrent({
    conversationId: params.conversationId,
    expectedFingerprint: sourceFingerprint,
    expectedMemoryConversationId: memoryConversationId,
    runId: params.runId,
    sourceMessageId: settledFinalResponse.id,
  });

  if (initialDisposition === null) {
    const publication = await params.recordConversationTurnMemory(
      params.conversationId,
      undefined,
      {
        sourceEndMessageId: settledFinalResponse.id,
        memoryConversationId,
        sourceRunId: params.runId,
      },
    );
    params.assertNotAborted();
    assertTerminalMemorySourceCurrent({
      conversationId: params.conversationId,
      expectedFingerprint: sourceFingerprint,
      expectedMemoryConversationId: memoryConversationId,
      runId: params.runId,
      sourceMessageId: settledFinalResponse.id,
    });
    transitionToTerminalPublication({
      conversationId: params.conversationId,
      disposition: publication.disposition,
      sourceMessageId: settledFinalResponse.id,
      transitionMessageMemoryPublication: params.transitionMessageMemoryPublication,
    });
    await params.flushChatState();
    params.assertNotAborted();
    assertTerminalMemorySourceCurrent({
      conversationId: params.conversationId,
      expectedFingerprint: sourceFingerprint,
      expectedMemoryConversationId: memoryConversationId,
      runId: params.runId,
      sourceMessageId: settledFinalResponse.id,
    });
  }

  const completed = completeTerminalBackgroundReviewRun({
    appendConversationLog: params.appendConversationLog,
    completeAgentRun: params.completeAgentRun,
    completion: {
      status,
      latestSummary,
      checkpointTitle,
      checkpointDetail: candidateSummary,
      logLevel: (status === 'completed' ? 'info' : 'warning') as ConversationLogEntry['level'],
      logTitle: checkpointTitle,
      logDetail: candidateSummary,
    },
    conversationId: params.conversationId,
    reviewTimestamp: params.reviewTimestamp,
    runId: params.runId,
    targetRun,
    updateAgentRunControlGraph: params.updateAgentRunControlGraph,
  });
  if (!completed) return;
  await params.flushChatState();
}
