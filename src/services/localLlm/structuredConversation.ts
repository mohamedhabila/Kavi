import type { ToolDefinition } from '../../types/tool';
import { getNativeLocalLlmMaximumContextWindowTokens } from './contextWindowPolicy';
import {
  buildLocalLlmContextTelemetry,
  type LocalLlmContextCompactionState,
  type LocalLlmContextTelemetry,
} from './contextPressure';
import {
  LOCAL_LLM_HIGH_HISTORY_GROUPS,
  LOCAL_LLM_LOW_HISTORY_GROUPS,
  LOCAL_LLM_MID_HISTORY_GROUPS,
} from './constants';
import { estimateStructuredLocalConversationTokens } from './promptContent';
import { fitStructuredLocalConversationToBudget } from './structuredBudget';
import { buildStructuredLocalMessages, groupStructuredLocalMessages } from './structuredMessages';
import { buildStructuredLocalToolDefinitions } from './toolAdapter';
import type {
  LocalChatMessage,
  LocalLlmExecutionPolicy,
  LocalStructuredMessage,
  LocalStructuredToolDefinition,
} from './types';

function capStructuredLocalConversationGroups(
  groupedMessages: LocalStructuredMessage[][],
  contextWindowTokens: number | null,
): LocalStructuredMessage[][] {
  if (!contextWindowTokens || groupedMessages.length === 0) {
    return groupedMessages;
  }

  let maxHistoryGroups = LOCAL_LLM_HIGH_HISTORY_GROUPS;
  if (contextWindowTokens <= 4_096) {
    maxHistoryGroups = LOCAL_LLM_LOW_HISTORY_GROUPS;
  } else if (contextWindowTokens <= 6_144) {
    maxHistoryGroups = LOCAL_LLM_MID_HISTORY_GROUPS;
  }

  return groupedMessages.slice(-maxHistoryGroups);
}

export function buildStructuredLocalConversation(
  messages: LocalChatMessage[],
  executionPolicy: LocalLlmExecutionPolicy,
  tools?: ToolDefinition[],
): {
  systemPrompt?: string;
  history: LocalStructuredMessage[];
  currentMessage: LocalStructuredMessage;
  tools?: LocalStructuredToolDefinition[];
  estimatedInputTokens: number;
  context: LocalLlmContextTelemetry;
} {
  const structuredConversation = buildStructuredLocalMessages(messages);
  const toolDefinitions = buildStructuredLocalToolDefinitions(tools);
  const contextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const inputBudget =
    contextWindowTokens != null
      ? Math.max(1, contextWindowTokens - executionPolicy.maxTokens)
      : null;

  const allGroupedMessages = groupStructuredLocalMessages(structuredConversation.messages);
  const groupedMessages = capStructuredLocalConversationGroups(
    allGroupedMessages,
    contextWindowTokens,
  );
  let compactionState: LocalLlmContextCompactionState =
    groupedMessages.length === allGroupedMessages.length ? 'full' : 'history_windowed';

  if (groupedMessages.length === 0) {
    throw new Error('On-device requests require at least one user or tool message.');
  }

  const trimmedGroups = groupedMessages.slice();

  while (
    inputBudget != null &&
    trimmedGroups.length > 1 &&
    estimateStructuredLocalConversationTokens({
      systemPrompt: structuredConversation.systemPrompt,
      messages: trimmedGroups.flat(),
      tools: toolDefinitions,
    }) > inputBudget
  ) {
    trimmedGroups.shift();
    compactionState = 'history_compacted';
  }

  const trimmedMessages = trimmedGroups.flat();
  if (trimmedMessages.length === 0) {
    throw new Error('On-device requests require at least one user or tool message.');
  }

  const fittedConversation =
    inputBudget != null
      ? fitStructuredLocalConversationToBudget({
          inputBudget,
          contextWindowTokens,
          modelName: executionPolicy.modelName,
          systemPrompt: structuredConversation.systemPrompt,
          messages: trimmedMessages,
          tools: toolDefinitions,
        })
      : {
          ...(structuredConversation.systemPrompt
            ? { systemPrompt: structuredConversation.systemPrompt }
            : {}),
          messages: trimmedMessages,
          ...(toolDefinitions?.length ? { tools: toolDefinitions } : {}),
        };
  const fittedMessages = fittedConversation.messages;
  const fittedTools = fittedConversation.tools;
  const fittedSystemPrompt = fittedConversation.systemPrompt;

  const currentMessage = fittedMessages[fittedMessages.length - 1];
  if (currentMessage.role === 'assistant') {
    throw new Error('On-device tool-capable requests require a final user or tool message.');
  }

  const estimatedInputTokens = estimateStructuredLocalConversationTokens({
    systemPrompt: fittedSystemPrompt,
    messages: fittedMessages,
    tools: fittedTools,
  });

  return {
    ...(fittedSystemPrompt ? { systemPrompt: fittedSystemPrompt } : {}),
    history: fittedMessages.slice(0, -1),
    currentMessage,
    ...(fittedTools?.length ? { tools: fittedTools } : {}),
    estimatedInputTokens,
    context: buildLocalLlmContextTelemetry({
      contextWindowTokens,
      inputBudgetTokens: inputBudget,
      estimatedInputTokens,
      compactionState,
    }),
  };
}
