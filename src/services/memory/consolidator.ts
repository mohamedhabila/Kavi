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

import { recordFact } from './facts';
import { upsertEntity } from './entities';
import { editBlock, ensureDefaultBlocks } from './blocks';
import { ensureFactSchema } from './schema';

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
}

export interface ConsolidatorFact {
  subject: string;
  predicate: string;
  value: string;
  /** Plain-language confidence label from the model: "high" | "medium" | "low". */
  confidence?: 'high' | 'medium' | 'low';
}

export interface ConsolidatorResult {
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
      "confidence": "high" | "medium" | "low"
    }
  ],
  "active_focus": "1-3 sentence rolling summary of what the user is working on, or null",
  "open_threads": ["short label of an unresolved follow-up", ...],
  "notable": ["a line worth surfacing in the next turn's focus header", ...]
}

Rules:
- Skip ephemeral chit-chat. Do not extract greetings, jokes, or filler.
- new_facts: only durable assertions. Reject opinions stated as facts.
- Up to 5 new_facts, 5 open_threads, 2 notable.
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
  lines.push(`<user>\n${truncateForPrompt(input.userMessage, 4000)}\n</user>`);
  lines.push(`<assistant>\n${truncateForPrompt(input.assistantMessage, 4000)}\n</assistant>`);
  return lines.join('\n\n');
}

function truncateForPrompt(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}\u2026`;
}

interface RawConsolidatorPayload {
  new_facts?: unknown;
  active_focus?: unknown;
  open_threads?: unknown;
  notable?: unknown;
}

export function parseConsolidatorOutput(raw: string): ConsolidatorResult {
  const fallback: ConsolidatorResult = {
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
    if (!subject || !predicate || !value) continue;
    if (subject.length > 80 || predicate.length > 80 || value.length > 200) continue;
    const confidenceRaw = typeof candidate.confidence === 'string'
      ? candidate.confidence.trim().toLowerCase()
      : '';
    const confidence: ConsolidatorFact['confidence'] =
      confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? (confidenceRaw as ConsolidatorFact['confidence'])
        : undefined;
    out.push({ subject, predicate, value, ...(confidence ? { confidence } : {}) });
  }
  return out;
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
  options: { now?: number } = {},
): { recordedFactIds: string[]; activeFocusUpdated: boolean } {
  ensureFactSchema();
  ensureDefaultBlocks();
  const now = options.now ?? Date.now();

  const recordedFactIds: string[] = [];
  for (const fact of result.newFacts) {
    const subjectType = fact.subject.toLowerCase() === 'user' ? 'self' : 'concept';
    const subject = upsertEntity({ type: subjectType, name: fact.subject, now });
    const recorded = recordFact({
      subjectId: subject.id,
      predicate: fact.predicate,
      objectText: fact.value,
      confidence: confidenceToScore(fact.confidence),
      now,
    });
    if (recorded.status === 'created') recordedFactIds.push(recorded.fact.id);
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

  return { recordedFactIds, activeFocusUpdated };
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
    return { newFacts: [], activeFocus: null, openThreads: [], notable: [] };
  }
  const result = parseConsolidatorOutput(raw);
  if (persist) {
    applyConsolidatorResult(result, { now: input.now ?? options.now?.() });
  }
  return result;
}
