// ---------------------------------------------------------------------------
// Kavi — E2E scenario trace callbacks
// ---------------------------------------------------------------------------

import type { OrchestratorCallbacks } from '../../engine/orchestrator';
import { resolveRegisteredToolName } from '../../engine/tools/toolNameNormalization';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type {
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { TokenUsage } from '../../types/usage';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import type { E2EToolCallRecord, E2EToolResultRecord } from './types';

export type ScenarioTrace = {
  toolCalls: E2EToolCallRecord[];
  toolResults: E2EToolResultRecord[];
  graphSnapshots: AgentRunControlGraphState[];
  usageEvents: TokenUsage[];
  errors: string[];
  completed: boolean;
};

export function createScenarioTrace(): ScenarioTrace {
  return {
    toolCalls: [],
    toolResults: [],
    graphSnapshots: [],
    usageEvents: [],
    errors: [],
    completed: false,
  };
}

export function mergeScenarioTrace(aggregate: ScenarioTrace, turn: ScenarioTrace): void {
  aggregate.toolCalls.push(...turn.toolCalls);
  aggregate.toolResults.push(...turn.toolResults);
  aggregate.graphSnapshots.push(...turn.graphSnapshots);
  aggregate.usageEvents.push(...turn.usageEvents);
  aggregate.errors.push(...turn.errors);
  aggregate.completed = turn.completed;
}

export function buildScenarioCallbacks(
  trace: ScenarioTrace,
  options: {
    appendConversationMessage: (message: Message) => void;
    nextMessageId: (prefix: string) => string;
    streamingAssistantContent: { value: string };
  },
): OrchestratorCallbacks {
  const toolCallIdToCanonicalName = new Map<string, string>();

  return {
    onStateChange: () => {},
    onToken: (token) => {
      options.streamingAssistantContent.value += token;
    },
    onToolCallStart: (toolCall: ToolCall) => {
      const canonicalName = resolveRegisteredToolName(toolCall.name);
      toolCallIdToCanonicalName.set(toolCall.id, canonicalName);
      trace.toolCalls.push({
        id: toolCall.id,
        name: canonicalName,
        arguments: toolCall.arguments,
      });
    },
    onToolCallComplete: () => {},
    onAssistantMessage: (
      content,
      toolCalls,
      providerReplay?: MessageProviderReplay,
      assistantMetadata?: AssistantMessageMetadata,
    ) => {
      const hasTerminalMetadata =
        assistantMetadata?.kind === 'final' && assistantMetadata.completionStatus === 'complete';
      const streamedContent = options.streamingAssistantContent.value;
      const resolvedContent = content.trim() ? content : streamedContent;
      options.streamingAssistantContent.value = '';
      if (
        !resolvedContent.trim() &&
        (!toolCalls || toolCalls.length === 0) &&
        !providerReplay &&
        !hasTerminalMetadata
      ) {
        return;
      }
      options.appendConversationMessage({
        id: options.nextMessageId('assistant'),
        role: 'assistant',
        content: resolvedContent,
        ...(toolCalls?.length ? { toolCalls } : {}),
        ...(providerReplay ? { providerReplay } : {}),
        ...(assistantMetadata ? { assistantMetadata } : {}),
        timestamp: Date.now(),
      });
    },
    onToolMessage: async (toolCallId, result) => {
      const mappedName = toolCallIdToCanonicalName.get(toolCallId);
      const traceToolCall = trace.toolCalls.find((call) => call.id === toolCallId);
      trace.toolResults.push({
        toolCallId,
        name: resolveRegisteredToolName(mappedName ?? traceToolCall?.name ?? toolCallId),
        content: result,
        isError: isToolResultErrorLike(result),
      });
      options.appendConversationMessage({
        id: options.nextMessageId('tool'),
        role: 'tool',
        content: result,
        toolCallId,
        timestamp: Date.now(),
      });
    },
    onError: (error: Error) => {
      trace.errors.push(error.message);
    },
    onUsage: (usage: TokenUsage) => {
      trace.usageEvents.push(usage);
    },
    onAgentControlGraphStateChange: (state: AgentRunControlGraphState) => {
      trace.graphSnapshots.push(state);
    },
    onDone: () => {
      const streamedContent = options.streamingAssistantContent.value.trim();
      if (streamedContent) {
        options.streamingAssistantContent.value = '';
        options.appendConversationMessage({
          id: options.nextMessageId('assistant'),
          role: 'assistant',
          content: streamedContent,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
          timestamp: Date.now(),
        });
      }
      trace.completed = true;
    },
  };
}
