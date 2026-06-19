import type { StreamEvent, StreamUsage, StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import {
  createCompletionMetadata,
  normalizeStreamUsage,
} from '../../core/streaming/metadataBuilder';

export type OpenAIResponsesStreamArgs = {
  response: Response;
  signal?: AbortSignal;
  replayInputContext?: Record<string, any>[];
  shouldSurfaceReasoning: boolean;
  buildOpenAIResponseToolRaw: (
    item: Record<string, any>,
    options: { outputIndex: number; reasoningItems?: Record<string, any>[] },
  ) => Record<string, any>;
  mergeOpenAIStreamToolCall: (
    existing: StreamedToolCall | undefined,
    raw: Record<string, any>,
  ) => StreamedToolCall;
  normalizeOpenAIResponsesResult: (json: any) => any;
  getOpenAIReasoningTextParts: (item: Record<string, any>) => Array<{ key: string; text: string }>;
};

export function createOpenAIResponsesStreamToolState(args: {
  buildOpenAIResponseToolRaw: (
    item: Record<string, any>,
    options: { outputIndex: number; reasoningItems?: Record<string, any>[] },
  ) => Record<string, any>;
  mergeOpenAIStreamToolCall: (
    existing: StreamedToolCall | undefined,
    raw: Record<string, any>,
  ) => StreamedToolCall;
}): {
  toolCalls: Record<number, StreamedToolCall>;
  getLatestReasoningItems: () => Record<string, any>[];
  getLatestUsage: () => StreamUsage | undefined;
  ensureToolCall: (outputIndex: number) => StreamedToolCall;
  updateToolCall: (outputIndex: number, raw: Record<string, any>) => void;
  applyReasoningItemsToToolCalls: (items: Record<string, any>[]) => void;
  captureUsage: (usage: any) => void;
} {
  const toolCalls: Record<number, StreamedToolCall> = {};
  let latestUsage: StreamUsage | undefined;
  let latestReasoningItems: Record<string, any>[] = [];

  const ensureToolCall = (outputIndex: number): StreamedToolCall => {
    if (!toolCalls[outputIndex]) {
      toolCalls[outputIndex] = {
        id: '',
        name: '',
        arguments: '',
        raw: {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
          _openai: { outputIndex },
        },
      };
    }
    return toolCalls[outputIndex];
  };

  const updateToolCall = (outputIndex: number, raw: Record<string, any>) => {
    toolCalls[outputIndex] = args.mergeOpenAIStreamToolCall(toolCalls[outputIndex], raw);
  };

  return {
    toolCalls,
    getLatestReasoningItems: () => latestReasoningItems,
    getLatestUsage: () => latestUsage,
    ensureToolCall,
    updateToolCall,
    applyReasoningItemsToToolCalls(items) {
      latestReasoningItems = items;
      for (const [indexText, toolCall] of Object.entries(toolCalls)) {
        const outputIndex = Number(indexText);
        const raw = args.buildOpenAIResponseToolRaw(
          {
            call_id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
          {
            outputIndex,
            reasoningItems: items,
          },
        );
        updateToolCall(outputIndex, raw);
      }
    },
    captureUsage(usage) {
      const normalizedUsage = normalizeStreamUsage(usage);
      if (normalizedUsage) {
        latestUsage = normalizedUsage;
      }
    },
  };
}

export function createOpenAIResponsesStreamCompletionMetadata(eventType: string, response: any) {
  return createCompletionMetadata(
    eventType === 'response.completed' ? 'complete' : 'incomplete',
    typeof response?.incomplete_details?.reason === 'string'
      ? response.incomplete_details.reason
      : typeof response?.status === 'string'
        ? response.status
        : eventType,
  );
}

export function readOpenAIResponsesStreamResponseId(response: any, fallback: string): string {
  return typeof response?.id === 'string' && response.id.trim().length > 0
    ? response.id.trim()
    : fallback;
}

export function getOpenAIResponsesStreamOutput(response: any): Record<string, any>[] {
  return Array.isArray(response?.output)
    ? response.output.filter((item: unknown): item is Record<string, any> => isPlainRecord(item))
    : [];
}

export function buildOpenAIResponsesStreamProviderReplay(
  responseId: string,
  output: Record<string, any>[],
  inputContext: Record<string, any>[] = [],
):
  | {
      openaiResponseId?: string;
      openaiResponseInputContext?: Record<string, any>[];
      openaiResponseOutput?: Record<string, any>[];
    }
  | undefined {
  if (output.length === 0 && inputContext.length === 0 && !responseId) {
    return undefined;
  }

  return {
    ...(responseId ? { openaiResponseId: responseId } : {}),
    ...(inputContext.length > 0 ? { openaiResponseInputContext: inputContext } : {}),
    ...(output.length > 0 ? { openaiResponseOutput: output } : {}),
  };
}

export function collectOpenAIResponsesReasoningEvents(args: {
  reasoningItems: Record<string, any>[];
  emittedReasoningKeys: Set<string>;
  getOpenAIReasoningTextParts: (item: Record<string, any>) => Array<{ key: string; text: string }>;
}): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const item of args.reasoningItems) {
    for (const part of args.getOpenAIReasoningTextParts(item)) {
      if (args.emittedReasoningKeys.has(part.key) || part.text.length === 0) {
        continue;
      }
      args.emittedReasoningKeys.add(part.key);
      events.push({ type: 'reasoning', content: part.text });
    }
  }

  return events;
}
