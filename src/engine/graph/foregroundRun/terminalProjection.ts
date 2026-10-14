import type { OrchestratorTerminalDisposition } from '../../orchestrator/types';
import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { ForegroundRunTerminalStatus } from './terminalLifecycle';
import { resolveForegroundTerminalMemorySource } from './terminalMemorySource';

function findTrackedRun(
  conversation: Conversation | undefined,
  runId: string | undefined,
): AgentRun | undefined {
  return runId ? conversation?.agentRuns?.find((run) => run.id === runId) : undefined;
}

function normalizeJournalStatus(
  status: ForegroundRunTerminalStatus,
  trackedRun: AgentRun | undefined,
): ForegroundRunTerminalStatus {
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
      run.controlGraph?.status === 'awaiting_user' ||
      run.controlGraph?.asyncWork.awaitingBackgroundWorkers === true ||
      (run.controlGraph?.asyncWork.pendingOperations.length ?? 0) > 0)
  );
}

function resolveMissingReplyJournalStatus(params: {
  conversation: Conversation | undefined;
  currentAssistantMessageId: string;
  journalStatus: ForegroundRunTerminalStatus;
  orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  runId: string | undefined;
  trackedRun: AgentRun | undefined;
}): ForegroundRunTerminalStatus {
  if (
    params.journalStatus !== 'succeeded' ||
    params.orchestratorTerminalDisposition === 'command'
  ) {
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

/**
 * The journal outcome of a closing foreground generation: its terminal status, the message
 * its projection settles on, and the reply that closed the turn when there is one. The
 * reply is never an older final standing in for a missing one.
 */
export function resolveForegroundTerminalProjection(params: {
  conversation: Conversation | undefined;
  currentAssistantMessageId: string;
  orchestratorTerminalDisposition: OrchestratorTerminalDisposition | undefined;
  runId: string | undefined;
  status: ForegroundRunTerminalStatus;
}): {
  journalStatus: ForegroundRunTerminalStatus;
  projectionMessageId: string;
  terminalReplyId?: string;
} {
  const trackedRun = findTrackedRun(params.conversation, params.runId);
  const journalStatus = normalizeJournalStatus(params.status, trackedRun);
  const reply = resolveForegroundTerminalMemorySource({
    conversation: params.conversation,
    currentAssistantMessageId: params.currentAssistantMessageId,
    runId: params.runId,
    status: params.status,
  });
  if (!reply) {
    return {
      journalStatus: resolveMissingReplyJournalStatus({
        conversation: params.conversation,
        currentAssistantMessageId: params.currentAssistantMessageId,
        journalStatus,
        orchestratorTerminalDisposition: params.orchestratorTerminalDisposition,
        runId: params.runId,
        trackedRun,
      }),
      projectionMessageId: params.currentAssistantMessageId,
    };
  }
  return { journalStatus, projectionMessageId: reply.id, terminalReplyId: reply.id };
}
