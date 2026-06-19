import { fetch as expoFetch } from 'expo/fetch';

const GOOGLE_GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const MAX_REDIRECT_HOPS = 5;

const GROUNDING_REDIRECT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const GROUNDING_REDIRECT_GET_HEADERS = {
  ...GROUNDING_REDIRECT_HEADERS,
  Range: 'bytes=0-0',
  'Accept-Encoding': 'identity',
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function readHeaderValue(headers: unknown, key: string): string | undefined {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }

  if (typeof (headers as { get?: unknown }).get === 'function') {
    return normalizeText((headers as { get: (name: string) => unknown }).get(key));
  }

  const record = headers as Record<string, unknown>;
  return normalizeText(record[key] ?? record[key.toLowerCase()]);
}

function absolutizeUrl(url: string, baseUrl: string): string | undefined {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return undefined;
  }
}

async function runWithRedirectResolutionTimeout<T>(params: {
  operation: (signal?: AbortSignal) => Promise<T>;
  parentSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  if (!params.timeoutMs || params.timeoutMs <= 0) {
    return params.operation(params.parentSignal);
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (params.parentSignal) {
    if (params.parentSignal.aborted) {
      controller.abort();
    } else {
      params.parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    return await params.operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
    params.parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export function isGoogleGroundingRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === GOOGLE_GROUNDING_REDIRECT_HOST &&
      parsed.pathname.startsWith('/grounding-api-redirect/')
    );
  } catch {
    return false;
  }
}

async function probeGroundingRedirectTarget(params: {
  url: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const attempts: Array<{
    method: 'HEAD' | 'GET';
    redirect: RequestRedirect;
    headers?: Record<string, string>;
  }> = [
    { method: 'HEAD', redirect: 'manual' },
    { method: 'HEAD', redirect: 'follow' },
    {
      method: 'GET',
      redirect: 'manual',
      headers: GROUNDING_REDIRECT_GET_HEADERS,
    },
    {
      method: 'GET',
      redirect: 'follow',
      headers: GROUNDING_REDIRECT_GET_HEADERS,
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await expoFetch(params.url, {
        method: attempt.method,
        redirect: attempt.redirect,
        headers: attempt.headers ?? GROUNDING_REDIRECT_HEADERS,
        credentials: 'omit',
        signal: params.signal,
      });
      try {
        const location = readHeaderValue(response.headers, 'location');
        const resolvedLocation = location ? absolutizeUrl(location, params.url) : undefined;
        if (resolvedLocation && resolvedLocation !== params.url) {
          return resolvedLocation;
        }

        const responseUrl = normalizeText(response.url);
        if (responseUrl && responseUrl !== params.url) {
          return responseUrl;
        }
      } finally {
        void (response as { body?: { cancel?: () => unknown } }).body?.cancel?.();
      }
    } catch {
      // Fall through to the next attempt.
    }
  }

  return undefined;
}

export async function resolveGoogleGroundingRedirectUrl(
  url: string,
  signal?: AbortSignal,
  options?: {
    timeoutMs?: number;
  },
): Promise<string> {
  if (!isGoogleGroundingRedirectUrl(url)) {
    return url;
  }

  let currentUrl = url;
  const visited = new Set<string>([url]);

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const nextUrl = await runWithRedirectResolutionTimeout({
      parentSignal: signal,
      timeoutMs: options?.timeoutMs,
      operation: (scopedSignal) =>
        probeGroundingRedirectTarget({
          url: currentUrl,
          signal: scopedSignal,
        }),
    });
    if (!nextUrl || visited.has(nextUrl)) {
      break;
    }

    currentUrl = nextUrl;
    if (!isGoogleGroundingRedirectUrl(currentUrl)) {
      return currentUrl;
    }

    visited.add(currentUrl);
  }

  return currentUrl;
}
