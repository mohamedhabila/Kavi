import type { OrchestratorTerminalDisposition } from '../../orchestrator/types';
import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { RecordConversationTurnMemory } from '../../../services/memory/turnPublication';
import type { ResolvedFinalizationProviderContext } from './contracts';
import type { ForegroundRunTerminalStatus } from './terminalLifecycle';
import {
  fingerprintForegroundTerminalMemorySource,
  resolveForegroundTerminalMemorySource,
} from './terminalMemorySource';

type ForegroundJournalStatus = ForegroundRunTerminalStatus;

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
  getConversation: () => Conversation | undefined;
  memoryConversationId: string;
  orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  runId: string | undefined;
  status: ForegroundRunTerminalStatus;
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
    return { conversation, journalStatus, projectionMessageId };
  }
  if (!conversation) {
    throw new Error('foreground_terminal_memory_conversation_unavailable');
  }

  const sourceSnapshotFingerprint = fingerprintForegroundTerminalMemorySource({
    conversation,
    source,
    sourceRunId: params.runId,
  });
  projectionMessageId = source.id;
  await params.recordConversationTurnMemory(
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

  conversation = params.getConversation();
  const currentSource = resolveForegroundTerminalMemorySource({
    conversation,
    currentAssistantMessageId: projectionMessageId,
    runId: params.runId,
    status: params.status,
  });
  if (currentSource?.id !== source.id) {
    throw new Error('foreground_terminal_memory_source_changed');
  }
  if (
    !conversation ||
    fingerprintForegroundTerminalMemorySource({
      conversation,
      source: currentSource,
      sourceRunId: params.runId,
    }) !== sourceSnapshotFingerprint
  ) {
    throw new Error('foreground_terminal_memory_source_changed');
  }

  return {
    conversation,
    journalStatus,
    projectionMessageId,
    terminalMemorySourceId: source.id,
  };
}
