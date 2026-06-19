import type { ChatCompletionMessage } from '../../support/contracts';
import { isPlainRecord } from '../../core/json';
import { extractGeminiHistoryText, normalizeGeminiContentParts } from './contentParts';
import {
  buildGeminiFunctionCallPart,
  buildGeminiFunctionResponsePart,
  enrichGeminiReplayParts,
  finalizeGeminiRequestParts,
  sanitizeGeminiToolCall,
} from './toolParts';
import { type GeminiContentEntry, repairGeminiToolTurnContents } from './toolTurnRepair';

export type GeminiConversationOptions = {
  includeFunctionCallIds?: boolean;
};

export function buildGeminiConversation(
  model: string,
  messages: ChatCompletionMessage[],
  options: GeminiConversationOptions = {},
): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role: 'user' | 'model'; parts: any[] }>;
} {
  const systemInstructions: string[] = [];
  const contents: GeminiContentEntry[] = [];
  const toolNameById = new Map<string, string>();
  let pendingFunctionResponses: any[] = [];

  const flushPendingFunctionResponses = () => {
    if (pendingFunctionResponses.length === 0) {
      return;
    }
    contents.push({
      role: 'user',
      parts: pendingFunctionResponses,
    });
    pendingFunctionResponses = [];
  };

  const flushPendingToolHistory = () => {
    flushPendingFunctionResponses();
  };

  for (const message of messages) {
    if (message.role === 'system') {
      const text = extractGeminiHistoryText(message.content).trim();
      if (text.length > 0) {
        systemInstructions.push(text);
      }
      continue;
    }

    if (message.role === 'tool') {
      const part = buildGeminiFunctionResponsePart(message, toolNameById);
      if (part) {
        pendingFunctionResponses.push(part);
      }
      continue;
    }

    flushPendingToolHistory();

    if (message.role === 'assistant') {
      const replayParts = Array.isArray(message.providerReplay?.geminiParts)
        ? message.providerReplay.geminiParts.filter((part: unknown): part is Record<string, any> =>
            isPlainRecord(part),
          )
        : [];
      const rawToolCalls = Array.isArray((message as any).tool_calls)
        ? (message as any).tool_calls
        : [];
      for (const toolCall of rawToolCalls) {
        const sanitized = sanitizeGeminiToolCall(toolCall);
        if (!sanitized) {
          continue;
        }
        toolNameById.set(sanitized.id, sanitized.function?.name || 'tool');
      }
      const visibleContentParts = normalizeGeminiContentParts(message.content).filter(
        (part) => !part.functionCall && !part.functionResponse,
      );
      const enrichedReplayParts =
        replayParts.length > 0 && rawToolCalls.length > 0
          ? enrichGeminiReplayParts(replayParts, rawToolCalls)
          : [];
      const parts =
        enrichedReplayParts.length > 0
          ? [...visibleContentParts, ...enrichedReplayParts]
          : replayParts.length > 0
            ? normalizeGeminiContentParts(replayParts)
            : rawToolCalls.length > 0
              ? [
                  ...visibleContentParts,
                  ...rawToolCalls
                    .map((toolCall: unknown) => buildGeminiFunctionCallPart(toolCall))
                    .filter(
                      (part: Record<string, any> | null): part is Record<string, any> =>
                        part !== null,
                    ),
                ]
              : visibleContentParts;
      if (parts.length > 0) {
        contents.push({
          role: 'model',
          parts,
        });
      }
      continue;
    }

    if (message.role === 'user') {
      const parts = normalizeGeminiContentParts(message.content);
      if (parts.length > 0) {
        contents.push({
          role: 'user',
          parts,
        });
      }
    }
  }

  flushPendingToolHistory();

  const repairedContents = repairGeminiToolTurnContents(model, contents);

  return {
    ...(systemInstructions.length > 0
      ? {
          systemInstruction: {
            parts: [{ text: systemInstructions.join('\n\n') }],
          },
        }
      : {}),
    contents: repairedContents.map((entry) => ({
      role: entry.role,
      parts: finalizeGeminiRequestParts(entry.parts, options),
    })),
  };
}
