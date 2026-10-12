import type { AgentRun } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponse,
} from '../../../services/agents/lifecycle/agentRunStateMachine';
import { hasTerminalAssistantCompletionMetadata } from '../../../utils/assistantMessageMetadata';
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

/**
 * The reply `replyId` names when it is the one closed final of its turn: no later assistant
 * output or tool result before the next user message (a sub-agent's event may follow).
 * Never an older final instead.
 */
function findClosedReply(messages: ReadonlyArray<Message>, replyId: string): Message | undefined {
  const matches = messages.filter((message) => message.id === replyId);
  const reply = matches.length === 1 ? matches[0]! : undefined;
  if (reply?.role !== 'assistant' || !hasTerminalAssistantCompletionMetadata(reply)) {
    return undefined;
  }
  for (const later of messages.slice(messages.indexOf(reply) + 1)) {
    if (later.role === 'user') break;
    if (later.role === 'assistant' && later.subAgentEvent) continue;
    if (later.role === 'assistant' || later.role === 'tool') return undefined;
  }
  return reply;
}

function resolveUntrackedTerminalMemorySource(params: {
  conversation: TerminalMemoryConversation;
  currentAssistantMessageId: string;
  status: Exclude<ForegroundRunTerminalStatus, 'cancelled'>;
}): Message | undefined {
  return findClosedReply(params.conversation.messages, params.currentAssistantMessageId);
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
