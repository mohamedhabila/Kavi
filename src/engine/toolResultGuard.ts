// ---------------------------------------------------------------------------
// Kavi — Tool Result Guard
// ---------------------------------------------------------------------------
// Implements: tool result truncation (head+tail), per-result context budgeting,
// oldest-first compaction of large tool results in working messages,
// and preemptive overflow detection for tool-driven context management.

import type { Message } from '../types/message';
import { buildToolResultPlaceholder, isToolResultPlaceholder } from '../utils/toolResultSummary';

// ── Constants ──────────────────────────────────────────────────────────

/** Absolute hard cap on a single tool result (characters) */
export const HARD_MAX_TOOL_RESULT_CHARS = 120_000;

/** Maximum share of the working context a single tool result may use */
export const SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.25;

/** Minimum chars to keep even after aggressive truncation */
export const MIN_KEEP_CHARS = 1200;

/** Headroom ratio for usable input context. */
export const CONTEXT_INPUT_HEADROOM_RATIO = 0.75;

/** Trigger preemptive compaction once context usage nears overflow. */
export const PREEMPTIVE_OVERFLOW_RATIO = 0.9;

/** Conservative token/char ratios for tool-heavy content. */
export const CHARS_PER_TOKEN = 4;
export const TOOL_RESULT_CHARS_PER_TOKEN = 2; // Tool results are denser

/** Prefix used to identify compacted tool results. */
export const COMPACTION_PLACEHOLDER = '[compacted:';

/** Suffix appended to truncated results */
const TRUNCATION_NOTICE = '\n[truncated: output exceeded context limit]';

function truncateScalar(value: string, maxChars = 400): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}… (${value.length - maxChars} chars omitted)`;
}

function summarizeStructuredValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return truncateScalar(value, depth === 0 ? 600 : 240);
  }

  if (Array.isArray(value)) {
    if (value.length <= 8) {
      return value.map((entry) => summarizeStructuredValue(entry, depth + 1));
    }

    return {
      summary: {
        type: 'array',
        count: value.length,
        omitted: Math.max(0, value.length - 5),
      },
      firstItems: value.slice(0, 3).map((entry) => summarizeStructuredValue(entry, depth + 1)),
      lastItems: value.slice(-2).map((entry) => summarizeStructuredValue(entry, depth + 1)),
    };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const priorityKeys = [
      'summary',
      'status',
      'error',
      'message',
      'failureLogs',
      'workflowRun',
      'jobs',
      'runs',
      'checks',
      'count',
      'total',
      'projectId',
      'projectName',
      'mode',
      'id',
      'name',
      'path',
      'url',
      'outputExcerpt',
      'output',
      'note',
      'guidance',
      'items',
      'results',
    ];
    entries.sort(([left], [right]) => {
      const leftPriority = priorityKeys.indexOf(left);
      const rightPriority = priorityKeys.indexOf(right);
      if (leftPriority === -1 && rightPriority === -1) return left.localeCompare(right);
      if (leftPriority === -1) return 1;
      if (rightPriority === -1) return -1;
      return leftPriority - rightPriority;
    });

    const limitedEntries = entries.slice(0, depth === 0 ? 14 : 8);
    const summarized = Object.fromEntries(
      limitedEntries.map(([key, entryValue]) => [
        key,
        summarizeStructuredValue(entryValue, depth + 1),
      ]),
    );
    if (entries.length > limitedEntries.length) {
      (summarized as Record<string, unknown>).omittedKeys = entries.length - limitedEntries.length;
    }
    return summarized;
  }

  return String(value);
}

function compactStructuredToolResult(result: string): string {
  const trimmed = result.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return result;
  }

  try {
    const parsed = JSON.parse(trimmed);
    const summarized = summarizeStructuredValue(parsed);
    return JSON.stringify(summarized, null, 2);
  } catch {
    return result;
  }
}

function compactLineHeavyResult(result: string): string {
  const lines = result.split(/\r?\n/);
  if (lines.length <= 120) {
    return result;
  }

  const head = lines.slice(0, 60);
  const tail = lines.slice(-20);
  return [...head, `[${lines.length - 80} lines omitted to preserve context budget]`, ...tail].join(
    '\n',
  );
}

// ── Head + tail truncation ───────────────────────────────────────────────

/**
 * Truncate a tool result to fit within maxChars using head+tail strategy.
 * Keeps the beginning and end of the result for maximum context.
 */
export function truncateToolResult(
  result: string,
  maxChars: number = HARD_MAX_TOOL_RESULT_CHARS,
): string {
  const limit = Math.max(MIN_KEEP_CHARS, maxChars);
  if (result.length <= limit) return result;

  const noticeLen = TRUNCATION_NOTICE.length;
  const available = limit - noticeLen;
  if (available <= 0) return result.slice(0, limit);

  // Truncate at a newline boundary (Kavi pattern: if we're past 70%)
  let headSize = Math.floor(available * 0.7);

  // Try to break at a newline for cleaner output
  const lastNewline = result.lastIndexOf('\n', headSize);
  if (lastNewline > headSize * 0.7) {
    headSize = lastNewline;
  }

  const tailSize = available - headSize;

  const head = result.slice(0, headSize);
  const tail = result.slice(result.length - tailSize);

  return head + TRUNCATION_NOTICE + tail;
}

/**
 * Compute the character budget for a single tool result based on context window.
 */
export function getToolResultCharBudget(contextWindowTokens: number): number {
  // Kavi: contextWindowTokens * TOOL_RESULT_CHARS_PER_TOKEN * SINGLE_SHARE
  const contextChars = contextWindowTokens * TOOL_RESULT_CHARS_PER_TOKEN;
  const shareBudget = Math.floor(contextChars * SINGLE_TOOL_RESULT_CONTEXT_SHARE);
  return Math.min(shareBudget, HARD_MAX_TOOL_RESULT_CHARS);
}

/**
 * Truncate a tool result to fit within the model's context budget.
 */
export function enforceToolResultBudget(result: string, contextWindowTokens: number): string {
  const budget = getToolResultCharBudget(contextWindowTokens);

  // Only apply structured compaction + line collapsing when the result
  // actually exceeds the budget.  Previously these ran unconditionally,
  // which truncated nested strings to 240 chars even for small results
  // (e.g. workflow failure excerpts) and injected "chars omitted" markers
  // that confused models into retrying the same tool call.
  if (result.length <= budget) {
    return result;
  }

  const structured = compactStructuredToolResult(result);
  const lineCompacted = compactLineHeavyResult(structured);
  return truncateToolResult(lineCompacted, budget);
}

// ── Oldest-first tool result compaction (Kavi pattern) ───────────────

/**
 * When total context estimate exceeds the headroom budget, progressively replace
 * the OLDEST tool results with a compact placeholder (Kavi pattern).
 * This keeps recent tool work at full fidelity — unlike truncation, replacement
 * is cleaner and signals to the LLM that old context was intentionally removed.
 */
export function compactToolResults(messages: Message[], contextWindowTokens: number): Message[] {
  // Context budget: 75% of window in chars (Kavi headroom ratio)
  const contextBudgetChars = contextWindowTokens * CHARS_PER_TOKEN * CONTEXT_INPUT_HEADROOM_RATIO;

  // Estimate total context chars
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
  }

  if (totalChars <= contextBudgetChars) return messages;

  // Collect tool message indices (oldest first)
  const toolIndices: Array<{ idx: number; chars: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool' && !isToolResultPlaceholder(messages[i].content, 'compacted')) {
      toolIndices.push({ idx: i, chars: messages[i].content.length });
    }
  }

  const result = [...messages];
  let excess = totalChars - contextBudgetChars;

  // Replace oldest tool results with placeholder until within budget
  for (const { idx, chars } of toolIndices) {
    if (excess <= 0) break;
    const toolName = messages[idx].toolCalls?.[0]?.name || messages[idx].toolCallId || 'tool';
    const placeholder = buildToolResultPlaceholder('compacted', toolName, messages[idx].content);
    const saved = chars - placeholder.length;
    if (saved > 0) {
      result[idx] = { ...result[idx], content: placeholder };
      excess -= saved;
    }
  }

  return result;
}

/**
 * Check if context is approaching overflow (Kavi preemptive overflow pattern).
 * Returns true if context exceeds 90% of window — orchestrator should trigger compaction.
 */
export function isApproachingContextOverflow(
  messages: Message[],
  contextWindowTokens: number,
): boolean {
  const overflowChars = contextWindowTokens * CHARS_PER_TOKEN * PREEMPTIVE_OVERFLOW_RATIO;
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
  }
  return totalChars > overflowChars;
}
