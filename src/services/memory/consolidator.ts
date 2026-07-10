// ---------------------------------------------------------------------------
// Kavi — Memory consolidator
// ---------------------------------------------------------------------------
// After every closed assistant turn we run a single-pass memory extractor
// against the just-finished turn. The extractor returns:
//   • new_facts        — durable assertions to record into the bi-temporal
//                        fact store (entity registry rolls up names).
//   • active_focus     — short rolling summary (≤ 600 chars).
//   • open_threads     — short labels for unresolved follow-ups.
//   • notable          — one-shot lines for the next turn's `<focus>` block.
//
// Design rules:
//   • Provider output proposes facts. It never receives direct invalidation
//     authority. A replacement is applied only after deterministic admission.
//   • Idempotent: re-running on the same turn must be a no-op (we dedupe by
//     content_hash inside facts.recordFact).
//   • Provider-agnostic: the extractor is just an `(prompt) => Promise<json>`
//     callback so we can swap mocked / on-device / cloud LLMs without edits.
//   • Fail-safe: any parse / network failure yields an empty result; we never
//     pollute memory with junk and never throw out of the chat path.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import { recordFact, replaceCurrentFact } from './facts/mutations';
import type { MemoryFactScope } from './facts/types';
import { upsertEntity } from './entities';
import { editBlock, ensureDefaultBlocks } from './blocks';
import { ensureFactSchema } from './schema';
import { addFactEvidence, recordEpisode } from './episodes/mutations';
import { editWorkingBlock } from './workingBlocks';
import { composeActiveFocusContent } from './focus';
import { createLogger } from '../../utils/logger';

const logger = createLogger('memory.consolidator');

export interface ConsolidatorTurnInput {
  /** Most recent user message that led to this assistant turn. */
  userMessage: string;
  /** Final assistant response delivered to the user. */
  assistantMessage: string;
  /** Optional system / persona context — included only if short enough to matter. */
  personaSummary?: string;
  /** Optional thread title for grounding. Pass undefined for an untitled thread. */
  threadTitle?: string;
  /** Wall-clock for the turn (defaults to Date.now()). */
  now?: number;
  /** Conversation/thread provenance for scoped facts and episode summaries. */
  conversationId?: string;
  threadId?: string;
  taskId?: string;
  sourceRunId?: string;
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  /** All user/assistant/tool messages since the previous consolidation cursor. */
  messages?: Message[];
}

export type ConsolidatorFactOperation = 'insert' | 'replace_current';

export type ConsolidatorAssertionClass =
  | 'current_direct'
  | 'historical'
  | 'hypothetical'
  | 'quoted'
  | 'third_party'
  | 'uncertain';

export interface AdmittedFactWrite {
  operation: 'replace_current';
  authority: 'grounded_user_statement';
  evidenceMessageId: string;
  expectedCurrentFactId: string;
}

export interface ConsolidatorFact {
  subject: string;
  predicate: string;
  value: string;
  scope?: MemoryFactScope;
  importance?: number;
  evidenceMessageIds?: string[];
  reason?: string;
  /** Untrusted provider proposal. Persistence ignores this until admission. */
  operation?: ConsolidatorFactOperation;
  assertionClass?: ConsolidatorAssertionClass;
  evidenceQuote?: string;
  /** Internal authority created only by deterministic product code. */
  admittedWrite?: AdmittedFactWrite;
  /** Plain-language confidence label from the model: "high" | "medium" | "low". */
  confidence?: 'high' | 'medium' | 'low' | number;
}

export interface ConsolidatorResult {
  episodeSummary?: string | null;
  newFacts: ConsolidatorFact[];
  activeFocus: string | null;
  openThreads: string[];
  notable: string[];
}

export type ConsolidatorExtractor = (prompt: string) => Promise<string>;

export interface ConsolidatorOptions {
  extractor: ConsolidatorExtractor;
  /** Override clock for tests. */
  now?: () => number;
  /**
   * When true, persist results to the memory store (facts + active_focus block).
   * Default true; tests can disable to inspect the parsed output.
   */
  persist?: boolean;
}

const PROMPT_HEADER = `You are the memory consolidator for an assistant chat app.
Read the latest user message, assistant reply, and message window, then extract ONLY
information that should remain available to the assistant after the turn. Memory is
scoped: stable user profile and preferences are global, while active-task facts,
workspace/project identifiers, decisions, constraints, and verification tokens can
be conversation, project, or session memory. Be conservative: prefer to extract
nothing over guessing, but do not drop facts the user explicitly asked the assistant
to retain.

Return STRICT JSON only — no prose, no markdown fences. Schema:
{
  "new_facts": [
    {
      "subject": "user" | "assistant" | "<entity name>",
      "predicate": "short snake_case relation (e.g. has_name, prefers_tone)",
      "value": "concise string value",
      "scope": "global" | "project" | "conversation" | "session",
      "importance": 0.0,
      "confidence": 0.0,
      "evidence_message_ids": ["message id", ...],
      "operation": "insert" | "replace_current",
      "assertion_class": "current_direct" | "historical" | "hypothetical" | "quoted" | "third_party" | "uncertain",
      "evidence_quote": "verbatim quote from the current user message",
      "reason": "short grounding note"
    }
  ],
  "episode_summary": "short summary of this consolidated message window, or null",
  "active_focus": "1-3 sentence rolling summary of what the user is working on, or null",
  "open_threads": ["short label of an unresolved follow-up", ...],
  "notable": ["a line worth surfacing in the next turn's focus header", ...]
}

Rules:
- Skip ephemeral chit-chat. Do not extract greetings, jokes, or filler.
- new_facts: only durable assertions. Reject opinions stated as facts.
- Default operation to insert. Use replace_current only when the latest user
  directly states that a current value changed. Never use it for history,
  hypotheticals, questions, quotations, third-party claims, assistant text, or
  tool output.
- Every replace_current proposal must use assertion_class current_direct,
  include the latest user message id in evidence_message_ids, and include an
  evidence_quote copied verbatim from that user message.
- Extract explicit user memory-write intents in any language. Preserve supplied
  subject, predicate, and value labels when they are given, including opaque IDs,
  checksums, codes, and tokens. The assistant does not need to restate the fact.
- Up to 5 new_facts, 5 open_threads, 2 notable.
- Use global scope only for stable user profile/preferences. Use conversation
  or session for active-task details. Use project for repo/workspace facts.
- value strings <= 200 chars. labels <= 80 chars. active_focus <= 600 chars.
- If nothing is worth recording, return empty arrays and null active_focus.
`;

export function buildConsolidatorPrompt(input: ConsolidatorTurnInput): string {
  const lines: string[] = [PROMPT_HEADER];
  if (input.threadTitle) {
    lines.push(`<thread_title>${input.threadTitle.trim()}</thread_title>`);
  }
  if (input.personaSummary && input.personaSummary.trim()) {
    lines.push(`<persona>${input.personaSummary.trim().slice(0, 400)}</persona>`);
  }
  if (input.messages && input.messages.length > 0) {
    lines.push(
      `<message_window>\n${formatMessageWindow(selectPromptMessageWindow(input))}\n</message_window>`,
    );
  } else {
    if (input.sourceUserMessageId) {
      lines.push(
        `<current_user_message_id>${truncateForPrompt(input.sourceUserMessageId, 120)}</current_user_message_id>`,
      );
    }
    lines.push(`<user>\n${truncateForPrompt(input.userMessage, 4000)}\n</user>`);
    lines.push(`<assistant>\n${truncateForPrompt(input.assistantMessage, 4000)}\n</assistant>`);
  }
  return lines.join('\n\n');
}

function selectPromptMessageWindow(input: ConsolidatorTurnInput): Message[] {
  const messages = input.messages ?? [];
  if (!messages.length) return messages;
  if (!input.sourceUserMessageId && !input.sourceAssistantMessageId) return messages;

  const userIndex = input.sourceUserMessageId
    ? messages.findIndex((message) => message.id === input.sourceUserMessageId)
    : -1;
  const assistantIndex = input.sourceAssistantMessageId
    ? messages.findIndex((message) => message.id === input.sourceAssistantMessageId)
    : -1;

  if (userIndex < 0 && assistantIndex < 0) return messages;
  const startIndex = userIndex >= 0 ? userIndex : 0;
  const endIndex = assistantIndex >= 0 ? assistantIndex : messages.length - 1;
  if (startIndex > endIndex) return messages;
  return messages.slice(startIndex, endIndex + 1);
}

function formatMessageWindow(messages: Message[]): string {
  return messages
    .slice(-24)
    .map((message) => {
      const messageText = getPromptVisibleMessageContent(message);
      const content = truncateForPrompt(String(messageText), 1200);
      const toolNames = message.toolCalls?.map((toolCall) => toolCall.name).filter(Boolean);
      const toolLabel = toolNames?.length ? ` tools=${toolNames.join(',')}` : '';
      return `<message id="${message.id}" role="${message.role}"${toolLabel}>\n${content}\n</message>`;
    })
    .join('\n');
}

function getPromptVisibleMessageContent(message: Message): string {
  if (message.role === 'tool') {
    const toolNames = message.toolCalls?.map((toolCall) => toolCall.name).filter(Boolean) ?? [];
    const toolName = toolNames.join(',') || message.toolCallId || 'tool';
    const status = message.isError ? 'error' : 'completed';
    return `[tool_result name=${toolName} status=${status}]`;
  }
  if (message.role === 'user') {
    return message.enrichedContent ?? message.content ?? '';
  }
  return message.content ?? '';
}

function truncateForPrompt(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
}

interface RawConsolidatorPayload {
  episode_summary?: unknown;
  new_facts?: unknown;
  active_focus?: unknown;
  open_threads?: unknown;
  notable?: unknown;
}

export function parseConsolidatorOutput(raw: string): ConsolidatorResult {
  const fallback: ConsolidatorResult = {
    episodeSummary: null,
    newFacts: [],
    activeFocus: null,
    openThreads: [],
    notable: [],
  };
  const cleaned = stripCodeFence(raw).trim();
  if (!cleaned) return fallback;
  let parsed: RawConsolidatorPayload;
  try {
    parsed = JSON.parse(cleaned) as RawConsolidatorPayload;
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;

  return {
    episodeSummary: normalizeBoundedString(parsed.episode_summary, 1200),
    newFacts: normalizeFacts(parsed.new_facts),
    activeFocus: normalizeActiveFocus(parsed.active_focus),
    openThreads: normalizeStringArray(parsed.open_threads, 80, 5),
    notable: normalizeStringArray(parsed.notable, 200, 2),
  };
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function normalizeFacts(raw: unknown): ConsolidatorFact[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsolidatorFact[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const subject = typeof candidate.subject === 'string' ? candidate.subject.trim() : '';
    const predicate = typeof candidate.predicate === 'string' ? candidate.predicate.trim() : '';
    const value = typeof candidate.value === 'string' ? candidate.value.trim() : '';
    const objectValue = typeof candidate.object === 'string' ? candidate.object.trim() : '';
    const finalValue = value || objectValue;
    if (!subject || !predicate || !finalValue) continue;
    if (subject.length > 80 || predicate.length > 80 || finalValue.length > 200) continue;
    const confidenceRaw =
      typeof candidate.confidence === 'string' ? candidate.confidence.trim().toLowerCase() : '';
    const numericConfidence =
      typeof candidate.confidence === 'number' ? clamp01(candidate.confidence) : undefined;
    const confidence: ConsolidatorFact['confidence'] =
      numericConfidence ??
      (confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? (confidenceRaw as ConsolidatorFact['confidence'])
        : undefined);
    const scope = parseFactScope(candidate.scope);
    const importance =
      typeof candidate.importance === 'number' ? clamp01(candidate.importance) : undefined;
    const evidenceMessageIds = Array.isArray(candidate.evidence_message_ids)
      ? candidate.evidence_message_ids
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
          .slice(0, 8)
      : undefined;
    const reason = normalizeBoundedString(candidate.reason, 240) ?? undefined;
    const operation = parseFactOperation(candidate.operation);
    const assertionClass = parseAssertionClass(
      candidate.assertion_class ?? candidate.assertionClass,
    );
    const evidenceQuote =
      normalizeBoundedString(candidate.evidence_quote ?? candidate.evidenceQuote, 600) ?? undefined;
    out.push({
      subject,
      predicate,
      value: finalValue,
      ...(scope ? { scope } : {}),
      ...(typeof importance === 'number' ? { importance } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(evidenceMessageIds?.length ? { evidenceMessageIds } : {}),
      ...(reason ? { reason } : {}),
      ...(operation ? { operation } : {}),
      ...(assertionClass ? { assertionClass } : {}),
      ...(evidenceQuote ? { evidenceQuote } : {}),
    });
  }
  return out;
}

function parseFactOperation(raw: unknown): ConsolidatorFactOperation | undefined {
  return raw === 'insert' || raw === 'replace_current' ? raw : undefined;
}

function parseAssertionClass(raw: unknown): ConsolidatorAssertionClass | undefined {
  return raw === 'current_direct' ||
    raw === 'historical' ||
    raw === 'hypothetical' ||
    raw === 'quoted' ||
    raw === 'third_party' ||
    raw === 'uncertain'
    ? raw
    : undefined;
}

function parseFactScope(raw: unknown): MemoryFactScope | undefined {
  return raw === 'global' ||
    raw === 'project' ||
    raw === 'conversation' ||
    raw === 'session' ||
    raw === 'persona'
    ? raw
    : undefined;
}

function normalizeBoundedString(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 3).trimEnd()}...` : trimmed;
}

function normalizeActiveFocus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.length > 600 ? `${trimmed.slice(0, 599).trimEnd()}\u2026` : trimmed;
}

function normalizeStringArray(raw: unknown, maxLen: number, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.push(trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1).trimEnd()}\u2026` : trimmed);
  }
  return out;
}

function confidenceToScore(confidence: ConsolidatorFact['confidence']): number {
  if (typeof confidence === 'number') return clamp01(confidence);
  if (confidence === 'high') return 0.9;
  if (confidence === 'low') return 0.45;
  return 0.7; // medium / unknown
}

/**
 * Persist a parsed consolidator result to the memory store.
 * Returns the IDs of newly recorded facts (skipping duplicates) and a flag
 * for whether the active_focus block was updated.
 */
export function applyConsolidatorResult(
  result: ConsolidatorResult,
  options: {
    now?: number;
    conversationId?: string;
    threadId?: string;
    taskId?: string;
    sourceRunId?: string;
    threadTitle?: string;
    sourceUserMessageId?: string;
    sourceAssistantMessageId?: string;
    messages?: Message[];
    skipWorkingMemoryWrites?: boolean;
  } = {},
): {
  recordedFactIds: string[];
  invalidatedFactIds: string[];
  activeFocusUpdated: boolean;
  openThreadsUpdated: boolean;
  episodeId: string | null;
} {
  ensureFactSchema();
  ensureDefaultBlocks();
  const now = options.now ?? Date.now();

  const messageIds = (options.messages ?? [])
    .map((message) => message.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const toolNames = (options.messages ?? [])
    .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.name) ?? [])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  const timestamps = (options.messages ?? [])
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  const episodeSummary = result.episodeSummary ?? null;
  const episode = episodeSummary
    ? recordEpisode({
        conversationId: options.conversationId,
        threadId: options.threadId ?? options.conversationId,
        taskId: options.taskId,
        startedAt: timestamps.length ? Math.min(...timestamps) : now,
        endedAt: timestamps.length ? Math.max(...timestamps) : now,
        summary: episodeSummary,
        messageIds,
        toolNames,
        importance: Math.max(0.5, ...result.newFacts.map((fact) => fact.importance ?? 0.5)),
        now,
      })
    : null;

  const recordedFactIds: string[] = [];
  const invalidatedFactIds: string[] = [];
  for (const fact of result.newFacts) {
    const subjectType = fact.subject.toLowerCase() === 'user' ? 'self' : 'concept';
    const subject = upsertEntity({ type: subjectType, name: fact.subject, now });
    const sourceMessageId =
      fact.evidenceMessageIds?.[0] ??
      options.sourceUserMessageId ??
      options.sourceAssistantMessageId ??
      null;
    const memoryWrite = fact.admittedWrite
      ? {
          operation: fact.admittedWrite.operation,
          authority: fact.admittedWrite.authority,
          evidenceMessageId: fact.admittedWrite.evidenceMessageId,
          expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId,
          assertionClass: fact.assertionClass ?? null,
          evidenceQuote: fact.evidenceQuote ?? null,
        }
      : undefined;
    const attributes = {
      ...(fact.reason ? { reason: fact.reason } : {}),
      ...(memoryWrite ? { memoryWrite } : {}),
    };
    const factInput = {
      subjectId: subject.id,
      predicate: fact.predicate,
      objectText: fact.value,
      confidence: confidenceToScore(fact.confidence),
      scope: fact.scope ?? 'conversation',
      originConversationId: options.conversationId ?? null,
      originThreadId: options.threadId ?? options.conversationId ?? null,
      originTaskId: options.taskId ?? null,
      sourceRunId: options.sourceRunId ?? null,
      sourceMessageId: fact.admittedWrite?.evidenceMessageId ?? sourceMessageId,
      sourceTurnId: options.sourceAssistantMessageId ?? options.sourceUserMessageId ?? null,
      sourceSummary: fact.reason ?? episodeSummary ?? null,
      importance: fact.importance ?? inferFactImportance(fact),
      attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      now,
    };
    const recorded = fact.admittedWrite
      ? replaceCurrentFact({
          ...factInput,
          expectedCurrentFactId: fact.admittedWrite.expectedCurrentFactId,
        })
      : recordFact({ ...factInput, supersedePrior: false });
    if (recorded.status === 'conflict') {
      logger.devWarn(`Grounded replacement rejected at persistence: ${recorded.conflict}`);
      continue;
    }
    if (recorded.status === 'created') recordedFactIds.push(recorded.fact.id);
    invalidatedFactIds.push(...recorded.superseded.map((superseded) => superseded.id));
    const evidenceIds = fact.admittedWrite
      ? [fact.admittedWrite.evidenceMessageId]
      : fact.evidenceMessageIds?.length
        ? fact.evidenceMessageIds
        : [sourceMessageId].filter((id): id is string => typeof id === 'string');
    for (const messageId of evidenceIds) {
      addFactEvidence({
        factId: recorded.fact.id,
        episodeId: episode?.id ?? null,
        messageId,
        quote: fact.evidenceQuote ?? fact.reason ?? fact.value,
        now,
      });
    }
  }

  let activeFocusUpdated = false;
  const taskId = options.taskId?.trim();
  if (!options.skipWorkingMemoryWrites && result.activeFocus !== null && !taskId) {
    try {
      const activeFocus = composeActiveFocusContent({
        threadTitle: options.threadTitle,
        activeFocus: result.activeFocus,
      });
      writeWorkingOrLegacyBlock('active_focus', activeFocus, options, now);
      activeFocusUpdated = true;
    } catch {
      // BlockOverflowError or unknown block — never throw out of the chat path.
    }
  }

  let openThreadsUpdated = false;
  if (!options.skipWorkingMemoryWrites) {
    try {
      writeWorkingOrLegacyBlock(
        'open_threads',
        fitBlockLines(result.openThreads, 800),
        options,
        now,
      );
      openThreadsUpdated = true;
    } catch {
      // BlockOverflowError or unknown block - never throw out of the chat path.
    }
  }

  return {
    recordedFactIds,
    invalidatedFactIds,
    activeFocusUpdated,
    openThreadsUpdated,
    episodeId: episode?.id ?? null,
  };
}

function writeWorkingOrLegacyBlock(
  label: 'active_focus' | 'open_threads',
  content: string,
  options: { conversationId?: string; threadId?: string; taskId?: string },
  now: number,
): void {
  if (options.conversationId || options.threadId || options.taskId) {
    editWorkingBlock(
      label,
      content,
      {
        conversationId: options.conversationId,
        threadId: options.threadId ?? options.conversationId,
        taskId: options.taskId,
      },
      { now },
    );
    return;
  }
  editBlock(label, content, { replace: true, now });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function inferFactImportance(fact: ConsolidatorFact): number {
  if (fact.scope === 'global') return 0.75;
  if (fact.scope === 'project') return 0.65;
  return 0.55;
}

function fitBlockLines(lines: string[], maxChars: number): string {
  const out: string[] = [];
  for (const line of lines) {
    const next = [...out, line].join('\n');
    if (next.length > maxChars) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * One-shot consolidation: build the prompt, call the extractor, parse, and
 * (optionally) persist. Extractor failures propagate to the async queue so
 * failed enrichment is retryable instead of being recorded as empty success.
 */
export async function consolidateTurn(
  input: ConsolidatorTurnInput,
  options: ConsolidatorOptions,
): Promise<ConsolidatorResult> {
  const persist = options.persist !== false;
  const prompt = buildConsolidatorPrompt(input);
  const raw = await options.extractor(prompt);
  const result = parseConsolidatorOutput(raw);
  if (persist) {
    applyConsolidatorResult(result, {
      now: input.now ?? options.now?.(),
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      threadTitle: input.threadTitle,
      sourceUserMessageId: input.sourceUserMessageId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      messages: input.messages,
    });
  }
  return result;
}
