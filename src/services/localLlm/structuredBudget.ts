import {
  createLocalLlmContextPressureError,
  type LocalLlmContextPressureReason,
} from './contextPressure';
import { estimateStructuredLocalConversationTokens } from './promptContent';
import type { LocalStructuredMessage, LocalStructuredToolDefinition } from './types';

function resolveStructuredContextPressureReason(params: {
  inputBudget: number;
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
}): LocalLlmContextPressureReason {
  const currentMessage = params.messages[params.messages.length - 1];
  const currentMessageTokens = currentMessage
    ? estimateStructuredLocalConversationTokens({ messages: [currentMessage] })
    : 0;

  if (currentMessageTokens > params.inputBudget) {
    return 'current_message_exceeds_budget';
  }

  if (
    params.systemPrompt &&
    estimateStructuredLocalConversationTokens({
      systemPrompt: params.systemPrompt,
      messages: currentMessage ? [currentMessage] : [],
    }) > params.inputBudget
  ) {
    return 'system_prompt_exceeds_budget';
  }

  if (
    params.tools?.length &&
    estimateStructuredLocalConversationTokens({
      systemPrompt: params.systemPrompt,
      messages: params.messages,
    }) <= params.inputBudget
  ) {
    return 'tool_payload_exceeds_budget';
  }

  return 'conversation_exceeds_budget';
}

export function fitStructuredLocalConversationToBudget(params: {
  inputBudget: number;
  contextWindowTokens: number | null;
  modelName: string;
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
}): {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
} {
  const systemPrompt = params.systemPrompt?.trim() || undefined;
  const messages = params.messages.slice();
  const tools = params.tools?.slice();
  const candidate = {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(tools?.length ? { tools } : {}),
  };
  const fitsBudget = (value: {
    systemPrompt?: string;
    messages: LocalStructuredMessage[];
    tools?: LocalStructuredToolDefinition[];
  }): boolean => estimateStructuredLocalConversationTokens(value) <= params.inputBudget;

  if (fitsBudget(candidate)) {
    return candidate;
  }

  throw createLocalLlmContextPressureError({
    modelName: params.modelName,
    reason: resolveStructuredContextPressureReason({
      inputBudget: params.inputBudget,
      systemPrompt,
      messages,
      tools,
    }),
    contextWindowTokens: params.contextWindowTokens,
    inputBudgetTokens: params.inputBudget,
    estimatedInputTokens: estimateStructuredLocalConversationTokens(candidate),
  });
}
