const PROVIDER_REQUEST_ERROR_STATUS_RE = /LLM API error\s+(\d{3})/i;
const LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE = 'LOCAL_LLM_CONTEXT_PRESSURE';

const CONTEXT_OVERFLOW_PATTERNS = [
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

const DETERMINISTIC_REQUEST_PATTERNS = [/schema\s+too\s+complex/i, /tool_result/i, /tool_use/i];

function getProviderRequestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message || '' : String(error || '');
}

export function getProviderRequestErrorStatus(error: unknown): number | undefined {
  const message = getProviderRequestErrorMessage(error);
  const statusMatch = message.match(PROVIDER_REQUEST_ERROR_STATUS_RE);
  if (!statusMatch) {
    return undefined;
  }

  const parsed = Number(statusMatch[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isContextOverflowProviderError(error: unknown): boolean {
  if (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === LOCAL_LLM_CONTEXT_PRESSURE_ERROR_CODE
  ) {
    return true;
  }

  const status = getProviderRequestErrorStatus(error);
  if (status != null && status !== 400 && status !== 413 && status !== 422) {
    return false;
  }

  const message = getProviderRequestErrorMessage(error);
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

export function isNonRetryableProviderRequestError(error: unknown): boolean {
  if (isContextOverflowProviderError(error)) {
    return false;
  }

  const message = getProviderRequestErrorMessage(error);
  const status = getProviderRequestErrorStatus(error);
  if (status === 401 || status === 403 || status === 404) {
    return true;
  }

  if (status === 400 || status === 422) {
    return (
      /invalid_request_error/i.test(message) ||
      DETERMINISTIC_REQUEST_PATTERNS.some((pattern) => pattern.test(message))
    );
  }

  return DETERMINISTIC_REQUEST_PATTERNS.some((pattern) => pattern.test(message));
}
