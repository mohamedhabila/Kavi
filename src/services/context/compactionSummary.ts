// ---------------------------------------------------------------------------
// Kavi — Deterministic compaction summary
// ---------------------------------------------------------------------------
// Dependency-neutral summary primitives shared by the context engine and the
// optional model-backed summarizer. This module must not depend on either.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { extractToolResultSummary } from '../../utils/toolResultSummary';
import {
  parseReadFileContinuationResult,
  parseReadFileContinuationSummaryLine,
  mergeReadFileContinuationState,
  READ_FILE_CONTINUATION_HEADING,
  READ_FILE_CONTINUATION_TOOL,
  serializeReadFileContinuationSummaryLine,
  type ReadFileContinuationState,
} from '../../utils/readFileContinuation';

const USER_REQUEST_SUMMARY_CHARS = 320;
const TOOL_RESULT_SUMMARY_CHARS = 200;
const ASSISTANT_CONCLUSION_CHARS = 400;

/** Max prior context chars to carry forward from earlier compaction summaries. */
const PRIOR_CONTEXT_MAX_CHARS_SELECTIVE = 1200;
const PRIOR_CONTEXT_MAX_CHARS_AGGRESSIVE = 600;
const MAX_READ_FILE_CONTINUATION_STATES = 64;

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

export function stripCodeOwnedContinuationSection(value: string): string {
  const lines = value.split('\n');
  const retained: string[] = [];
  let skippingContinuation = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === READ_FILE_CONTINUATION_HEADING) {
      skippingContinuation = true;
      continue;
    }
    if (skippingContinuation && trimmed.startsWith('## ')) {
      skippingContinuation = false;
    }
    if (!skippingContinuation) retained.push(line);
  }

  return retained.join('\n');
}

/**
 * Rebuild the code-owned continuation section from both the candidate summary
 * and the full source message set. This is intentionally safe to apply again
 * at orchestration and persistence boundaries: an asynchronously delivered or
 * otherwise stale compaction result must not replace a newer EOF checkpoint
 * for the same immutable file revision.
 */
export function repairReadFileContinuationSummary(
  summary: string,
  sourceMessages: ReadonlyArray<Message>,
): string {
  const normalizedSummary = summary.trim();
  const continuationSection = buildReadFileContinuationSummarySection(
    sourceMessages,
    normalizedSummary || undefined,
  );
  if (!continuationSection) return normalizedSummary;

  const withoutContinuation = stripCodeOwnedContinuationSection(normalizedSummary).trim();
  return [withoutContinuation, continuationSection].filter(Boolean).join('\n\n');
}

/**
 * Carry forward useful prior context without recursively nesting whole summary
 * envelopes. The newest tail is preferred because it contains the latest
 * state; exact user constraints and graph goals are preserved independently.
 */
export function normalizePriorCompactionContext(
  priorContext: string | undefined,
  tier: 'selective' | 'aggressive',
): string {
  if (!priorContext?.trim()) return '';

  const withoutContinuation = stripCodeOwnedContinuationSection(priorContext);
  const cleaned = withoutContinuation
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== COMPACTION_SUMMARY_MARKER && trimmed !== '## Prior Context';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const maxChars =
    tier === 'aggressive' ? PRIOR_CONTEXT_MAX_CHARS_AGGRESSIVE : PRIOR_CONTEXT_MAX_CHARS_SELECTIVE;
  if (cleaned.length <= maxChars) return cleaned;
  return `…${cleaned.slice(-(maxChars - 1))}`;
}

function readToolName(message: Message): string {
  return message.toolCalls?.[0]?.name?.trim() ?? '';
}

function collectReadFileContinuationStates(
  messages: ReadonlyArray<Message>,
  priorContext?: string,
): ReadFileContinuationState[] {
  const states = new Map<string, ReadFileContinuationState>();

  for (const line of priorContext?.split('\n') ?? []) {
    const state = parseReadFileContinuationSummaryLine(line);
    if (state)
      states.set(state.path, mergeReadFileContinuationState(states.get(state.path), state));
  }

  for (const message of messages) {
    for (const line of message.content.split('\n')) {
      const summaryState = parseReadFileContinuationSummaryLine(line);
      if (summaryState) {
        states.set(
          summaryState.path,
          mergeReadFileContinuationState(states.get(summaryState.path), summaryState),
        );
      }
    }
    if (message.role !== 'tool' || readToolName(message) !== READ_FILE_CONTINUATION_TOOL) continue;
    const state = parseReadFileContinuationResult(message.content);
    if (state)
      states.set(state.path, mergeReadFileContinuationState(states.get(state.path), state));
  }

  return Array.from(states.values()).slice(-MAX_READ_FILE_CONTINUATION_STATES);
}

export function buildReadFileContinuationSummarySection(
  messages: ReadonlyArray<Message>,
  priorContext?: string,
): string {
  const states = collectReadFileContinuationStates(messages, priorContext);
  if (states.length === 0) return '';

  return [
    READ_FILE_CONTINUATION_HEADING,
    ...states.map(serializeReadFileContinuationSummaryLine),
    'Reread entries with rereadOffset at that exact offset because their durable checkpoint omitted the chunk body. Otherwise resume each incomplete file at its exact nextOffset, and do not reread a completed file only because earlier chunks were compacted.',
  ].join('\n');
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

  const normalizedPriorContext = normalizePriorCompactionContext(priorContext, tier);
  if (normalizedPriorContext) {
    sections.push(`## Prior Context\n${normalizedPriorContext}`);
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

  const continuationSection = buildReadFileContinuationSummarySection(messages, priorContext);
  if (continuationSection) sections.push(continuationSection);

  return sections.join('\n\n');
}
