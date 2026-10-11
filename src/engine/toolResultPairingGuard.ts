// ---------------------------------------------------------------------------
// Kavi — Tool Result Pairing Guard
// ---------------------------------------------------------------------------
// Ensures every tool_call in an assistant message has a matching tool_result
// in the working message list. Creates synthetic results for orphaned tool
// calls that have already completed in persisted assistant metadata, or
// synthetic errors when no real result is available.

import type { Message, ToolCall } from '../types/message';

// ── Extraction helpers ───────────────────────────────────────────────────

/**
 * Extract the tool_call_id from a tool result message.
 */
export function extractToolResultId(message: Message): string | undefined {
  if (message.role !== 'tool') return undefined;
  return message.toolCallId || undefined;
}

// ── Synthetic result creation ────────────────────────────────────────────

function getSyntheticToolResultId(
  assistantMessageId: string | undefined,
  toolCallId: string,
  sequence: number,
): string {
  const scopedPrefix = assistantMessageId?.trim() || 'unknown_assistant';
  return `msg_synthetic_${scopedPrefix}_${toolCallId}_${sequence}`;
}

function makeSyntheticToolResultFromToolCall(
  toolCall: ToolCall,
  reason: string,
  assistantMessageId: string | undefined,
  sequence: number,
): Message {
  if (toolCall.status === 'completed' && typeof toolCall.result === 'string') {
    return {
      id: getSyntheticToolResultId(assistantMessageId, toolCall.id, sequence),
      role: 'tool',
      content: toolCall.result.length > 0 ? toolCall.result : 'No output.',
      toolCallId: toolCall.id,
      toolCalls: [{ ...toolCall }],
      timestamp: Date.now(),
    };
  }

  if (toolCall.status === 'pending' || toolCall.status === 'running') {
    const content = JSON.stringify({
      status: toolCall.status,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      message:
        'Tool execution has not reached a terminal result yet. Wait for the result to be committed before continuing, or use the relevant monitor/wait tool if this tool returned a durable async handle.',
    });
    return {
      id: getSyntheticToolResultId(assistantMessageId, toolCall.id, sequence),
      role: 'tool',
      content,
      toolCallId: toolCall.id,
      toolCalls: [{ ...toolCall }],
      timestamp: Date.now(),
    };
  }

  const errorText =
    typeof toolCall.error === 'string' && toolCall.error.trim().length > 0
      ? toolCall.error.trim()
      : reason;
  const content = errorText.startsWith('Error:') ? errorText : `Error: ${errorText}`;
  return {
    id: getSyntheticToolResultId(assistantMessageId, toolCall.id, sequence),
    role: 'tool',
    content,
    toolCallId: toolCall.id,
    toolCalls: [
      {
        ...toolCall,
        status: 'failed',
        error: errorText,
      },
    ],
    timestamp: Date.now(),
    isError: true,
  };
}

function getAssistantToolCalls(message: Message): ToolCall[] {
  if (message.role !== 'assistant' || !message.toolCalls?.length) {
    return [];
  }

  return message.toolCalls.filter((toolCall) => toolCall.id?.trim());
}

function makeOrphanResultsForAssistant(
  assistantMessage: Message,
  pendingToolCalls: ToolCall[],
  reason: string,
): Message[] {
  return pendingToolCalls.map((toolCall, index) =>
    makeSyntheticToolResultFromToolCall(toolCall, reason, assistantMessage.id, index),
  );
}

// ── Main guard ───────────────────────────────────────────────────────────

/**
 * Validate and repair tool result pairing in the working message list.
 * Returns the repaired message list with synthetic results inserted at the
 * correct positions (right after the last tool_result for their assistant message).
 *
 * This should be called AFTER tool execution and BEFORE the next LLM call.
 */
export function ensureToolResultPairing(messages: Message[]): Message[] {
  const result: Message[] = [];
  let changed = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    result.push(message);

    const assistantToolCalls = getAssistantToolCalls(message);
    if (assistantToolCalls.length === 0) {
      continue;
    }

    const pendingById = new Map<string, ToolCall>();
    for (const toolCall of assistantToolCalls) {
      pendingById.set(toolCall.id, toolCall);
    }

    let scanIndex = index + 1;
    while (scanIndex < messages.length && messages[scanIndex].role === 'tool') {
      const toolMessage = messages[scanIndex];
      result.push(toolMessage);
      const resultId = extractToolResultId(toolMessage);
      if (resultId) {
        pendingById.delete(resultId);
      }
      scanIndex += 1;
    }

    if (pendingById.size > 0) {
      changed = true;
      result.push(
        ...makeOrphanResultsForAssistant(
          message,
          Array.from(pendingById.values()),
          'Tool execution did not produce a result before the next model turn.',
        ),
      );
    }

    if (scanIndex > index + 1) {
      index = scanIndex - 1;
    }
  }

  return changed ? result : messages;
}

function deduplicateToolRun(messages: Message[]): Message[] {
  if (messages.length < 2) {
    return messages;
  }

  const lastIndexByToolCallId = new Map<string, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const toolCallId = messages[index].toolCallId;
    if (toolCallId) {
      lastIndexByToolCallId.set(toolCallId, index);
    }
  }

  if (lastIndexByToolCallId.size === messages.length) {
    return messages;
  }

  return messages.filter((message, index) => {
    const toolCallId = message.toolCallId;
    if (!toolCallId) {
      return true;
    }
    return lastIndexByToolCallId.get(toolCallId) === index;
  });
}

/**
 * Deduplicate tool_result messages with the same toolCallId.
 * Keeps the LAST result inside a single contiguous tool-result group. The same
 * provider-local ID may be reused in later assistant turns, especially by
 * providers that do not emit stable tool-call IDs, so deduplication must never
 * cross assistant-turn boundaries.
 */
export function deduplicateToolResults(messages: Message[]): Message[] {
  const result: Message[] = [];
  let changed = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'tool') {
      result.push(message);
      continue;
    }

    const run: Message[] = [];
    let scanIndex = index;
    while (scanIndex < messages.length && messages[scanIndex].role === 'tool') {
      run.push(messages[scanIndex]);
      scanIndex += 1;
    }

    const dedupedRun = deduplicateToolRun(run);
    if (dedupedRun.length !== run.length) {
      changed = true;
    }
    result.push(...dedupedRun);
    index = scanIndex - 1;
  }

  return changed ? result : messages;
}
