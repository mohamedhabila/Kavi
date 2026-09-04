// ---------------------------------------------------------------------------
// Kavi — Provider Error Classification
// ---------------------------------------------------------------------------
// The single typed classification layer for errors raised while talking to an
// LLM provider. Failover, retry, and context-overflow-compaction decisions
// must be driven by structured signals (native error identity, HTTP status,
// provider-reported error bodies) rather than by regexing English error
// prose — a non-English or reworded provider message must not silently
// disable recovery. Prose matching is kept only as a last-resort fallback
// tier, and every fallback is recorded (`classifiedBy: 'prose_fallback'`) and
// logged so telemetry can see how often structured classification is missing
// coverage.
//
// Classification order:
//   1. Native error identity (AbortError/DOMException, Node error codes,
//      TypeError-without-response from fetch).
//   2. Provider-reported structured error body (`error.type` / `error.code`
//      for Anthropic/OpenAI, `error.status` / `error.code` for Gemini),
//      parsed once at the transport boundary by `createProviderRequestError`.
//   3. Bare HTTP status, for statuses that are unambiguous without a body.
//   4. Prose fallback — the legacy message-pattern heuristics, used only when
//      nothing structured survived.

import { isPlainRecord, tryParseJson } from '../core/json';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('ProviderErrorClassification');

export type ProviderFamily = 'anthropic' | 'openai' | 'gemini';

export type ProviderErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'rate_limited'
  | 'auth'
  | 'permission'
  | 'context_overflow'
  | 'invalid_request'
  | 'server'
  | 'unknown';

export type ProviderErrorClassifiedBy = 'structured' | 'status' | 'prose_fallback';

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  retryable: boolean;
  failoverEligible: boolean;
  classifiedBy: ProviderErrorClassifiedBy;
  status?: number;
  providerErrorType?: string;
  providerErrorCode?: string;
}

const LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE = 'LOCAL_LLM_CONTEXT_PRESSURE';

// ---------------------------------------------------------------------------
// Structured provider request error — attached at the transport boundary so
// classification never has to reparse a response body it already read once.
// ---------------------------------------------------------------------------

export class ProviderRequestError extends Error {
  readonly status?: number;
  readonly providerFamily?: ProviderFamily;
  readonly providerErrorType?: string;
  readonly providerErrorCode?: string;
  readonly rawBody?: string;

  constructor(
    message: string,
    params: {
      status?: number;
      providerFamily?: ProviderFamily;
      providerErrorType?: string;
      providerErrorCode?: string;
      rawBody?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = params.status;
    this.providerFamily = params.providerFamily;
    this.providerErrorType = params.providerErrorType;
    this.providerErrorCode = params.providerErrorCode;
    this.rawBody = params.rawBody;
  }
}

interface StructuredProviderFields {
  providerErrorType?: string;
  providerErrorCode?: string;
}

/**
 * Parses a provider's JSON error body once, at the fetch boundary.
 * - Anthropic: `{ type: 'error', error: { type, message } }`
 * - OpenAI:    `{ error: { type, code, message } }`
 * - Gemini:    `{ error: { code, status, message } }`
 */
function parseProviderErrorBody(
  providerFamily: ProviderFamily,
  bodyText: string,
): StructuredProviderFields {
  const parsed = tryParseJson(bodyText);
  if (!isPlainRecord(parsed)) {
    return {};
  }
  const errorNode = isPlainRecord(parsed.error) ? parsed.error : undefined;
  if (!errorNode) {
    return {};
  }

  if (providerFamily === 'gemini') {
    const status = typeof errorNode.status === 'string' ? errorNode.status : undefined;
    const code =
      typeof errorNode.code === 'number' || typeof errorNode.code === 'string'
        ? String(errorNode.code)
        : undefined;
    return { providerErrorType: status, providerErrorCode: code };
  }

  // Anthropic and OpenAI both nest `{ type, code? }` under `error`.
  const type = typeof errorNode.type === 'string' ? errorNode.type : undefined;
  const code = typeof errorNode.code === 'string' ? errorNode.code : undefined;
  return { providerErrorType: type, providerErrorCode: code };
}

export function createProviderRequestError(params: {
  providerFamily: ProviderFamily;
  status: number;
  bodyText: string;
}): ProviderRequestError {
  const fields = parseProviderErrorBody(params.providerFamily, params.bodyText);
  return new ProviderRequestError(`LLM API error ${params.status}: ${params.bodyText}`, {
    status: params.status,
    providerFamily: params.providerFamily,
    providerErrorType: fields.providerErrorType,
    providerErrorCode: fields.providerErrorCode,
    rawBody: params.bodyText,
  });
}

// ---------------------------------------------------------------------------
// Tier 1 — native error identity
// ---------------------------------------------------------------------------

const NATIVE_NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNABORTED',
]);
const NATIVE_TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);

/**
 * Classifies transport-level failures from their runtime identity — never
 * from message text. Exported for reuse by other transport call sites (e.g.
 * the web tool fetch retry loop) that need the same structural signal
 * without the full provider-error vocabulary.
 */
export function classifyNativeTransportErrorIdentity(
  error: unknown,
): 'network' | 'timeout' | 'aborted' | undefined {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    if (error.name === 'AbortError' || error.code === DOMException.ABORT_ERR) {
      return 'aborted';
    }
    if (error.name === 'TimeoutError') {
      return 'timeout';
    }
  }

  if (!(error instanceof Error)) {
    return undefined;
  }

  if (error.name === 'AbortError') {
    return 'aborted';
  }
  if (error.name === 'TimeoutError') {
    return 'timeout';
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string') {
    if (NATIVE_TIMEOUT_ERROR_CODES.has(code)) return 'timeout';
    if (NATIVE_NETWORK_ERROR_CODES.has(code)) return 'network';
  }

  // React Native / undici / browser fetch implementations throw a bare
  // TypeError whenever the request never reaches a server (DNS failure, no
  // connectivity, a blocked preflight, ...) — no response, no status, and
  // (unlike Node) usually no `.code` either. This is a structural guarantee
  // of the fetch contract, not a localized string, so it is a safe identity
  // signal rather than a prose match.
  if (error instanceof TypeError) {
    return 'network';
  }

  return undefined;
}

function isTypedLocalContextPressureError(error: unknown): boolean {
  return readStringProp(error, 'code') === LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE;
}

// ---------------------------------------------------------------------------
// Tier 2 — structured provider error body
// ---------------------------------------------------------------------------

const CONTEXT_OVERFLOW_PROSE_PATTERNS = [
  /context[_\s-]?window(?:\s+limit)?/i,
  /context[_\s-]?length(?:[_\s-]?exceeded)?/i,
  /context[_\s-]?limit/i,
  /model_context_window_exceeded/i,
  /context_window_exceeded/i,
  /maximum context length/i,
  /prompt(?:\s+is|\s+was)?\s+too\s+(?:long|large)/i,
  /request(?:\s+is|\s+was)?\s+too\s+(?:long|large)/i,
  /input(?:\s+is|\s+was)?\s+too\s+long/i,
  /too many(?:\s+input)?\s+tokens/i,
  /max(?:imum)?\s+input\s+tokens/i,
  /input(?:\s+length|\s+size)?[^\n]*exceed/i,
  /prompt(?:\s+length|\s+size)?[^\n]*exceed/i,
  /input and max_tokens[^\n]*exceed/i,
  /prompt and max_tokens[^\n]*exceed/i,
  /exceed(?:ed|s)?[^\n]*(?:token|context)\s+(?:window|limit)/i,
  /request_too_large/i,
  /input_too_long/i,
];

function matchesContextOverflowProse(message: string): boolean {
  return CONTEXT_OVERFLOW_PROSE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Resolves a kind from a provider's structured error body. Anthropic's
 * `invalid_request_error` and Gemini's `INVALID_ARGUMENT` are the two cases
 * where the provider does not expose a dedicated context-overflow code —
 * for those we narrow with the same context-overflow prose used by the
 * fallback tier, which is a deliberate, documented exception (the type still
 * does the real narrowing; the message only distinguishes which flavor of
 * "invalid request" this is), not an unstructured guess.
 */
function classifyStructuredProviderKind(
  providerFamily: ProviderFamily | undefined,
  fields: StructuredProviderFields,
  message: string,
): ProviderErrorKind | undefined {
  const { providerErrorType: type, providerErrorCode: code } = fields;

  // OpenAI's dedicated context-window code is unambiguous on its own.
  if (code === 'context_length_exceeded') {
    return 'context_overflow';
  }

  if (providerFamily === 'gemini') {
    switch (type) {
      case 'RESOURCE_EXHAUSTED':
        return 'rate_limited';
      case 'INVALID_ARGUMENT':
        return matchesContextOverflowProse(message) ? 'context_overflow' : 'invalid_request';
      case 'PERMISSION_DENIED':
        return 'permission';
      case 'UNAUTHENTICATED':
        return 'auth';
      case 'NOT_FOUND':
        return 'invalid_request';
      case 'UNAVAILABLE':
      case 'INTERNAL':
        return 'server';
      default:
        return undefined;
    }
  }

  // Anthropic and OpenAI both nest `{ type }` under `error` with a shared
  // vocabulary (Anthropic: invalid_request_error, authentication_error,
  // permission_error, not_found_error, rate_limit_error, api_error,
  // overloaded_error).
  switch (type) {
    case 'invalid_request_error':
      return matchesContextOverflowProse(message) ? 'context_overflow' : 'invalid_request';
    case 'authentication_error':
      return 'auth';
    case 'permission_error':
      return 'permission';
    case 'not_found_error':
      return 'invalid_request';
    case 'rate_limit_error':
      return 'rate_limited';
    case 'overloaded_error':
    case 'api_error':
      return 'server';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — bare HTTP status
// ---------------------------------------------------------------------------

/**
 * 400/422 are deliberately excluded: providers reuse those statuses for both
 * malformed requests and (absent a dedicated code) context-window overflows,
 * so they always need prose corroboration and are resolved in the fallback
 * tier instead. Every other recognized status is unambiguous.
 */
function classifyFromStatus(status: number): ProviderErrorKind | undefined {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'invalid_request';
  if (status === 408) return 'timeout';
  if (status === 425 || status === 429) return 'rate_limited';
  if (status === 409 || status >= 500) return 'server';
  return undefined;
}

// ---------------------------------------------------------------------------
// Tier 4 — prose fallback
// ---------------------------------------------------------------------------

const DETERMINISTIC_REQUEST_PROSE_PATTERNS = [
  /schema\s+too\s+complex/i,
  /tool_result/i,
  /tool_use/i,
];
const TIMEOUT_PROSE_RE = /timeout|timed out/i;
const NETWORK_PROSE_RE =
  /network request failed|failed to fetch|fetch failed|econn|enotfound|software caused connection abort|connection (?:aborted|reset|closed|lost)|socket hang up|broken pipe|network connection (?:was )?lost/i;
const LEGACY_STATUS_FROM_MESSAGE_RE = /LLM API error\s+(\d{3})/i;

function classifyFromProse(message: string, status: number | undefined): ProviderErrorKind {
  if (
    (status === undefined || status === 400 || status === 413 || status === 422) &&
    matchesContextOverflowProse(message)
  ) {
    return 'context_overflow';
  }

  // A status resolved from the message itself already tells us this wasn't a
  // transport-level failure — only check network/timeout prose when no
  // status was ever present.
  if (status === undefined) {
    if (TIMEOUT_PROSE_RE.test(message)) return 'timeout';
    if (NETWORK_PROSE_RE.test(message)) return 'network';
  }

  if (
    (status === undefined || status === 400 || status === 422) &&
    DETERMINISTIC_REQUEST_PROSE_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return 'invalid_request';
  }

  return 'unknown';
}

const MAX_LOGGED_MESSAGE_LENGTH = 200;

function truncateForLog(message: string): string {
  return message.length > MAX_LOGGED_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_LOGGED_MESSAGE_LENGTH)}…`
    : message;
}

/** Shared telemetry hook for every call site that still has to fall back to prose matching. */
export function logProseFallbackClassification(
  scope: string,
  error: unknown,
  resolvedKind?: string,
): void {
  const message = getErrorMessage(error);
  logger.warn(
    `[${scope}] structured classification found no status or provider-typed error — falling back to message-prose matching`,
    { resolvedKind, message: truncateForLog(message) },
  );
}

// ---------------------------------------------------------------------------
// Shared extraction helpers (duck-typed — work on ProviderRequestError
// instances and on plain error-shaped objects used by tests/local adapters)
// ---------------------------------------------------------------------------

function readNumericProp(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return undefined;
}

function readStringProp(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : undefined;
}

function extractDeclaredStatus(error: unknown): number | undefined {
  return readNumericProp(error, 'status') ?? readNumericProp(error, 'statusCode');
}

function extractDeclaredProviderFamily(error: unknown): ProviderFamily | undefined {
  const family = readStringProp(error, 'providerFamily');
  return family === 'anthropic' || family === 'openai' || family === 'gemini'
    ? family
    : undefined;
}

function extractLegacyStatusFromMessage(message: string): number | undefined {
  const match = message.match(LEGACY_STATUS_FROM_MESSAGE_RE);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || '';
  if (typeof error === 'string') return error;
  return error === undefined || error === null ? '' : String(error);
}

// ---------------------------------------------------------------------------
// Public classifier
// ---------------------------------------------------------------------------

// 'unknown' is deliberately retryable: an error we could not classify at all
// (no status, no provider type, no matching prose) is not proven to be a
// permanent request problem, so the legacy default is to permit a retry —
// only a positively-identified `invalid_request`/`auth`/`permission` blocks
// one.
const RETRYABLE_KINDS = new Set<ProviderErrorKind>([
  'network',
  'timeout',
  'aborted',
  'rate_limited',
  'server',
  'context_overflow',
  'unknown',
]);

const FAILOVER_ELIGIBLE_KINDS = new Set<ProviderErrorKind>([
  'network',
  'timeout',
  'rate_limited',
  'server',
]);

function finalizeClassification(
  kind: ProviderErrorKind,
  classifiedBy: ProviderErrorClassifiedBy,
  fields: { status?: number; providerErrorType?: string; providerErrorCode?: string },
): ProviderErrorClassification {
  return {
    kind,
    classifiedBy,
    retryable: RETRYABLE_KINDS.has(kind),
    failoverEligible: FAILOVER_ELIGIBLE_KINDS.has(kind),
    status: fields.status,
    providerErrorType: fields.providerErrorType,
    providerErrorCode: fields.providerErrorCode,
  };
}

export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const nativeKind = classifyNativeTransportErrorIdentity(error);
  if (nativeKind) {
    return finalizeClassification(nativeKind, 'structured', {
      status: extractDeclaredStatus(error),
      providerErrorType: readStringProp(error, 'providerErrorType'),
      providerErrorCode: readStringProp(error, 'providerErrorCode'),
    });
  }

  if (isTypedLocalContextPressureError(error)) {
    return finalizeClassification('context_overflow', 'structured', {
      status: extractDeclaredStatus(error),
      providerErrorCode: LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE,
    });
  }

  const status = extractDeclaredStatus(error);
  const providerFamily = extractDeclaredProviderFamily(error);
  const providerErrorType = readStringProp(error, 'providerErrorType');
  const providerErrorCode = readStringProp(error, 'providerErrorCode');
  const message = getErrorMessage(error);

  if (providerErrorType || providerErrorCode) {
    const structuredKind = classifyStructuredProviderKind(
      providerFamily,
      { providerErrorType, providerErrorCode },
      message,
    );
    if (structuredKind) {
      return finalizeClassification(structuredKind, 'structured', {
        status,
        providerErrorType,
        providerErrorCode,
      });
    }
  }

  // No structured field was attached — recover a status from the adapters'
  // own "LLM API error NNN: ..." message convention when the declared field
  // is absent (e.g. hand-built errors from older call sites or tests). That
  // prefix is written by our code, not the provider, so the number it
  // carries is exactly as reliable as a declared `status` field regardless
  // of what language the rest of the message is in — it is still tier 3,
  // not a prose guess.
  const resolvedStatus = status ?? extractLegacyStatusFromMessage(message);
  if (resolvedStatus !== undefined && resolvedStatus !== 400 && resolvedStatus !== 422) {
    const statusKind = classifyFromStatus(resolvedStatus);
    if (statusKind) {
      return finalizeClassification(statusKind, 'status', {
        status: resolvedStatus,
        providerErrorType,
        providerErrorCode,
      });
    }
  }

  // Nothing structured or status-shaped survived — fall back to matching
  // English prose patterns against the raw message.
  const fallbackKind = classifyFromProse(message, resolvedStatus);
  logProseFallbackClassification('providerErrorClassification.classifyProviderError', error, fallbackKind);
  return finalizeClassification(fallbackKind, 'prose_fallback', {
    status: resolvedStatus,
    providerErrorType,
    providerErrorCode,
  });
}
