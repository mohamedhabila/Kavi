import { fetch as expoFetch } from 'expo/fetch';

import { isAllowedUrl } from '../security/ssrf';
import { unrefTimerIfSupported } from './requestNormalization';
import type { PythonHttpRequestMessage, PythonHttpResponseMessage } from './runtimeProtocol';

export const DEFAULT_PYTHON_HTTP_TIMEOUT_MS = 30_000;
export const MAX_PYTHON_HTTP_TIMEOUT_MS = 120_000;
export const MAX_PYTHON_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_PYTHON_HTTP_REDIRECTS = 5;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);
const BODY_HEADERS = new Set(['content-length', 'content-type', 'transfer-encoding']);

type PythonHttpResponsePayload = Omit<
  PythonHttpResponseMessage,
  'type' | 'runtimeId' | 'requestId'
>;

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return DEFAULT_PYTHON_HTTP_TIMEOUT_MS;
  }

  return Math.max(250, Math.min(MAX_PYTHON_HTTP_TIMEOUT_MS, Math.trunc(value)));
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === 'string' && typeof value === 'string' && key.trim()) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as { Buffer?: any }).Buffer;
  if (bufferCtor?.from) {
    return bufferCtor.from(bytes).toString('base64');
  }

  const btoaFn = (globalThis as { btoa?: (value: string) => string }).btoa;
  if (typeof btoaFn === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoaFn(binary);
  }

  throw new Error('Base64 encoding is not supported in this runtime.');
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const normalized = String(base64 || '').replace(/\s+/g, '');
  if (!normalized) {
    return new Uint8Array(0);
  }

  const bufferCtor = (globalThis as { Buffer?: any }).Buffer;
  if (bufferCtor?.from) {
    return new Uint8Array(bufferCtor.from(normalized, 'base64'));
  }

  const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const binary = atobFn(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  throw new Error('Base64 decoding is not supported in this runtime.');
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }

  return error instanceof Error && error.name === 'AbortError';
}

function normalizeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return `Python HTTP request failed: ${message}`;
}

function withoutHeaders(
  headers: Record<string, string>,
  blockedNames: ReadonlySet<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !blockedNames.has(name.toLowerCase())),
  );
}

function resolveRedirectMethod(status: number, method: string): string {
  if (status === 303 && method !== 'HEAD') {
    return 'GET';
  }
  if ((status === 301 || status === 302) && method === 'POST') {
    return 'GET';
  }
  return method;
}

async function fetchWithUrlPolicy(params: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: ArrayBuffer;
  signal: AbortSignal;
}): Promise<{ response?: Response; redirected: boolean; error?: string }> {
  let currentUrl = params.url;
  let currentMethod = params.method;
  let currentHeaders = params.headers;
  let currentBody = params.body;
  let redirectCount = 0;

  while (true) {
    if (!isAllowedUrl(currentUrl)) {
      return {
        redirected: redirectCount > 0,
        error: `Python HTTP request blocked by security policy: ${currentUrl}`,
      };
    }

    const response = await expoFetch(currentUrl, {
      method: currentMethod,
      headers: currentHeaders,
      signal: params.signal,
      redirect: 'manual',
      credentials: 'omit',
      ...(currentBody && currentMethod !== 'GET' && currentMethod !== 'HEAD'
        ? { body: currentBody }
        : {}),
    });
    const location = response.headers.get('location');
    if (!REDIRECT_STATUS_CODES.has(response.status) || !location) {
      return { response: response as unknown as Response, redirected: redirectCount > 0 };
    }
    if (redirectCount >= MAX_PYTHON_HTTP_REDIRECTS) {
      return {
        redirected: true,
        error: `Python HTTP request exceeded ${MAX_PYTHON_HTTP_REDIRECTS} redirects.`,
      };
    }

    const nextUrl = new URL(location, currentUrl).toString();
    if (!isAllowedUrl(nextUrl)) {
      return {
        redirected: true,
        error: `Python HTTP redirect blocked by security policy: ${nextUrl}`,
      };
    }

    if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
      currentHeaders = withoutHeaders(currentHeaders, CROSS_ORIGIN_SENSITIVE_HEADERS);
    }
    const nextMethod = resolveRedirectMethod(response.status, currentMethod);
    if (nextMethod !== currentMethod) {
      currentHeaders = withoutHeaders(currentHeaders, BODY_HEADERS);
      currentBody = undefined;
    }

    currentUrl = nextUrl;
    currentMethod = nextMethod;
    redirectCount += 1;
  }
}

export async function performPythonHttpRequest(
  request: PythonHttpRequestMessage,
  options?: { signal?: AbortSignal },
): Promise<PythonHttpResponsePayload> {
  if (!isAllowedUrl(request.url)) {
    return {
      error: `Python HTTP request blocked by security policy: ${request.url}`,
    };
  }

  const timeoutMs = normalizeTimeoutMs(request.timeoutMs);
  const headers = normalizeHeaders(request.headers);
  const method =
    typeof request.method === 'string' && request.method.trim()
      ? request.method.trim().toUpperCase()
      : 'GET';
  const externalSignal = options?.signal;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const handleExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      handleExternalAbort();
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  unrefTimerIfSupported(timeout);

  try {
    const bodyBytes =
      typeof request.bodyBase64 === 'string' ? decodeBase64ToBytes(request.bodyBase64) : null;
    const requestBody =
      bodyBytes && method !== 'GET' && method !== 'HEAD'
        ? (bodyBytes.slice().buffer as ArrayBuffer)
        : undefined;
    const fetchResult = await fetchWithUrlPolicy({
      url: request.url,
      method,
      headers,
      signal: controller.signal,
      ...(requestBody ? { body: requestBody } : {}),
    });
    if (!fetchResult.response) {
      return { error: fetchResult.error || 'Python HTTP request failed URL validation.' };
    }
    const response = fetchResult.response;

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_PYTHON_HTTP_RESPONSE_BYTES) {
      return {
        error: `Python HTTP response exceeded ${MAX_PYTHON_HTTP_RESPONSE_BYTES} bytes.`,
      };
    }

    const responseBody =
      method === 'HEAD' ||
      response.status === 204 ||
      response.status === 205 ||
      response.status === 304
        ? new Uint8Array(0)
        : new Uint8Array(await response.arrayBuffer());

    if (responseBody.byteLength > MAX_PYTHON_HTTP_RESPONSE_BYTES) {
      return {
        error: `Python HTTP response exceeded ${MAX_PYTHON_HTTP_RESPONSE_BYTES} bytes.`,
      };
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: responseBody.byteLength > 0 ? encodeBytesToBase64(responseBody) : undefined,
      url: response.url || request.url,
      redirected: fetchResult.redirected,
    };
  } catch (error) {
    if (timedOut) {
      return {
        error: `Python HTTP request timed out after ${timeoutMs}ms.`,
      };
    }

    if (externalSignal?.aborted || (controller.signal.aborted && isAbortError(error))) {
      throw error;
    }

    return {
      error: normalizeFetchError(error),
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', handleExternalAbort);
    }
  }
}
