// ---------------------------------------------------------------------------
// Kavi — Deterministic compaction summary
// ---------------------------------------------------------------------------
// Dependency-neutral summary primitives shared by the context engine and the
// optional model-backed summarizer. This module must not depend on either.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { extractToolResultSummary } from '../../utils/toolResultSummary';

const USER_REQUEST_SUMMARY_CHARS = 320;
const TOOL_RESULT_SUMMARY_CHARS = 200;
const ASSISTANT_CONCLUSION_CHARS = 400;

/** Max prior context chars to carry forward from earlier compaction summaries. */
const PRIOR_CONTEXT_MAX_CHARS_SELECTIVE = 1200;
const PRIOR_CONTEXT_MAX_CHARS_AGGRESSIVE = 600;

/** Marker used to identify compaction summary messages in the working array. */
export const COMPACTION_SUMMARY_MARKER = '[Conversation Summary]';

/** Optional memory-aware inputs for deterministic compaction summaries. */
export interface StructuredSummaryMemoryHints {
  /** Rendered focus block (e.g. from `renderFocusBlock`). */
  focusBlock?: string;
  /** Open thread / pending decision labels to surface in the summary. */
  openThreads?: string[];
}

export function getMessageContentForContext(message: Message): string {
  return message.role === 'user' ? message.enrichedContent || message.content : message.content;
}

/**
 * Build a structured summary following Anthropic's SDK compaction prompt format:
 *   1. Task Overview — user requests and goals
 *   2. Current State — what has been completed
 *   3. Context to Preserve — file paths, identifiers, key details
 *   4. Active Focus / Open Threads — memory-aware continuation state
 */
export function buildStructuredSummary(
  messages: Message[],
  tier: 'selective' | 'aggressive',
  priorContext?: string,
  hints?: StructuredSummaryMemoryHints,
): string {
  const userRequests: string[] = [];
  const assistantConclusions: string[] = [];
  const toolSummaries: string[] = [];
  let toolCallCount = 0;

  for (const msg of messages) {
    const content = getMessageContentForContext(msg);

    if (msg.role === 'user') {
      const cleaned = content.replace(/\n{2,}/g, '\n').trim();
      if (cleaned.length > 0) {
        userRequests.push(cleaned.slice(0, USER_REQUEST_SUMMARY_CHARS));
      }
    } else if (msg.role === 'assistant' && msg.content) {
      const lines = msg.content.split('\n').filter((line) => line.trim());
      const conclusion = lines.slice(0, 3).join(' ').slice(0, ASSISTANT_CONCLUSION_CHARS);
      if (conclusion) assistantConclusions.push(conclusion);
    } else if (msg.role === 'tool') {
      toolCallCount += 1;
      const toolName = msg.toolCalls?.[0]?.name || 'unknown';

      const resultPreview = extractToolResultSummary(content, TOOL_RESULT_SUMMARY_CHARS);
      if (resultPreview) {
        toolSummaries.push(`${toolName}: ${resultPreview}`);
      }
    }
  }

  const sections: string[] = [COMPACTION_SUMMARY_MARKER];

  if (priorContext) {
    const maxChars =
      tier === 'aggressive'
        ? PRIOR_CONTEXT_MAX_CHARS_AGGRESSIVE
        : PRIOR_CONTEXT_MAX_CHARS_SELECTIVE;
    const trimmed =
      priorContext.length > maxChars ? `${priorContext.slice(0, maxChars)}…` : priorContext;
    sections.push(`## Prior Context\n${trimmed}`);
  }

  if (userRequests.length > 0) {
    const limitedRequests = tier === 'aggressive' ? userRequests.slice(-3) : userRequests.slice(-6);
    sections.push(`## Task Overview\n${limitedRequests.join('\n→ ')}`);
  }

  const stateLines: string[] = [];
  if (toolCallCount > 0) {
    const limitedTools = tier === 'aggressive' ? toolSummaries.slice(-4) : toolSummaries.slice(-8);
    stateLines.push(`Tool calls: ${toolCallCount} total`);
    stateLines.push(`Recent results: ${limitedTools.join('; ')}`);
  }
  if (assistantConclusions.length > 0) {
    const limitedConclusions =
      tier === 'aggressive' ? assistantConclusions.slice(-2) : assistantConclusions.slice(-4);
    stateLines.push(`Progress: ${limitedConclusions.join(' | ')}`);
  }
  if (stateLines.length > 0) {
    sections.push(`## Current State\n${stateLines.join('\n')}`);
  }

  const focusText = (hints?.focusBlock ?? '').trim();
  if (focusText) {
    sections.push(`## Active Focus\n${focusText}`);
  }
  const openThreads = (hints?.openThreads ?? [])
    .map((thread) => thread.trim())
    .filter((thread) => thread.length > 0);
  if (openThreads.length > 0) {
    const limit = tier === 'aggressive' ? 4 : 8;
    sections.push(`## Open Threads\n- ${openThreads.slice(0, limit).join('\n- ')}`);
  }

  return sections.join('\n\n');
}
