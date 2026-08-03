// ---------------------------------------------------------------------------
// Kavi — Compaction summarizer
// ---------------------------------------------------------------------------
// Builds tier-2/tier-3 compaction summaries. Uses an optional cheaper LLM when
// configured; otherwise deterministic structural extraction.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { createTimeoutSignal } from '../../utils/runtime';
import { LlmService } from '../llm/LlmService';
import {
  buildReadFileContinuationSummarySection,
  buildStructuredSummary,
  COMPACTION_SUMMARY_MARKER,
  getMessageContentForContext,
  normalizePriorCompactionContext,
  type StructuredSummaryMemoryHints,
} from './compactionSummary';
import type { CompactionSummarizerConfig } from './compactionModelResolver';

const COMPACTION_LLM_TIMEOUT_MS = 45_000;
const SELECTIVE_SUMMARY_MAX_TOKENS = 2_000;
const AGGRESSIVE_SUMMARY_MAX_TOKENS = 1_200;

function extractAssistantText(response: unknown): string {
  if (typeof response === 'string') {
    return response;
  }
  if (!response || typeof response !== 'object') {
    return '';
  }
  const value = response as Record<string, unknown>;
  const choiceContent = (
    value.choices as Array<{ message?: { content?: unknown } }> | undefined
  )?.[0]?.message?.content;
  if (typeof choiceContent === 'string') {
    return choiceContent;
  }
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map((part) =>
        typeof part === 'string'
          ? part
          : ((part as { text?: string }).text ??
            (part as { output_text?: string }).output_text ??
            ''),
      )
      .join('');
  }
  if (typeof value.output_text === 'string') {
    return value.output_text;
  }
  return '';
}

function buildCompactionLlmPrompt(
  messages: ReadonlyArray<Message>,
  tier: 'selective' | 'aggressive',
  hints?: StructuredSummaryMemoryHints,
): string {
  const transcript = messages
    .map((message) => `${message.role}: ${getMessageContentForContext(message)}`)
    .join('\n');
  const openThreads = (hints?.openThreads ?? []).map((thread) => thread.trim()).filter(Boolean);

  return [
    'Summarize the conversation excerpt for mobile agent context compaction.',
    'The summary replaces the excerpt, so unfinished work must survive it. Record exact',
    'identifiers, paths, values, and user-stated constraints verbatim; never invent progress',
    'or describe an action as completed unless the excerpt shows its result.',
    'Return markdown with these sections when applicable:',
    '## Task Overview',
    '## Current State',
    '## Important Discoveries',
    '## Context to Preserve',
    '## Constraints to Respect',
    '## Open Threads / Next Steps',
    ...(openThreads.length > 0
      ? [
          'These code-owned open threads are still live and must appear under',
          '"## Open Threads / Next Steps":',
          ...openThreads.map((thread) => `- ${thread}`),
        ]
      : []),
    `Compaction tier: ${tier}`,
    '---',
    transcript,
  ].join('\n');
}

function normalizeLlmSummary(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes(COMPACTION_SUMMARY_MARKER)) {
    return trimmed;
  }
  return `${COMPACTION_SUMMARY_MARKER}\n\n${trimmed}`;
}

export async function buildCompactionSummary(params: {
  messages: ReadonlyArray<Message>;
  tier: 'selective' | 'aggressive';
  priorContext?: string;
  hints?: StructuredSummaryMemoryHints;
  summarizer?: CompactionSummarizerConfig | null;
}): Promise<string> {
  const deterministic = () =>
    buildStructuredSummary([...params.messages], params.tier, params.priorContext, params.hints);

  if (!params.summarizer) {
    return deterministic();
  }

  try {
    const llm = new LlmService(
      params.summarizer.apiKey
        ? { ...params.summarizer.provider, apiKey: params.summarizer.apiKey }
        : params.summarizer.provider,
    );
    const response = await llm.sendMessage(
      [
        {
          role: 'user',
          content: buildCompactionLlmPrompt(params.messages, params.tier, params.hints),
        },
      ] as never,
      {
        model: params.summarizer.model,
        maxTokens:
          params.tier === 'aggressive'
            ? AGGRESSIVE_SUMMARY_MAX_TOKENS
            : SELECTIVE_SUMMARY_MAX_TOKENS,
        signal: createTimeoutSignal(COMPACTION_LLM_TIMEOUT_MS),
      },
    );
    const normalized = normalizeLlmSummary(extractAssistantText(response));
    if (!normalized) {
      return deterministic();
    }
    const sections = [normalized];
    // Code-owned pending work is appended rather than trusted to the summarizer:
    // a dropped open thread is exactly the failure this section exists to prevent.
    const focusText = (params.hints?.focusBlock ?? '').trim();
    if (focusText) {
      sections.push(`## Active Focus\n${focusText}`);
    }
    const openThreads = (params.hints?.openThreads ?? [])
      .map((thread) => thread.trim())
      .filter(Boolean);
    if (openThreads.length > 0) {
      sections.push(`## Open Threads (code-owned)\n- ${openThreads.join('\n- ')}`);
    }
    const normalizedPriorContext = normalizePriorCompactionContext(
      params.priorContext,
      params.tier,
    );
    if (normalizedPriorContext) {
      sections.push(`## Prior Context\n${normalizedPriorContext}`);
    }
    const continuationSection = buildReadFileContinuationSummarySection(
      params.messages,
      params.priorContext,
    );
    if (continuationSection) sections.push(continuationSection);
    return sections.join('\n\n');
  } catch {
    return deterministic();
  }
}
