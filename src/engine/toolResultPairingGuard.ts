// ---------------------------------------------------------------------------
// Kavi — Tool Result Pairing Guard
// ---------------------------------------------------------------------------
// Ensures every tool_call in an assistant message has a matching tool_result
// in the working message list. Creates synthetic error results for orphaned
// tool calls that never received a response (race conditions, crashes, etc.).

import type { Message, ToolCall } from '../types';

// ── Extraction helpers ───────────────────────────────────────────────────

/**
 * Extract tool_call IDs from an assistant message.
 * Returns a Map<toolCallId, toolName> for all tool calls in the message.
 */
export function extractToolCallIds(message: Message): Map<string, string> {
  const ids = new Map<string, string>();
  if (message.role !== 'assistant' || !message.toolCalls?.length) {
    return ids;
  }
  for (const tc of message.toolCalls) {
    if (tc.id) {
      ids.set(tc.id, tc.name || 'unknown');
    }
  }
  return ids;
}

/**
 * Extract the tool_call_id from a tool result message.
 */
export function extractToolResultId(message: Message): string | undefined {
  if (message.role !== 'tool') return undefined;
  return message.toolCallId || undefined;
}

// ── Synthetic result creation ────────────────────────────────────────────

/**
 * Create a synthetic tool_result message for an orphaned tool_call.
 * This prevents the LLM from seeing unanswered tool calls and retrying them.
 */
export function makeSyntheticToolResult(
  toolCallId: string,
  toolName: string,
  reason: string = 'Tool execution did not produce a result.',
): Message {
  const content = `Error: ${reason}`;
  return {
    id: `msg_synthetic_${toolCallId}`,
    role: 'tool',
    content,
    toolCallId,
    toolCalls: [
      {
        id: toolCallId,
        name: toolName,
        arguments: '{}',
        status: 'failed',
        error: reason,
      },
    ],
    timestamp: Date.now(),
    isError: true,
  };
}

// ── Main guard ───────────────────────────────────────────────────────────

/**
 * Scan working messages for orphaned tool_calls (assistant messages with
 * tool_calls that don't have matching tool_result messages following them).
 * Returns synthetic tool_result messages for any orphans found.
 *
 * This implements the Kavi invariant:
 * "An assistant message with tool_calls must ALWAYS be immediately followed
 *  by matching tool_result messages before the next LLM call."
 */
export function findOrphanedToolCalls(messages: Message[]): Message[] {
  const syntheticResults: Message[] = [];

  // Track pending tool_call IDs as we scan forward through messages
  let pendingCalls = new Map<string, string>(); // id → toolName

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // Flush any still-pending calls from a PREVIOUS assistant message
      // (this means we hit another assistant message without all results)
      for (const [id, name] of pendingCalls) {
        syntheticResults.push(
          makeSyntheticToolResult(
            id,
            name,
            'Tool call was orphaned — no result was received before the next assistant turn.',
          ),
        );
      }
      // Start tracking this assistant message's tool calls
      pendingCalls = new Map<string, string>();
      for (const tc of msg.toolCalls) {
        if (tc.id) {
          pendingCalls.set(tc.id, tc.name || 'unknown');
        }
      }
    } else if (msg.role === 'tool') {
      const resultId = extractToolResultId(msg);
      if (resultId) {
        pendingCalls.delete(resultId);
      }
    }
  }

  // Any remaining pending calls at the end of the message list are orphaned
  for (const [id, name] of pendingCalls) {
    syntheticResults.push(
      makeSyntheticToolResult(
        id,
        name,
        'Tool execution did not produce a result (possible crash or timeout).',
      ),
    );
  }

  return syntheticResults;
}

/**
 * Validate and repair tool result pairing in the working message list.
 * Returns the repaired message list with synthetic results inserted at the
 * correct positions (right after the last tool_result for their assistant message).
 *
 * This should be called AFTER tool execution and BEFORE the next LLM call.
 */
export function ensureToolResultPairing(messages: Message[]): Message[] {
  const orphans = findOrphanedToolCalls(messages);
  if (orphans.length === 0) return messages;

  // Build a set of orphan tool_call_ids for quick lookup
  const orphanIds = new Set(orphans.map((m) => m.toolCallId));

  // Insert synthetic results right after the corresponding assistant message's
  // last existing tool result (or right after the assistant message itself).
  const result: Message[] = [];
  let pendingInserts = new Map<string, Message>(); // toolCallId → synthetic message

  for (const orphan of orphans) {
    if (orphan.toolCallId) {
      pendingInserts.set(orphan.toolCallId, orphan);
    }
  }

  // Walk through messages and find insertion points
  for (let i = 0; i < messages.length; i++) {
    result.push(messages[i]);

    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      // Check which tool_calls from this assistant message are orphaned
      const orphanedFromThis: Message[] = [];
      for (const tc of msg.toolCalls) {
        if (tc.id && orphanIds.has(tc.id)) {
          const synthetic = pendingInserts.get(tc.id);
          if (synthetic) {
            orphanedFromThis.push(synthetic);
            pendingInserts.delete(tc.id);
          }
        }
      }

      if (orphanedFromThis.length > 0) {
        // Find the last tool result for this assistant message
        let insertAfter = i;
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j].role === 'tool') {
            insertAfter = j;
          } else {
            break;
          }
        }

        // If insertAfter > i, we need to add the remaining tool messages first
        // then insert synthetics
        if (insertAfter > i) {
          for (let j = i + 1; j <= insertAfter; j++) {
            result.push(messages[j]);
          }
          // Skip these in the outer loop
          i = insertAfter;
        }

        // Insert synthetic results
        for (const synthetic of orphanedFromThis) {
          result.push(synthetic);
        }
      }
    }
  }

  // Any remaining pending inserts (shouldn't happen, but safety net)
  for (const synthetic of pendingInserts.values()) {
    result.push(synthetic);
  }

  return result;
}

/**
 * Deduplicate tool_result messages with the same toolCallId.
 * Keeps the LAST result for each ID (most recent is likely most accurate).
 */
export function deduplicateToolResults(messages: Message[]): Message[] {
  const seenToolCallIds = new Set<string>();
  const result: Message[] = [];

  // Walk backwards to keep the LAST occurrence
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool' && msg.toolCallId) {
      if (seenToolCallIds.has(msg.toolCallId)) {
        continue; // Skip duplicate
      }
      seenToolCallIds.add(msg.toolCallId);
    }
    result.unshift(msg);
  }

  return result;
}
