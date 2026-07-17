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
//   • Extraction-only: source-bound callers own persistence and replay identity.
//   • Provider-agnostic: the extractor is just an `(prompt) => Promise<json>`
//     callback so we can swap mocked / on-device / cloud LLMs without edits.
//   • Parse and provider failures are explicit outcomes. Callers decide whether
//     to retry or degrade; malformed output is never treated as empty memory.
// ---------------------------------------------------------------------------

import type { Message } from '../../types/message';
import type { MemoryFactScope } from './facts/types';
import type { SealedFactApplicabilityProvenance } from './facts/applicabilityProvenance';
import {
  decodeSemanticFactProposals,
  type SemanticFactAssertionClass,
  type SemanticFactProposalV1,
} from './semanticFactProposal';
import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';
import type { MemorySensitivityDeclarationV1 } from './memorySensitivityPolicy';
export {
  applyConsolidatorResult,
  applyThreadLocalConsolidatorResult,
} from './consolidation/persistence';
export type {
  ApplyConsolidatorResultOptions,
  ApplyConsolidatorResultResult,
} from './consolidation/persistence';

/** Bounded durable source messages may retain only attachment presence. */
export interface ConsolidatorSourceMessage extends Message {
  hasAttachments?: true;
}

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
  messages?: ConsolidatorSourceMessage[];
}

export type ConsolidatorTurnInput = ConsolidatorPromptInput;

export type ConsolidatorFactOperation = 'insert' | 'replace_current';

export type ConsolidatorAssertionClass = SemanticFactAssertionClass;

interface AdmittedFactWriteBase {
  authority: 'grounded_user_statement' | 'verified_tool_observation';
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
  /** Typed producer floor. It can only restrict persistence and recall. */
  sensitivityDeclaration: MemorySensitivityDeclarationV1;
}

export interface ConsolidatorResult {
  episodeSummary: string | null;
  episodeSensitivityDeclaration: MemorySensitivityDeclarationV1;
  newFacts: ConsolidatorFact[];
  activeFocus: string | null;
  openThreads: string[];
  notable: string[];
}

/** Parsed provider output. Proposals remain distinct from persistable facts. */
export interface ProviderConsolidatorResult extends Omit<
  ConsolidatorResult,
  'newFacts' | 'episodeSensitivityDeclaration'
> {
  newFacts: SemanticFactProposalV1[];
  episodeSensitivity: MemoryFactSensitivity;
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
      result: ProviderConsolidatorResult;
    }
  | {
      status: 'empty_valid';
      result: ProviderConsolidatorResult;
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

export type ConsolidatorExtractor = (
  prompt: string,
  signal?: AbortSignal,
  requestDispatchGuard?: () => void,
) => Promise<string>;

export interface ConsolidatorOptions {
  extractor: ConsolidatorExtractor;
  signal?: AbortSignal;
  requestDispatchGuard?: () => void;
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
      "version": 1,
      "subject_ref": {"kind": "self"} | {"kind": "named", "label": "exact subject label"},
      "predicate": "concise stable relation label",
      "value": "exact value copied from the evidence quote",
      "scope": "global" | "project" | "conversation" | "session" | "persona",
      "importance": 0.0,
      "confidence": 0.0,
      "source_message_id": "exact id of the current user message",
      "operation": "record" | "replace_current",
      "assertion_class": "current_direct" | "historical" | "hypothetical" | "quoted" | "third_party" | "uncertain",
      "evidence_quote": "verbatim quote from the current user message",
      "sensitivity": "normal" | "personal" | "sensitive" | "restricted"
    }
  ],
  "episode_summary": "short summary of this consolidated message window, or null",
  "episode_sensitivity": "normal" | "personal" | "sensitive" | "restricted",
  "active_focus": "1-3 sentence rolling summary of what the user is working on, or null",
  "open_threads": ["short label of an unresolved follow-up", ...],
  "notable": ["a line worth surfacing in the next turn's focus header", ...]
}

Rules:
- Every top-level field shown above is required and must use its exact
  snake_case name. Do not add fields outside the schema.
- Skip ephemeral chit-chat. Do not extract greetings, jokes, or filler.
- Every field in every new_facts item is required. Do not add compatibility
  fields, aliases, inferred defaults, or provider-selected target identifiers.
- new_facts may describe only durable semantics asserted by the current user.
  Never propose facts sourced from assistant text or tool output.
- Use subject_ref kind self only when the current user is the subject. For a
  named subject, copy label exactly from evidence_quote.
- source_message_id must exactly equal the current user message id.
- evidence_quote must be an exact substring of the current user message. value
  must be an exact substring of evidence_quote.
- Use record for a newly asserted current fact. Use replace_current only when
  the current user directly states a new current value for an existing fact.
- Classify history, hypotheticals, quotations, third-party claims, and
  uncertainty accurately; product code will not admit them as current facts.
- sensitivity and episode_sensitivity are provider-declared lower bounds only;
  they never grant write authority, applicability, scope, retrieval, or recall permission.
- Classify episode_sensitivity from the complete current turn and use the most
  restrictive level warranted by any content represented in episode_summary or
  new_facts. When uncertain between two levels, choose the more restrictive one.
- Sensitivity meanings are semantic and language-independent: normal is ordinary
  non-personal content; personal is benign identity, profile, or preference data;
  sensitive is private contact, location, financial, health, legal, or government
  identity data; restricted is an authentication secret, credential, private key,
  or other value that the memory system must not persist.
- Extract explicit user memory-write intents in any language. Preserve supplied
  subject, predicate, and value labels when they are given, including opaque IDs,
  checksums, codes, and tokens. The assistant does not need to restate the fact.
- Up to 5 new_facts, 5 open_threads, 2 notable.
- Use global scope only for stable user profile/preferences. Use persona only
  for a stable fact explicitly limited to the active persona. Use conversation
  or session for active-task details. Use project for repo/workspace facts.
- value strings <= 200 chars. labels <= 80 chars. active_focus <= 600 chars.
- If nothing is worth recording, return empty arrays and null active_focus.
`;

const DIRECT_USER_PROMPT_CHARACTER_LIMIT = 4200;
const DIRECT_ASSISTANT_PROMPT_CHARACTER_LIMIT = 2200;

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
    lines.push(
      `<user>\n${truncateForPrompt(input.userMessage, DIRECT_USER_PROMPT_CHARACTER_LIMIT)}\n</user>`,
    );
    lines.push(
      `<assistant>\n${truncateForPrompt(
        input.assistantMessage,
        DIRECT_ASSISTANT_PROMPT_CHARACTER_LIMIT,
      )}\n</assistant>`,
    );
  }
  return lines.join('\n\n');
}

function selectPromptMessageWindow(input: ConsolidatorPromptInput): ConsolidatorSourceMessage[] {
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

function formatMessageWindow(messages: ConsolidatorSourceMessage[]): string {
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
  const marker = '\n\u2026\n';
  const retainedCharacters = max - marker.length;
  const leadingCharacters = Math.ceil(retainedCharacters / 2);
  const trailingCharacters = retainedCharacters - leadingCharacters;
  return `${trimmed.slice(0, leadingCharacters).trimEnd()}${marker}${trimmed
    .slice(-trailingCharacters)
    .trimStart()}`;
}

const TOP_LEVEL_FIELDS = new Set([
  'episode_summary',
  'episode_sensitivity',
  'new_facts',
  'active_focus',
  'open_threads',
  'notable',
]);

const REQUIRED_TOP_LEVEL_FIELDS = [...TOP_LEVEL_FIELDS];

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

function validatePayload(
  payload: Record<string, unknown>,
): SchemaValidation<ProviderConsolidatorResult> {
  if (Object.keys(payload).some((field) => !TOP_LEVEL_FIELDS.has(field))) {
    return schemaInvalid('unexpected_field');
  }
  if (REQUIRED_TOP_LEVEL_FIELDS.some((field) => !hasOwn(payload, field))) {
    return schemaInvalid('missing_required_field');
  }

  const episodeSummary = validateNullableString(payload.episode_summary, 1200);
  if (!episodeSummary.valid) return episodeSummary;
  const episodeSensitivity = validateSensitivity(payload.episode_sensitivity);
  if (!episodeSensitivity.valid) return episodeSensitivity;
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
      episodeSensitivity: episodeSensitivity.value,
      newFacts: newFacts.value,
      activeFocus: activeFocus.value,
      openThreads: openThreads.value,
      notable: notable.value,
    },
  };
}

function validateSensitivity(raw: unknown): SchemaValidation<MemoryFactSensitivity> {
  return raw === 'normal' || raw === 'personal' || raw === 'sensitive' || raw === 'restricted'
    ? { valid: true, value: raw }
    : schemaInvalid(typeof raw === 'string' ? 'invalid_field_value' : 'invalid_field_type');
}

function validateFacts(raw: unknown): SchemaValidation<SemanticFactProposalV1[]> {
  return decodeSemanticFactProposals(raw);
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

function isEmptyConsolidatorResult(result: ProviderConsolidatorResult): boolean {
  return (
    result.episodeSummary === null &&
    result.newFacts.length === 0 &&
    result.activeFocus === null &&
    result.openThreads.length === 0 &&
    result.notable.length === 0
  );
}

/**
 * One-shot extraction: build the prompt, call the extractor, and parse.
 * Persistence belongs to the caller's source-bound transaction so provider and
 * parse failures can be retried without recording malformed output as success.
 */
export async function consolidateTurn(
  input: ConsolidatorTurnInput,
  options: ConsolidatorOptions,
): Promise<ConsolidatorOutcome> {
  const prompt = buildConsolidatorPrompt(input);
  let raw: string;
  try {
    raw = await options.extractor(prompt, options.signal, options.requestDispatchGuard);
  } catch (error) {
    return {
      status: 'provider_error',
      code:
        error instanceof UnsupportedConsolidatorResponseError
          ? 'unsupported_response_shape'
          : 'provider_request_failed',
    };
  }
  return parseConsolidatorOutput(raw);
}
