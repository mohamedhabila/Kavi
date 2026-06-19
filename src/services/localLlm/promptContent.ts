import {
  LOCAL_LLM_APPROX_CHARS_PER_TOKEN,
  LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
  LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS,
} from './constants';
import type { LocalStructuredMessage, LocalStructuredToolDefinition } from './types';

export function flattenMessageContent(content: string | any[]): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return String(content ?? '').trim();
  }

  return content
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (entry.type === 'image_url') {
          return '[Image omitted for local text model]';
        }
        if (entry.type === 'input_image') {
          return '[Image omitted for local text model]';
        }
        if (entry.type === 'input_file' || entry.type === 'file') {
          return '[File omitted for local text model]';
        }
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry ?? '');
      }
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n');
}

export function estimateLocalLlmTextTokens(content: string): number {
  const normalized = content.trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / LOCAL_LLM_APPROX_CHARS_PER_TOKEN));
}

export function estimateLocalLlmPromptTokens(params: {
  systemPrompt?: string;
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): number {
  const systemTokens = params.systemPrompt
    ? estimateLocalLlmTextTokens(params.systemPrompt) + LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS
    : 0;
  const promptTokens =
    estimateLocalLlmTextTokens(params.prompt) + LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS;
  const historyTokens = params.history.reduce(
    (total, entry) =>
      total + estimateLocalLlmTextTokens(entry.content) + LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );

  return systemTokens + promptTokens + historyTokens;
}

export function parseJsonLikeLocalValue(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (!/^(?:\{|\[|"|true\b|false\b|null\b|-?\d)/.test(trimmed)) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function stringifyLocalStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

export function flattenLocalStructuredMessage(message: LocalStructuredMessage): string {
  if (message.role === 'tool') {
    return (message.toolResponses || [])
      .map(
        (toolResponse) =>
          `${toolResponse.name}:\n${stringifyLocalStructuredValue(toolResponse.response)}`,
      )
      .join('\n\n');
  }

  const parts: string[] = [];
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    parts.push(message.content.trim());
  }

  if (message.toolCalls?.length) {
    parts.push(
      message.toolCalls
        .map((toolCall) => `${toolCall.name}(${stringifyLocalStructuredValue(toolCall.arguments)})`)
        .join('\n'),
    );
  }

  return parts.join('\n\n').trim();
}

export function estimateStructuredLocalConversationTokens(params: {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
}): number {
  const systemTokens = params.systemPrompt
    ? estimateLocalLlmTextTokens(params.systemPrompt) + LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS
    : 0;
  const messageTokens = params.messages.reduce(
    (total, message) =>
      total +
      estimateLocalLlmTextTokens(flattenLocalStructuredMessage(message)) +
      LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );
  const toolTokens = (params.tools || []).reduce(
    (total, tool) =>
      total +
      estimateLocalLlmTextTokens(
        `${tool.name}\n${tool.description}\n${stringifyLocalStructuredValue(tool.parameters)}`,
      ) +
      LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );

  return systemTokens + messageTokens + toolTokens;
}
