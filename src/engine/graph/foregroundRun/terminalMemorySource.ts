import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { resolveClosedTurnEndingAt } from '../../../services/memory/closedTurn';
import { encodeIngestionSourceSnapshot } from '../../../services/memory/ingestionSourceSnapshot';
import type { ForegroundRunTerminalStatus } from './terminalLifecycle';

type TerminalMemoryConversation = Pick<Conversation, 'agentRuns' | 'messages'>;

function resolveExactTrackedRun(
  conversation: TerminalMemoryConversation,
  runId: string | undefined,
): AgentRun | undefined {
  if (!runId) return undefined;
  const matches = (conversation.agentRuns ?? []).filter((run) => run.id === runId);
  return matches.length === 1 ? matches[0] : undefined;
}

function resolveAgenticTerminalMemorySource(params: {
  conversation: TerminalMemoryConversation;
  runId: string | undefined;
  status: Exclude<ForegroundRunTerminalStatus, 'cancelled'>;
}): Message | undefined {
  const run = resolveExactTrackedRun(params.conversation, params.runId);
  if (!run) {
    if (params.status === 'failed') return undefined;
    throw new Error('foreground_terminal_memory_agent_run_unavailable');
  }

  if (run.status === 'running' || run.controlGraph?.status === 'yielded') return undefined;

  const finalResponse = getLatestAssistantProjectionFinalResponse(
    params.conversation.messages,
    buildAgentRunMessageScope(run),
  );
  if (finalResponse) return finalResponse;
  if (params.status === 'failed' || run.status === 'failed' || run.status === 'cancelled') {
    return undefined;
  }
  if (!run.controlGraph) return undefined;

  throw new Error('foreground_terminal_memory_agent_final_unavailable');
}

function resolveUntrackedTerminalMemorySource(params: {
  conversation: TerminalMemoryConversation;
  currentAssistantMessageId: string;
  status: Exclude<ForegroundRunTerminalStatus, 'cancelled'>;
}): Message | undefined {
  const closedTurn = resolveClosedTurnEndingAt(
    params.conversation.messages,
    params.currentAssistantMessageId,
  );
  if (closedTurn.status === 'resolved') return closedTurn.assistant;
  return undefined;
}

/** Select the exact terminal assistant source without falling back to an older final. */
export function resolveForegroundTerminalMemorySource(params: {
  conversation: TerminalMemoryConversation | undefined;
  currentAssistantMessageId: string;
  runId?: string;
  status: ForegroundRunTerminalStatus;
}): Message | undefined {
  if (params.status === 'cancelled') return undefined;
  if (!params.conversation) {
    if (params.status === 'failed') return undefined;
    throw new Error('foreground_terminal_memory_conversation_unavailable');
  }
  if (params.runId) {
    return resolveAgenticTerminalMemorySource({
      conversation: params.conversation,
      runId: params.runId,
      status: params.status,
    });
  }

  return resolveUntrackedTerminalMemorySource({
    conversation: params.conversation,
    currentAssistantMessageId: params.currentAssistantMessageId,
    status: params.status,
  });
}

/** Fingerprint the exact bounded source payload that durable memory ingestion will persist. */
export function fingerprintForegroundTerminalMemorySource(params: {
  conversation: TerminalMemoryConversation;
  source: Message;
  sourceRunId?: string;
}): string {
  const closedTurn = resolveClosedTurnEndingAt(params.conversation.messages, params.source.id);
  if (closedTurn.status !== 'resolved') {
    throw new Error('foreground_terminal_memory_source_not_closed');
  }
  const sourceRun = resolveExactTrackedRun(params.conversation, params.sourceRunId);
  return encodeIngestionSourceSnapshot({
    messages: params.conversation.messages,
    sourceStartMessageId: closedTurn.sourceStartMessageId,
    sourceEndMessageId: closedTurn.sourceEndMessageId,
    priorUserMessageId: closedTurn.priorUserMessageId,
    graphGoalEvidence: sourceRun?.controlGraph?.goals?.flatMap((goal) => goal.evidence) ?? [],
  }).payloadSha256;
}
