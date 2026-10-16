// ---------------------------------------------------------------------------
// Kavi — Bland, the calling service Kavi talks through on a phone call
// ---------------------------------------------------------------------------
// No phone OS lets a third-party app speak or listen on a cellular call, so a call Kavi
// handles itself is placed in the cloud: Bland dials the number from its own pool and runs
// a voice agent with the brief Kavi gives it. API checked against docs.bland.ai on
// 2026-10-16: POST /v1/calls queues a call, GET /v1/calls/{id} reports it, POST
// /v1/calls/{id}/stop ends it. The key is the person's own, from Settings.

import { getSecure } from '../../storage/SecureStorage';

export const BLAND_API_KEY_SECRET = 'BLAND_API_KEY';

const BLAND_API_URL = 'https://api.bland.ai/v1';
/** Bland answers in well under a second; a request hanging longer than this is lost. */
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_DETAIL_CHARS = 300;

/** What went wrong, in terms Kavi can act on. */
export type BlandErrorKind =
  | 'not_configured'
  | 'auth'
  | 'billing'
  | 'rate_limited'
  | 'invalid_request'
  | 'blocked'
  | 'not_found'
  | 'provider'
  | 'network'
  | 'timeout';

export class BlandError extends Error {
  constructor(
    readonly kind: BlandErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'BlandError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The most specific message Bland's error bodies carry (their shapes differ by status). */
function errorDetail(body: unknown): string {
  if (!isRecord(body)) return '';
  const parts: string[] = [];
  if (typeof body.message === 'string') parts.push(body.message);
  if (typeof body.error === 'string') parts.push(body.error);
  if (Array.isArray(body.errors)) {
    for (const entry of body.errors) {
      if (typeof entry === 'string') parts.push(entry);
      else if (isRecord(entry) && typeof entry.message === 'string') parts.push(entry.message);
    }
  }
  if (typeof body.status === 'string' && body.status !== 'error') parts.push(body.status);
  return parts.join(' ').slice(0, MAX_ERROR_DETAIL_CHARS);
}

function errorFor(status: number, body: unknown): BlandError {
  const detail = errorDetail(body);
  const said = detail ? ` Bland said: ${detail}` : '';
  switch (status) {
    case 401:
      return new BlandError('auth', `Bland did not accept the API key.${said}`, status);
    case 402:
      return new BlandError(
        'billing',
        `The Bland account needs credit (or a billing method) to call.${said}`,
        status,
      );
    case 403:
      return new BlandError('blocked', `Bland refused the call for this account.${said}`, status);
    case 404:
      return new BlandError('not_found', `Bland has no such call.${said}`, status);
    case 429:
      return new BlandError(
        'rate_limited',
        `Bland is limiting calls right now (one call to the same number every 10 seconds, and a daily cap).${said}`,
        status,
      );
    default:
      return status >= 400 && status < 500
        ? new BlandError('invalid_request', `Bland rejected the request.${said}`, status)
        : new BlandError('provider', `Bland had a server error (${status}).${said}`, status);
  }
}

async function apiKey(): Promise<string> {
  const key = (await getSecure(BLAND_API_KEY_SECRET))?.trim();
  if (!key) {
    throw new BlandError(
      'not_configured',
      'The Bland API key is not set. Use setup_guide with topic phone_calls to set it up.',
    );
  }
  return key;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, MAX_ERROR_DETAIL_CHARS) };
  }
}

/** One request to Bland, bounded by its own timeout and by the run's abort signal. */
async function request(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const key = await apiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onRunAbort = () => controller.abort();
  signal?.addEventListener('abort', onRunAbort);
  try {
    const response = await fetchImpl(`${BLAND_API_URL}${path}`, {
      method,
      headers: { authorization: key, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const parsed = await readJson(response);
    if (!response.ok) throw errorFor(response.status, parsed);
    if (!isRecord(parsed)) {
      throw new BlandError('provider', 'Bland answered without a JSON object.', response.status);
    }
    return parsed;
  } catch (error) {
    if (error instanceof BlandError) throw error;
    if (controller.signal.aborted) {
      throw new BlandError(
        'timeout',
        signal?.aborted ? 'The request to Bland was stopped.' : 'Bland did not answer in time.',
      );
    }
    throw new BlandError(
      'network',
      `Bland could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onRunAbort);
  }
}

/** Queues a call; Bland dials within seconds. Returns its call id. */
export async function queueBlandCall(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await request('POST', '/calls', body, signal, fetchImpl);
  if (response.status !== 'success' || typeof response.call_id !== 'string') {
    throw new BlandError(
      'provider',
      `Bland did not queue the call.${errorDetail(response) ? ` Bland said: ${errorDetail(response)}` : ''}`,
    );
  }
  return response.call_id;
}

export async function getBlandCall(
  callId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  return request('GET', `/calls/${encodeURIComponent(callId)}`, undefined, signal, fetchImpl);
}

export async function stopBlandCall(
  callId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await request(
    'POST',
    `/calls/${encodeURIComponent(callId)}/stop`,
    undefined,
    signal,
    fetchImpl,
  );
  return typeof response.message === 'string' ? response.message : 'Call ended.';
}
