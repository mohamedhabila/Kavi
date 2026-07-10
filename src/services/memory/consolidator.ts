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
//   • Parse and provider failures are explicit outcomes. Callers decide whether
//     to retry or degrade; malformed output is never treated as empty memory.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { MemoryFactScope } from './facts/types';
import type { SealedFactApplicabilityProvenance } from './facts/applicabilityProvenance';
import { applyConsolidatorResult } from './consolidation/persistence';
export {
  applyConsolidatorResult,
  applyThreadLocalConsolidatorResult,
} from './consolidation/persistence';
export type {
  ApplyConsolidatorResultOptions,
  ApplyConsolidatorResultResult,
} from './consolidation/persistence';

export interface ConsolidatorPromptInput {
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
  sourceUserMessageId?: string;
  sourceAssistantMessageId?: string;
  /** All user/assistant/tool messages since the previous consolidation cursor. */
  messages?: Message[];
}

export interface ConsolidatorTurnInput extends ConsolidatorPromptInput {
  /** Required provenance for every persisted or provider-enriched turn. */
  conversationId: string;
  threadId: string;
  taskId?: string;
  sourceRunId?: string;
  episodeAccess?: {
    personaId: string;
    shareability: import('./episodes/accessPolicyTypes').EpisodeShareability;
  };
}

export type ConsolidatorFactOperation = 'insert' | 'replace_current';

export type ConsolidatorAssertionClass =
  | 'current_direct'
  | 'historical'
  | 'hypothetical'
  | 'quoted'
  | 'third_party'
  | 'uncertain';

interface AdmittedFactWriteBase {
  authority: 'grounded_user_statement';
  evidenceMessageId: string;
}

export type AdmittedFactWrite =
  | (AdmittedFactWriteBase & { operation: 'insert' })
  | (AdmittedFactWriteBase & {
      operation: 'replace_current';
      expectedCurrentFactId: string;
    });

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
  /** Internal applicability provenance created only by deterministic product code. */
  sealedApplicability?: SealedFactApplicabilityProvenance;
  /** Provider confidence score in the canonical 0..1 range. */
  confidence?: number;
}

export interface ConsolidatorResult {
  episodeSummary: string | null;
  newFacts: ConsolidatorFact[];
  activeFocus: string | null;
  openThreads: string[];
  notable: string[];
}

export type ConsolidatorMalformedCode = 'empty_response' | 'invalid_json' | 'non_object';

export type ConsolidatorSchemaInvalidCode =
  | 'missing_required_field'
  | 'unexpected_field'
  | 'invalid_field_type'
  | 'invalid_field_value'
  | 'limit_exceeded';

export type ConsolidatorProviderErrorCode =
  | 'provider_request_failed'
  | 'unsupported_response_shape';

export type ConsolidatorOutcome =
  | {
      status: 'valid';
      result: ConsolidatorResult;
    }
  | {
      status: 'empty_valid';
      result: ConsolidatorResult;
    }
  | {
      status: 'malformed';
      code: ConsolidatorMalformedCode;
    }
  | {
      status: 'schema_invalid';
      code: ConsolidatorSchemaInvalidCode;
    }
  | {
      status: 'provider_error';
      code: ConsolidatorProviderErrorCode;
    };

export class UnsupportedConsolidatorResponseError extends Error {
  constructor() {
    super('Unsupported consolidation provider response shape');
    this.name = 'UnsupportedConsolidatorResponseError';
  }
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
- Every top-level field shown above is required and must use its exact
  snake_case name. Do not add fields outside the schema.
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

export function buildConsolidatorPrompt(input: ConsolidatorPromptInput): string {
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

function selectPromptMessageWindow(input: ConsolidatorPromptInput): Message[] {
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

const TOP_LEVEL_FIELDS = new Set([
  'episode_summary',
  'new_facts',
  'active_focus',
  'open_threads',
  'notable',
]);

const FACT_FIELDS = new Set([
  'subject',
  'predicate',
  'value',
  'scope',
  'importance',
  'confidence',
  'evidence_message_ids',
  'operation',
  'assertion_class',
  'evidence_quote',
  'reason',
]);

const REQUIRED_TOP_LEVEL_FIELDS = [...TOP_LEVEL_FIELDS];
const REQUIRED_FACT_FIELDS = ['subject', 'predicate', 'value'];

type SchemaValidation<T> =
  | { valid: true; value: T }
  | { valid: false; code: ConsolidatorSchemaInvalidCode };

export function parseConsolidatorOutput(raw: string): ConsolidatorOutcome {
  const cleaned = raw.trim();
  if (!cleaned) return { status: 'malformed', code: 'empty_response' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { status: 'malformed', code: 'invalid_json' };
  }
  if (!isPlainRecord(parsed)) return { status: 'malformed', code: 'non_object' };

  const validated = validatePayload(parsed);
  if (!validated.valid) return { status: 'schema_invalid', code: validated.code };

  return {
    status: isEmptyConsolidatorResult(validated.value) ? 'empty_valid' : 'valid',
    result: validated.value,
  };
}

function validatePayload(payload: Record<string, unknown>): SchemaValidation<ConsolidatorResult> {
  if (Object.keys(payload).some((field) => !TOP_LEVEL_FIELDS.has(field))) {
    return schemaInvalid('unexpected_field');
  }
  if (REQUIRED_TOP_LEVEL_FIELDS.some((field) => !hasOwn(payload, field))) {
    return schemaInvalid('missing_required_field');
  }

  const episodeSummary = validateNullableString(payload.episode_summary, 1200);
  if (!episodeSummary.valid) return episodeSummary;
  const activeFocus = validateNullableString(payload.active_focus, 600);
  if (!activeFocus.valid) return activeFocus;
  const openThreads = validateStringArray(payload.open_threads, 80, 5);
  if (!openThreads.valid) return openThreads;
  const notable = validateStringArray(payload.notable, 200, 2);
  if (!notable.valid) return notable;
  const newFacts = validateFacts(payload.new_facts);
  if (!newFacts.valid) return newFacts;

  return {
    valid: true,
    value: {
      episodeSummary: episodeSummary.value,
      newFacts: newFacts.value,
      activeFocus: activeFocus.value,
      openThreads: openThreads.value,
      notable: notable.value,
    },
  };
}

function validateFacts(raw: unknown): SchemaValidation<ConsolidatorFact[]> {
  if (!Array.isArray(raw)) return schemaInvalid('invalid_field_type');
  if (raw.length > 5) return schemaInvalid('limit_exceeded');

  const facts: ConsolidatorFact[] = [];
  for (const item of raw) {
    if (!isPlainRecord(item)) return schemaInvalid('invalid_field_type');
    if (Object.keys(item).some((field) => !FACT_FIELDS.has(field))) {
      return schemaInvalid('unexpected_field');
    }
    if (REQUIRED_FACT_FIELDS.some((field) => !hasOwn(item, field))) {
      return schemaInvalid('missing_required_field');
    }

    const subject = validateRequiredString(item.subject, 80);
    if (!subject.valid) return subject;
    const predicate = validateRequiredString(item.predicate, 80);
    if (!predicate.valid) return predicate;
    const value = validateRequiredString(item.value, 200);
    if (!value.valid) return value;

    const fact: ConsolidatorFact = {
      subject: subject.value,
      predicate: predicate.value,
      value: value.value,
    };

    if (hasOwn(item, 'scope')) {
      const scope = parseFactScope(item.scope);
      if (!scope) return schemaInvalid('invalid_field_value');
      fact.scope = scope;
    }
    if (hasOwn(item, 'importance')) {
      if (!isUnitNumber(item.importance)) return schemaInvalid('invalid_field_value');
      fact.importance = item.importance;
    }
    if (hasOwn(item, 'confidence')) {
      if (!isUnitNumber(item.confidence)) return schemaInvalid('invalid_field_value');
      fact.confidence = item.confidence;
    }
    if (hasOwn(item, 'evidence_message_ids')) {
      const evidence = validateStringArray(item.evidence_message_ids, 120, 8);
      if (!evidence.valid) return evidence;
      fact.evidenceMessageIds = evidence.value;
    }
    if (hasOwn(item, 'reason')) {
      const reason = validateRequiredString(item.reason, 240);
      if (!reason.valid) return reason;
      fact.reason = reason.value;
    }
    if (hasOwn(item, 'operation')) {
      const operation = parseFactOperation(item.operation);
      if (!operation) return schemaInvalid('invalid_field_value');
      fact.operation = operation;
    }
    if (hasOwn(item, 'assertion_class')) {
      const assertionClass = parseAssertionClass(item.assertion_class);
      if (!assertionClass) return schemaInvalid('invalid_field_value');
      fact.assertionClass = assertionClass;
    }
    if (hasOwn(item, 'evidence_quote')) {
      const evidenceQuote = validateRequiredString(item.evidence_quote, 600);
      if (!evidenceQuote.valid) return evidenceQuote;
      fact.evidenceQuote = evidenceQuote.value;
    }

    facts.push(fact);
  }
  return { valid: true, value: facts };
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
  return raw === 'global' || raw === 'project' || raw === 'conversation' || raw === 'session'
    ? raw
    : undefined;
}

function validateNullableString(raw: unknown, maxLen: number): SchemaValidation<string | null> {
  if (raw === null) return { valid: true, value: null };
  return validateRequiredString(raw, maxLen);
}

function validateRequiredString(raw: unknown, maxLen: number): SchemaValidation<string> {
  if (typeof raw !== 'string') return schemaInvalid('invalid_field_type');
  const trimmed = raw.trim();
  if (!trimmed) return schemaInvalid('invalid_field_value');
  if (trimmed.length > maxLen) return schemaInvalid('limit_exceeded');
  return { valid: true, value: trimmed };
}

function validateStringArray(
  raw: unknown,
  maxLen: number,
  maxItems: number,
): SchemaValidation<string[]> {
  if (!Array.isArray(raw)) return schemaInvalid('invalid_field_type');
  if (raw.length > maxItems) return schemaInvalid('limit_exceeded');
  const values: string[] = [];
  for (const item of raw) {
    const value = validateRequiredString(item, maxLen);
    if (!value.valid) return value;
    values.push(value.value);
  }
  return { valid: true, value: values };
}

function schemaInvalid<T>(code: ConsolidatorSchemaInvalidCode): SchemaValidation<T> {
  return { valid: false, code };
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isEmptyConsolidatorResult(result: ConsolidatorResult): boolean {
  return (
    result.episodeSummary === null &&
    result.newFacts.length === 0 &&
    result.activeFocus === null &&
    result.openThreads.length === 0 &&
    result.notable.length === 0
  );
}

/**
 * One-shot consolidation: build the prompt, call the extractor, parse, and
 * (optionally) persist. Provider and parse failures become explicit outcomes
 * so async callers can retry without recording malformed output as success.
 */
export async function consolidateTurn(
  input: ConsolidatorTurnInput,
  options: ConsolidatorOptions,
): Promise<ConsolidatorOutcome> {
  const persist = options.persist !== false;
  const prompt = buildConsolidatorPrompt(input);
  let raw: string;
  try {
    raw = await options.extractor(prompt);
  } catch (error) {
    return {
      status: 'provider_error',
      code:
        error instanceof UnsupportedConsolidatorResponseError
          ? 'unsupported_response_shape'
          : 'provider_request_failed',
    };
  }
  const outcome = parseConsolidatorOutput(raw);
  if (persist && (outcome.status === 'valid' || outcome.status === 'empty_valid')) {
    if (!input.episodeAccess) throw new Error('episode_access_policy_required');
    applyConsolidatorResult(outcome.result, {
      now: input.now ?? options.now?.(),
      conversationId: input.conversationId,
      threadId: input.threadId,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      threadTitle: input.threadTitle,
      sourceUserMessageId: input.sourceUserMessageId,
      sourceAssistantMessageId: input.sourceAssistantMessageId,
      messages: input.messages,
      episodeAccess: input.episodeAccess,
    });
  }
  return outcome;
}
