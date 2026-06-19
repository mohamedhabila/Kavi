import type { AgentRun } from '../types/agentRun';
import type { Message } from '../types/message';
import { findLatestPreferredAgentRunAssistantMessageId } from '../engine/graph/foregroundRun/assistantMessages';
import { buildAgentRunMessageScope } from '../services/agents/lifecycle/agentRunStateMachine';

export function resolvePreferredAgentRunFinalResponseMessageId(params: {
  messages: Message[];
  preferredAssistantMessageId?: string;
  run: AgentRun;
}): string | undefined {
  const explicitMessageId = params.preferredAssistantMessageId?.trim();
  if (explicitMessageId) {
    return explicitMessageId;
  }

  return findLatestPreferredAgentRunAssistantMessageId(
    params.messages,
    buildAgentRunMessageScope(params.run),
  );
}
