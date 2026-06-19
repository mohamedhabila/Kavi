import type { StreamEvent, StreamedToolCall } from '../../support/contracts';
import { isPlainRecord } from '../json';

function getSharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

export function mergeStreamedArgumentText(existing: string, incoming: string): string {
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  if (incoming === existing || existing.startsWith(incoming)) {
    return existing;
  }

  const trimmedExisting = existing.trimStart();
  const trimmedIncoming = incoming.trimStart();
  const sharedJsonStart =
    trimmedExisting[0] === trimmedIncoming[0] &&
    (trimmedExisting[0] === '{' || trimmedExisting[0] === '[');

  if (sharedJsonStart) {
    const sharedPrefixLength = getSharedPrefixLength(trimmedExisting, trimmedIncoming);
    const shorterLength = Math.min(trimmedExisting.length, trimmedIncoming.length);
    const likelyCumulativeSnapshot =
      sharedPrefixLength >= Math.max(2, Math.floor(shorterLength * 0.6));

    if (likelyCumulativeSnapshot) {
      return trimmedIncoming.length >= trimmedExisting.length ? incoming : existing;
    }
  }

  return incoming.startsWith(existing) ? incoming : `${existing}${incoming}`;
}

export function mergeStreamToolCallChunk(
  existing: StreamedToolCall,
  chunk: Record<string, any>,
): StreamedToolCall {
  const nextRaw: Record<string, any> = isPlainRecord(existing.raw) ? { ...existing.raw } : {};

  if (typeof chunk.id === 'string' && chunk.id.length > 0) {
    nextRaw.id = chunk.id;
  }

  if (typeof chunk.type === 'string' && chunk.type.length > 0) {
    nextRaw.type = chunk.type;
  }

  if (chunk.extra_content !== undefined) {
    nextRaw.extra_content = chunk.extra_content;
  }

  const functionChunk = isPlainRecord(chunk.function) ? chunk.function : undefined;
  if (functionChunk) {
    const nextFunction = isPlainRecord(nextRaw.function) ? { ...nextRaw.function } : {};

    for (const [key, value] of Object.entries(functionChunk)) {
      if (value === undefined) continue;
      if (key === 'arguments' && typeof value === 'string') {
        nextFunction.arguments = mergeStreamedArgumentText(
          typeof nextFunction.arguments === 'string' ? nextFunction.arguments : '',
          value,
        );
      } else {
        nextFunction[key] = value;
      }
    }

    nextRaw.function = nextFunction;
  }

  return {
    id: typeof nextRaw.id === 'string' && nextRaw.id.length > 0 ? nextRaw.id : existing.id,
    name:
      typeof nextRaw.function?.name === 'string' && nextRaw.function.name.length > 0
        ? nextRaw.function.name
        : existing.name,
    arguments:
      typeof nextRaw.function?.arguments === 'string'
        ? nextRaw.function.arguments
        : existing.arguments,
    ...(Object.keys(nextRaw).length > 0 ? { raw: nextRaw } : {}),
  };
}

function getStreamedToolCallSignature(toolCall: StreamedToolCall): string {
  return [
    toolCall.id,
    toolCall.name,
    toolCall.arguments,
    toolCall.raw ? JSON.stringify(toolCall.raw) : '',
  ].join('\u0001');
}

export function getEmittableStreamedToolCall(
  toolCalls: Record<number, StreamedToolCall>,
  emittedToolCallSignatures: Map<number, string>,
  index: number,
): StreamedToolCall | undefined {
  const toolCall = toolCalls[index];
  if (!toolCall || !toolCall.id || !toolCall.name) {
    return undefined;
  }

  const signature = getStreamedToolCallSignature(toolCall);
  if (emittedToolCallSignatures.get(index) === signature) {
    return undefined;
  }

  emittedToolCallSignatures.set(index, signature);
  return toolCall;
}

export function collectPendingToolCallEvents(
  toolCalls: Record<number, StreamedToolCall>,
  emittedToolCallSignatures: Map<number, string>,
): StreamEvent[] {
  const events: StreamEvent[] = [];

  for (const indexText of Object.keys(toolCalls)) {
    const queuedToolCall = getEmittableStreamedToolCall(
      toolCalls,
      emittedToolCallSignatures,
      Number(indexText),
    );
    if (queuedToolCall) {
      events.push({ type: 'tool_call', toolCall: queuedToolCall });
    }
  }

  return events;
}
