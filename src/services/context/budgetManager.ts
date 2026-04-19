// ---------------------------------------------------------------------------
// Kavi — Context Budget Manager
// ---------------------------------------------------------------------------
// Pre-flight token budget enforcement to prevent oversized API requests.
// Ensures system_prompt + tools + messages fit within the model's context window
// BEFORE sending to the LLM API, preventing:
//   - 400 errors from exceeding context limits
//   - Excessive costs from 200K+ token first messages
//   - Wasted API calls that will be rejected
//
// Budget allocation strategy (industry best practice):
//   System prompt:  ~10% of context window (hard cap)
//   Tool definitions: ~15% of context window (compressed if needed)
//   Messages:         remaining budget (windowed recent-first)
//   Output reserve:   reserve maxTokens for completion output

import { estimateTokens, estimateMessageTokens, getWorkingContextWindow } from './tokenCounter';
import {
  estimateAllToolTokens,
  compressToolDefinitions,
  enforceToolTokenBudget,
} from '../../engine/tools/toolManager';
import type { ToolDefinition } from '../../types';

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractAssistantToolCallIds(message: {
  role: string;
  content?: string | any[];
  [key: string]: any;
}): string[] {
  if (message.role !== 'assistant') {
    return [];
  }

  const ids = new Set<string>();

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (typeof toolCall?.id === 'string' && toolCall.id.length > 0) {
        ids.add(toolCall.id);
      }
    }
  }

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (
        isPlainRecord(block) &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        block.id.length > 0
      ) {
        ids.add(block.id);
      }
    }
  }

  const replayOutput = Array.isArray(message.providerReplay?.openaiResponseOutput)
    ? message.providerReplay.openaiResponseOutput
    : [];
  for (const item of replayOutput) {
    if (!isPlainRecord(item) || item.type !== 'function_call') {
      continue;
    }

    const callId =
      typeof item.call_id === 'string' && item.call_id.length > 0
        ? item.call_id
        : typeof item.id === 'string' && item.id.length > 0
          ? item.id
          : '';

    if (callId) {
      ids.add(callId);
    }
  }

  return Array.from(ids);
}

function assistantMessageHasToolCalls(message: {
  role: string;
  content?: string | any[];
  [key: string]: any;
}): boolean {
  return extractAssistantToolCallIds(message).length > 0;
}

// ── Budget allocation ────────────────────────────────────────────────────

/** Share of context window reserved for system prompt */
export const SYSTEM_PROMPT_SHARE = 0.1;

/** Share of context window reserved for tool definitions */
export const TOOL_DEFINITIONS_SHARE = 0.15;

/** Minimum tokens to reserve for output completion */
export const MIN_OUTPUT_RESERVE = 4096;

/** Absolute max for system prompt (tokens) to prevent runaway */
export const MAX_SYSTEM_PROMPT_TOKENS = 8192;

/** Absolute max for tool definitions (tokens) */
export const MAX_TOOL_DEFINITION_TOKENS = 12000;

export interface ContextBudget {
  contextWindow: number;
  outputReserve: number;
  systemPromptBudget: number;
  toolsBudget: number;
  messagesBudget: number;
}

export interface ContextBudgetPressure {
  budget: ContextBudget;
  systemPromptTokens: number;
  toolsTokens: number;
  messagesTokens: number;
  totalTokens: number;
  totalAvailable: number;
  remainingMessagesBudget: number;
  messageOverflowTokens: number;
  withinBudget: boolean;
  requiresSystemPromptTruncation: boolean;
  requiresToolCompression: boolean;
  requiresMessageWindowing: boolean;
}

export interface BudgetCheckResult {
  withinBudget: boolean;
  systemPromptTokens: number;
  toolsTokens: number;
  messagesTokens: number;
  totalTokens: number;
  budget: ContextBudget;
  /** If adjustments were needed */
  adjustments: string[];
}

export interface AdjustedPayload {
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: Array<{ role: string; content: string | any[]; [key: string]: any }>;
  result: BudgetCheckResult;
}

export interface ContextBudgetEnforcementOptions {
  pinnedToolNames?: Iterable<string>;
}

function estimateBudgetMessageTokens(
  messages: Array<{ role: string; content: string | any[]; [key: string]: any }>,
): number {
  return estimateMessageTokens(
    messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
    })),
  );
}

// ── Budget computation ───────────────────────────────────────────────────

export function computeContextBudget(model: string, maxTokens: number = 16384): ContextBudget {
  const contextWindow = getWorkingContextWindow(model);
  const outputReserve = Math.max(MIN_OUTPUT_RESERVE, maxTokens);

  const available = contextWindow - outputReserve;
  const systemPromptBudget = Math.min(
    Math.floor(available * SYSTEM_PROMPT_SHARE),
    MAX_SYSTEM_PROMPT_TOKENS,
  );
  const toolsBudget = Math.min(
    Math.floor(available * TOOL_DEFINITIONS_SHARE),
    MAX_TOOL_DEFINITION_TOKENS,
  );
  const messagesBudget = available - systemPromptBudget - toolsBudget;

  return {
    contextWindow,
    outputReserve,
    systemPromptBudget,
    toolsBudget,
    messagesBudget: Math.max(messagesBudget, 4096), // at least 4K for messages
  };
}

export function inspectContextBudget(
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
  messages: Array<{ role: string; content: string | any[]; [key: string]: any }>,
  maxTokens: number = 16384,
): ContextBudgetPressure {
  const budget = computeContextBudget(model, maxTokens);
  const normalizedMessages = removeOrphanedToolResults(messages);
  const systemPromptTokens = estimateTokens(systemPrompt);
  const toolsTokens = estimateAllToolTokens(tools);
  const messagesTokens = estimateBudgetMessageTokens(normalizedMessages);
  const totalAvailable = budget.contextWindow - budget.outputReserve;
  const remainingMessagesBudget = Math.max(totalAvailable - systemPromptTokens - toolsTokens, 0);
  const totalTokens = systemPromptTokens + toolsTokens + messagesTokens;

  return {
    budget,
    systemPromptTokens,
    toolsTokens,
    messagesTokens,
    totalTokens,
    totalAvailable,
    remainingMessagesBudget,
    messageOverflowTokens: Math.max(messagesTokens - remainingMessagesBudget, 0),
    withinBudget: totalTokens <= totalAvailable,
    requiresSystemPromptTruncation: systemPromptTokens > budget.systemPromptBudget,
    requiresToolCompression: toolsTokens > budget.toolsBudget,
    requiresMessageWindowing: messagesTokens > remainingMessagesBudget,
  };
}

// ── System prompt truncation ─────────────────────────────────────────────

/**
 * Truncate a system prompt to fit within the token budget.
 * Preserves the beginning (base prompt + persona) and end (tool guidelines).
 * Trims the middle (memory, skills details) using head+tail strategy.
 */
export function truncateSystemPrompt(prompt: string, budgetTokens: number): string {
  const currentTokens = estimateTokens(prompt);
  if (currentTokens <= budgetTokens) return prompt;

  // Convert token budget to approximate chars (Kavi: 4 chars/token)
  const budgetChars = Math.floor(budgetTokens * 4);
  if (prompt.length <= budgetChars) return prompt;

  // Head+tail: 60% from beginning (base prompt), 40% from end (guidelines)
  const notice = '\n\n[... context truncated to fit budget ...]\n\n';
  const available = budgetChars - notice.length;
  const headSize = Math.floor(available * 0.6);
  const tailSize = available - headSize;

  return prompt.slice(0, headSize) + notice + prompt.slice(prompt.length - tailSize);
}

// ── Message windowing ────────────────────────────────────────────────────

/**
 * Window messages to fit within a token budget.
 * Keeps messages recent-first (most important for context).
 * Always keeps the last user message.
 */
export function windowMessages(
  messages: Array<{ role: string; content: string | any[]; [key: string]: any }>,
  budgetTokens: number,
): Array<{ role: string; content: string | any[]; [key: string]: any }> {
  if (messages.length === 0) return messages;

  // ── Group messages into atomic units ──────────────────────────────
  // An assistant message with tool_calls + its subsequent tool results form
  // an indivisible group.  Dropping one without the other creates an orphaned
  // tool result that Gemini (and other providers) reject with 400.

  type MsgGroup = { indices: number[]; cost: number; pinned: boolean };
  const groups: MsgGroup[] = [];

  const costs = messages.map((msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return estimateTokens(content) + 4; // +4 for message framing
  });

  const totalTokens = costs.reduce((a, b) => a + b, 0);
  if (totalTokens <= budgetTokens) return messages;

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    // Detect assistant message with tool_calls — group it with following tool results
    if (assistantMessageHasToolCalls(msg)) {
      const groupIndices = [i];
      let groupCost = costs[i];
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        groupIndices.push(j);
        groupCost += costs[j];
        j++;
      }
      groups.push({ indices: groupIndices, cost: groupCost, pinned: false });
      i = j;
    } else {
      groups.push({ indices: [i], cost: costs[i], pinned: false });
      i++;
    }
  }

  let usedTokens = 0;

  // Always keep first system message
  if (groups.length > 0 && messages[groups[0].indices[0]].role === 'system') {
    groups[0].pinned = true;
    usedTokens += groups[0].cost;
  }

  // Always pin the last group (most recent context)
  const lastGroup = groups[groups.length - 1];
  if (lastGroup && !lastGroup.pinned) {
    lastGroup.pinned = true;
    usedTokens += lastGroup.cost;
  }

  // Pin the latest user message group (keeps the current request coherent)
  for (let g = groups.length - 1; g >= 0; g--) {
    if (groups[g].pinned) continue;
    const firstMsg = messages[groups[g].indices[0]];
    if (firstMsg.role === 'user') {
      groups[g].pinned = true;
      usedTokens += groups[g].cost;
      break;
    }
  }

  // Walk backwards through non-pinned groups, keep as many as budget allows
  const kept = new Set<number>(); // group indices to keep
  for (let g = 0; g < groups.length; g++) {
    if (groups[g].pinned) kept.add(g);
  }

  for (let g = groups.length - 1; g >= 0; g--) {
    if (kept.has(g)) continue;
    if (usedTokens + groups[g].cost > budgetTokens) continue;
    usedTokens += groups[g].cost;
    kept.add(g);
  }

  // Collect kept message indices in original order
  const keptIndices = new Set<number>();
  for (const g of kept) {
    for (const idx of groups[g].indices) {
      keptIndices.add(idx);
    }
  }

  return messages.filter((_, idx) => keptIndices.has(idx));
}

// ── Orphaned tool result removal ─────────────────────────────────────────

/**
 * Remove tool-role messages that have no matching assistant tool_call before
 * them in the conversation.  Gemini's OpenAI-compat endpoint rejects orphaned
 * tool results with a 400 "invalid argument" error.
 */
export function removeOrphanedToolResults<T extends { role: string; [key: string]: any }>(
  messages: T[],
): T[] {
  // Collect all tool_call IDs from assistant messages
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    for (const toolCallId of extractAssistantToolCallIds(msg)) {
      toolCallIds.add(toolCallId);
    }
  }

  return messages.filter((msg) => {
    if (msg.role !== 'tool') return true;
    const toolCallId = msg.tool_call_id;
    return typeof toolCallId === 'string' && toolCallId.length > 0 && toolCallIds.has(toolCallId);
  });
}

// ── Pre-flight budget enforcement ────────────────────────────────────────

/**
 * The main pre-flight check. Adjusts the payload to fit within the model's
 * context window. Returns the adjusted payload ready for API submission.
 *
 * Adjustment order (least destructive first):
 *   1. Compress tool descriptions
 *   2. Truncate system prompt (trim memory/skills)
 *   3. Window messages (drop oldest)
 *   4. Drop tools by priority (last resort)
 */
export function enforceContextBudget(
  model: string,
  systemPrompt: string,
  tools: ToolDefinition[],
  messages: Array<{ role: string; content: string | any[]; [key: string]: any }>,
  maxTokens: number = 16384,
  options?: ContextBudgetEnforcementOptions,
): AdjustedPayload {
  const budget = computeContextBudget(model, maxTokens);
  const adjustments: string[] = [];

  let adjustedPrompt = systemPrompt;
  let adjustedTools = tools;
  let adjustedMessages = removeOrphanedToolResults(messages);

  if (adjustedMessages.length !== messages.length) {
    adjustments.push(`removed ${messages.length - adjustedMessages.length} orphaned tool results`);
  }

  // 1. Estimate current sizes
  let promptTokens = estimateTokens(adjustedPrompt);
  let toolsTokens = estimateAllToolTokens(adjustedTools);
  let messagesTokens = estimateBudgetMessageTokens(adjustedMessages);

  const totalAvailable = budget.contextWindow - budget.outputReserve;

  // 2. Compress tool descriptions if tools exceed budget
  if (toolsTokens > budget.toolsBudget) {
    adjustedTools = compressToolDefinitions(adjustedTools);
    toolsTokens = estimateAllToolTokens(adjustedTools);
    adjustments.push(`compressed tool descriptions (${toolsTokens} tokens)`);

    if (toolsTokens > budget.toolsBudget) {
      adjustedTools = enforceToolTokenBudget(adjustedTools, budget.toolsBudget, {
        pinnedToolNames: options?.pinnedToolNames,
      });
      toolsTokens = estimateAllToolTokens(adjustedTools);
      adjustments.push(
        `trimmed tools to ${adjustedTools.length} within budget (${toolsTokens} tokens)`,
      );
    }
  }

  // 3. Truncate system prompt if it exceeds budget
  if (promptTokens > budget.systemPromptBudget) {
    adjustedPrompt = truncateSystemPrompt(adjustedPrompt, budget.systemPromptBudget);
    promptTokens = estimateTokens(adjustedPrompt);
    adjustments.push(`truncated system prompt to ${promptTokens} tokens`);
  }

  // 4. Window messages if they exceed their budget
  const effectiveMessageBudget = totalAvailable - promptTokens - toolsTokens;
  if (messagesTokens > effectiveMessageBudget && effectiveMessageBudget > 0) {
    const origCount = adjustedMessages.length;
    adjustedMessages = windowMessages(adjustedMessages, effectiveMessageBudget);
    messagesTokens = estimateBudgetMessageTokens(adjustedMessages);
    adjustments.push(`windowed messages from ${origCount} to ${adjustedMessages.length}`);
  }

  // 5. Final check: if still over, aggressively trim
  let totalTokens = promptTokens + toolsTokens + messagesTokens;
  if (totalTokens > totalAvailable) {
    // Drop tools to minimum (Tier 1 only handled by toolManager)
    const aggressiveToolBudget = Math.floor(totalAvailable * 0.1);
    adjustedTools = enforceToolTokenBudget(adjustedTools, aggressiveToolBudget, {
      pinnedToolNames: options?.pinnedToolNames,
    });
    toolsTokens = estimateAllToolTokens(adjustedTools);
    adjustments.push(`aggressively reduced tools to ${adjustedTools.length}`);

    // Re-window messages with the freed budget
    const newMessageBudget = totalAvailable - promptTokens - toolsTokens;
    adjustedMessages = windowMessages(adjustedMessages, Math.max(newMessageBudget, 2048));
    messagesTokens = estimateBudgetMessageTokens(adjustedMessages);

    totalTokens = promptTokens + toolsTokens + messagesTokens;
  }

  const normalizedMessages = removeOrphanedToolResults(adjustedMessages);
  if (normalizedMessages.length !== adjustedMessages.length) {
    adjustments.push(
      `removed ${adjustedMessages.length - normalizedMessages.length} orphaned tool results`,
    );
    adjustedMessages = normalizedMessages;
    messagesTokens = estimateBudgetMessageTokens(adjustedMessages);
    totalTokens = promptTokens + toolsTokens + messagesTokens;
  }

  return {
    systemPrompt: adjustedPrompt,
    tools: adjustedTools,
    messages: adjustedMessages,
    result: {
      withinBudget: totalTokens <= totalAvailable,
      systemPromptTokens: promptTokens,
      toolsTokens,
      messagesTokens,
      totalTokens,
      budget,
      adjustments,
    },
  };
}
