import { getNativeLocalLlmMaximumContextWindowTokens } from './contextWindowPolicy';
import {
  buildLocalLlmContextTelemetry,
  createLocalLlmContextPressureError,
  type LocalLlmContextCompactionState,
  type LocalLlmContextPressureReason,
  type LocalLlmContextTelemetry,
} from './contextPressure';
import {
  LOCAL_LLM_HIGH_HISTORY_TURNS,
  LOCAL_LLM_LOW_HISTORY_TURNS,
  LOCAL_LLM_MID_HISTORY_TURNS,
} from './constants';
import { estimateLocalLlmPromptTokens, flattenMessageContent } from './promptContent';
import type { LocalChatMessage, LocalLlmExecutionPolicy } from './types';

function capLocalPromptHistoryTurns(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  contextWindowTokens: number | null,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!contextWindowTokens || history.length === 0) {
    return history;
  }

  let maxHistoryTurns = LOCAL_LLM_HIGH_HISTORY_TURNS;
  if (contextWindowTokens <= 4_096) {
    maxHistoryTurns = LOCAL_LLM_LOW_HISTORY_TURNS;
  } else if (contextWindowTokens <= 6_144) {
    maxHistoryTurns = LOCAL_LLM_MID_HISTORY_TURNS;
  }

  return history.slice(-maxHistoryTurns);
}

function resolvePlainContextPressureReason(params: {
  inputBudget: number;
  systemPrompt?: string;
  prompt: string;
}): LocalLlmContextPressureReason {
  if (estimateLocalLlmPromptTokens({ prompt: params.prompt, history: [] }) > params.inputBudget) {
    return 'current_message_exceeds_budget';
  }

  if (
    params.systemPrompt &&
    estimateLocalLlmPromptTokens({
      systemPrompt: params.systemPrompt,
      prompt: params.prompt,
      history: [],
    }) > params.inputBudget
  ) {
    return 'system_prompt_exceeds_budget';
  }

  return 'conversation_exceeds_budget';
}

export function buildLocalPrompt(
  messages: LocalChatMessage[],
  executionPolicy: LocalLlmExecutionPolicy,
): {
  prompt: string;
  systemPrompt?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  estimatedInputTokens: number;
  context: LocalLlmContextTelemetry;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    const content = flattenMessageContent(message.content);
    if (!content) {
      continue;
    }

    switch (message.role) {
      case 'system':
        systemParts.push(content);
        break;
      case 'assistant':
        turns.push({ role: 'assistant', content });
        break;
      case 'user':
        turns.push({ role: 'user', content });
        break;
      case 'tool':
        turns.push({
          role: 'user',
          content: `${message.name || message.tool_call_id || 'Tool result'}:\n${content}`,
        });
        break;
      default:
        turns.push({ role: 'user', content });
        break;
    }
  }

  const finalTurn = turns[turns.length - 1];
  if (!finalTurn || finalTurn.role !== 'user') {
    throw new Error('On-device requests require a final user message.');
  }

  const systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
  const contextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const inputBudget =
    contextWindowTokens != null
      ? Math.max(1, contextWindowTokens - executionPolicy.maxTokens)
      : null;
  const fullHistory = turns.slice(0, -1);
  const history = capLocalPromptHistoryTurns(fullHistory, contextWindowTokens);
  let compactionState: LocalLlmContextCompactionState =
    history.length === fullHistory.length ? 'full' : 'history_windowed';

  if (inputBudget == null) {
    const estimatedInputTokens = estimateLocalLlmPromptTokens({
      systemPrompt,
      prompt: finalTurn.content,
      history,
    });

    return {
      prompt: finalTurn.content,
      systemPrompt,
      history,
      estimatedInputTokens,
      context: buildLocalLlmContextTelemetry({
        contextWindowTokens,
        inputBudgetTokens: null,
        estimatedInputTokens,
        compactionState,
      }),
    };
  }

  const trimmedHistory = history.slice();
  while (
    trimmedHistory.length > 0 &&
    estimateLocalLlmPromptTokens({
      systemPrompt,
      prompt: finalTurn.content,
      history: trimmedHistory,
    }) > inputBudget
  ) {
    trimmedHistory.shift();
    compactionState = 'history_compacted';
  }

  const estimatedInputTokens = estimateLocalLlmPromptTokens({
    systemPrompt,
    prompt: finalTurn.content,
    history: trimmedHistory,
  });

  if (estimatedInputTokens > inputBudget) {
    throw createLocalLlmContextPressureError({
      modelName: executionPolicy.modelName,
      reason: resolvePlainContextPressureReason({
        inputBudget,
        systemPrompt,
        prompt: finalTurn.content,
      }),
      contextWindowTokens,
      inputBudgetTokens: inputBudget,
      estimatedInputTokens,
    });
  }

  return {
    prompt: finalTurn.content,
    systemPrompt,
    history: trimmedHistory,
    estimatedInputTokens,
    context: buildLocalLlmContextTelemetry({
      contextWindowTokens,
      inputBudgetTokens: inputBudget,
      estimatedInputTokens,
      compactionState,
    }),
  };
}
