// ---------------------------------------------------------------------------
// Kavi — Memory consolidator
// ---------------------------------------------------------------------------
// After every closed assistant turn we run a single-pass ADD-only extractor
// against the just-finished turn. The extractor returns:
//   • new_facts        — durable assertions to record into the bi-temporal
//                        fact store (entity registry rolls up names).
//   • active_focus     — short rolling summary (≤ 600 chars).
//   • open_threads     — short labels for unresolved follow-ups.
//   • notable          — one-shot lines for the next turn's `<focus>` block.
//
// Design rules (see _research/SINGLE_THREAD_MEMORY_REDESIGN_20260429.md §5):
//   • ADD-only: the consolidator NEVER mutates or invalidates existing facts.
//     Supersession happens later, on-read, when a new fact lands with the
//     same subject+predicate (handled by facts.recordFact).
//   • Idempotent: re-running on the same turn must be a no-op (we dedupe by
//     content_hash inside facts.recordFact).
//   • Provider-agnostic: the extractor is just an `(prompt) => Promise<json>`
//     callback so we can swap mocked / on-device / cloud LLMs without edits.
//   • Fail-safe: any parse / network failure yields an empty result; we never
//     pollute memory with junk and never throw out of the chat path.
// ---------------------------------------------------------------------------

import type { Message } from '../../types';
import {
  invalidateFact,
  listFacts,
  recordFact,
  type MemoryFactScope,
} from './facts';
import { upsertEntity } from './entities';
import { editBlock, ensureDefaultBlocks } from './blocks';
import { ensureFactSchema } from './schema';
import { addFactEvidence, recordEpisode } from './episodes';

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
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  /** All user/assistant/tool messages since the previous consolidation cursor. */
  messages?: Message[];
}

export interface ConsolidatorFact {
  subject: string;
  predicate: string;
  value: string;
  scope?: MemoryFactScope;
  importance?: number;
  evidenceMessageIds?: string[];
  reason?: string;
  /** Plain-language confidence label from the model: "high" | "medium" | "low". */
  confidence?: 'high' | 'medium' | 'low' | number;
}

export interface ConsolidatorInvalidation {
  factId?: string;
  subject?: string;
  predicate?: string;
  reason?: string;
}

export interface ConsolidatorResult {
  episodeSummary?: string | null;
  newFacts: ConsolidatorFact[];
  invalidatedFacts?: ConsolidatorInvalidation[];
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
Read the latest user message and the assistant reply, then extract ONLY information
that is durably useful in future conversations with this user. Be conservative:
prefer to extract nothing over guessing.

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
      "reason": "short grounding note"
    }
  ],
  "invalidated_facts": [
    { "fact_id": "existing fact id", "reason": "correction" }
  ],
  "episode_summary": "short summary of this consolidated message window, or null",
  "active_focus": "1-3 sentence rolling summary of what the user is working on, or null",
  "open_threads": ["short label of an unresolved follow-up", ...],
  "notable": ["a line worth surfacing in the next turn's focus header", ...]
}

Rules:
- Skip ephemeral chit-chat. Do not extract greetings, jokes, or filler.
- new_facts: only durable assertions. Reject opinions stated as facts.
- Up to 5 new_facts, 5 open_threads, 2 notable.
- Use global scope only for stable user profile/preferences. Use conversation
  or session for active-task details. Use project for repo/workspace facts.
- invalidated_facts only when the user explicitly corrects prior information.
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
    lines.push(`<message_window>\n${formatMessageWindow(input.messages)}\n</message_window>`);
  } else {
    lines.push(`<user>\n${truncateForPrompt(input.userMessage, 4000)}\n</user>`);
    lines.push(`<assistant>\n${truncateForPrompt(input.assistantMessage, 4000)}\n</assistant>`);
  }
  return lines.join('\n\n');
}

function formatMessageWindow(messages: Message[]): string {
  return messages
    .slice(-24)
    .map((message) => {
      const content = truncateForPrompt(String(message.content ?? ''), 1200);
      const toolNames = message.toolCalls?.map((toolCall) => toolCall.name).filter(Boolean);
      const toolLabel = toolNames?.length ? ` tools=${toolNames.join(',')}` : '';
      return `<message id="${message.id}" role="${message.role}"${toolLabel}>\n${content}\n</message>`;
    })
    .join('\n');
}

function truncateForPrompt(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
}

interface RawConsolidatorPayload {
  episode_summary?: unknown;
  new_facts?: unknown;
  invalidated_facts?: unknown;
  active_focus?: unknown;
  open_threads?: unknown;
  notable?: unknown;
}

export function parseConsolidatorOutput(raw: string): ConsolidatorResult {
  const fallback: ConsolidatorResult = {
    episodeSummary: null,
    newFacts: [],
    invalidatedFacts: [],
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
    invalidatedFacts: normalizeInvalidations(parsed.invalidated_facts),
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
    const confidenceRaw = typeof candidate.confidence === 'string'
      ? candidate.confidence.trim().toLowerCase()
      : '';
    const numericConfidence =
      typeof candidate.confidence === 'number' ? clamp01(candidate.confidence) : undefined;
    const confidence: ConsolidatorFact['confidence'] = numericConfidence ??
      (confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? (confidenceRaw as ConsolidatorFact['confidence'])
        : undefined);
    const scope = parseFactScope(candidate.scope);
    const importance = typeof candidate.importance === 'number'
      ? clamp01(candidate.importance)
      : undefined;
    const evidenceMessageIds = Array.isArray(candidate.evidence_message_ids)
      ? candidate.evidence_message_ids
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim())
          .slice(0, 8)
      : undefined;
    const reason = normalizeBoundedString(candidate.reason, 240) ?? undefined;
    out.push({
      subject,
      predicate,
      value: finalValue,
      ...(scope ? { scope } : {}),
      ...(typeof importance === 'number' ? { importance } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(evidenceMessageIds?.length ? { evidenceMessageIds } : {}),
      ...(reason ? { reason } : {}),
    });
  }
  return out;
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

function normalizeInvalidations(raw: unknown): ConsolidatorInvalidation[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsolidatorInvalidation[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const factId = normalizeBoundedString(candidate.fact_id ?? candidate.factId, 80) ?? undefined;
    const subject = normalizeBoundedString(candidate.subject, 80) ?? undefined;
    const predicate = normalizeBoundedString(candidate.predicate, 80) ?? undefined;
    const reason = normalizeBoundedString(candidate.reason, 240) ?? undefined;
    if (!factId && (!subject || !predicate)) continue;
    out.push({
      ...(factId ? { factId } : {}),
      ...(subject ? { subject } : {}),
      ...(predicate ? { predicate } : {}),
      ...(reason ? { reason } : {}),
    });
  }
  return out;
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
    sourceUserMessageId?: string;
    sourceAssistantMessageId?: string;
    messages?: Message[];
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
  const invalidations = result.invalidatedFacts ?? [];
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

  const invalidatedFactIds: string[] = [];
  for (const invalidation of invalidations) {
    if (invalidation.factId) {
      if (invalidateFact(invalidation.factId, now)) invalidatedFactIds.push(invalidation.factId);
      continue;
    }
    if (!invalidation.subject || !invalidation.predicate) continue;
    const subject = upsertEntity({
      type: invalidation.subject.toLowerCase() === 'user' ? 'self' : 'concept',
      name: invalidation.subject,
      now,
    });
    for (const fact of listFacts({
      subjectId: subject.id,
      predicate: invalidation.predicate,
      includeInvalidated: false,
      limit: 20,
    })) {
      if (invalidateFact(fact.id, now)) invalidatedFactIds.push(fact.id);
    }
  }

  const recordedFactIds: string[] = [];
  for (const fact of result.newFacts) {
    const subjectType = fact.subject.toLowerCase() === 'user' ? 'self' : 'concept';
    const subject = upsertEntity({ type: subjectType, name: fact.subject, now });
    const sourceMessageId = fact.evidenceMessageIds?.[0]
      ?? options.sourceUserMessageId
      ?? options.sourceAssistantMessageId
      ?? null;
    const recorded = recordFact({
      subjectId: subject.id,
      predicate: fact.predicate,
      objectText: fact.value,
      confidence: confidenceToScore(fact.confidence),
      scope: fact.scope ?? inferFactScope(fact),
      originConversationId: options.conversationId ?? null,
      originThreadId: options.threadId ?? options.conversationId ?? null,
      originTaskId: options.taskId ?? null,
      sourceMessageId,
      sourceTurnId: options.sourceAssistantMessageId ?? options.sourceUserMessageId ?? null,
      sourceSummary: fact.reason ?? episodeSummary ?? null,
      importance: fact.importance ?? inferFactImportance(fact),
      attributes: fact.reason ? { reason: fact.reason } : undefined,
      now,
    });
    if (recorded.status === 'created') recordedFactIds.push(recorded.fact.id);
    const evidenceIds = fact.evidenceMessageIds?.length
      ? fact.evidenceMessageIds
      : [sourceMessageId].filter((id): id is string => typeof id === 'string');
    for (const messageId of evidenceIds) {
      addFactEvidence({
        factId: recorded.fact.id,
        episodeId: episode?.id ?? null,
        messageId,
        quote: fact.reason ?? fact.value,
        now,
      });
    }
  }

  let activeFocusUpdated = false;
  if (result.activeFocus !== null) {
    try {
      editBlock('active_focus', result.activeFocus, { replace: true, now });
      activeFocusUpdated = true;
    } catch {
      // BlockOverflowError or unknown block — never throw out of the chat path.
    }
  }

  let openThreadsUpdated = false;
  if (result.openThreads.length > 0) {
    try {
      editBlock('open_threads', fitBlockLines(result.openThreads, 800), { replace: true, now });
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function inferFactScope(fact: ConsolidatorFact): MemoryFactScope {
  const subject = fact.subject.toLowerCase();
  const predicate = fact.predicate.toLowerCase();
  if (subject === 'user' && /pref|name|role|timezone|language|location|pronoun/.test(predicate)) {
    return 'global';
  }
  if (
    /project|repo|workspace|package|build|release/.test(
      `${subject} ${predicate} ${fact.value}`,
    )
  ) {
    return 'project';
  }
  return 'conversation';
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

export function applyHeuristicTurnMemory(
  input: ConsolidatorTurnInput,
  options: { now?: number } = {},
): { activeFocusUpdated: boolean; openThreadsUpdated: boolean } {
  ensureFactSchema();
  ensureDefaultBlocks();
  const now = options.now ?? input.now ?? Date.now();
  const user = truncateForPrompt(input.userMessage, 220);
  const assistant = truncateForPrompt(input.assistantMessage, 220);
  let activeFocusUpdated = false;
  let openThreadsUpdated = false;

  if (user || assistant) {
    const focus = [
      input.threadTitle ? `Thread: ${input.threadTitle.trim().slice(0, 120)}` : '',
      user ? `Latest user focus: ${user}` : '',
      assistant ? `Latest response: ${assistant}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 800);
    try {
      editBlock('active_focus', focus, { replace: true, now });
      activeFocusUpdated = true;
    } catch {
      activeFocusUpdated = false;
    }
  }

  const threadCandidates = extractOpenThreadCandidates(
    `${input.userMessage}\n${input.assistantMessage}`,
  );
  if (threadCandidates.length > 0) {
    try {
      editBlock('open_threads', fitBlockLines(threadCandidates, 800), { replace: true, now });
      openThreadsUpdated = true;
    } catch {
      openThreadsUpdated = false;
    }
  }

  return { activeFocusUpdated, openThreadsUpdated };
}

function extractOpenThreadCandidates(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) =>
      /\b(todo|next|follow up|follow-up|later|pending|remaining|need to)\b/i.test(line),
    )
    .map((line) => line.slice(0, 80))
    .slice(0, 5);
}

/**
 * One-shot consolidation: build the prompt, call the extractor, parse, and
 * (optionally) persist. Always resolves; never throws into the chat loop.
 */
export async function consolidateTurn(
  input: ConsolidatorTurnInput,
  options: ConsolidatorOptions,
): Promise<ConsolidatorResult> {
  const persist = options.persist !== false;
  const prompt = buildConsolidatorPrompt(input);
  let raw = '';
  try {
    raw = await options.extractor(prompt);
  } catch {
    return {
      episodeSummary: null,
      newFacts: [],
      invalidatedFacts: [],
      activeFocus: null,
      openThreads: [],
      notable: [],
    };
  }
  const result = parseConsolidatorOutput(raw);
  if (persist) {
    applyConsolidatorResult(result, {
      now: input.now ?? options.now?.(),
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId,
      sourceUserMessageId: input.sourceUserMessageId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      messages: input.messages,
    });
  }
  return result;
}
