import { isAllowedUrl } from '../security/ssrf';
import { unrefTimerIfSupported } from './requestNormalization';
import type { PythonHttpRequestMessage, PythonHttpResponseMessage } from './runtimeProtocol';

export const DEFAULT_PYTHON_HTTP_TIMEOUT_MS = 30_000;
export const MAX_PYTHON_HTTP_TIMEOUT_MS = 120_000;
export const MAX_PYTHON_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;

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
    const response = await fetch(request.url, {
      method,
      headers,
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      ...(requestBody ? { body: requestBody } : {}),
    });

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
      redirected: response.redirected,
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
