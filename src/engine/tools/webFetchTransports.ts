import { fetch as expoFetch } from 'expo/fetch';

import {
  extractFetchedLinksFromHtml,
  extractFetchedLinksFromMarkdown,
  type WebFetchLink,
} from '../../services/browser/core/linkExtractor';
import { htmlToMarkdown, truncateText } from './web-fetch-utils';
import { readResponseText } from './web-shared';

const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export type WebFetchEntry = {
  requestedUrl?: string;
  resolvedUrl?: string;
  url?: string;
  title?: string;
  content?: string;
  links?: WebFetchLink[];
  truncated?: boolean;
  charCount?: number;
  source?: string;
  error?: string;
  directError?: string;
  fallbackError?: string;
};

export function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {}
  }

  return String(error);
}

function truncateDetail(value: string, maxChars = 160): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function summarizeFetchErrorBody(bodyText: string, contentType: string | null): string {
  const normalizedBody = bodyText.trim();
  if (!normalizedBody) {
    return '';
  }

  const normalizedType = (contentType || '').toLowerCase();

  if (normalizedType.includes('application/json')) {
    try {
      const parsed = JSON.parse(normalizedBody) as
        | { error?: unknown; message?: unknown }
        | undefined;
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return truncateDetail(parsed.message.trim());
      }
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return truncateDetail(parsed.error.trim());
      }
    } catch {}
  }

  if (normalizedType.includes('text/html') || normalizedBody.startsWith('<')) {
    const { text, title } = htmlToMarkdown(normalizedBody, 'text');
    const summary = truncateDetail((title || text || '').trim());
    return summary;
  }

  return truncateDetail(normalizedBody.replace(/\s+/g, ' ').trim());
}

export async function directFetch(params: {
  url: string;
  extractMode: 'markdown' | 'text';
  maxChars: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  title?: string;
  links?: WebFetchLink[];
  truncated: boolean;
  charCount: number;
  resolvedUrl?: string;
}> {
  const headerProfiles = [
    {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    {
      'User-Agent': FALLBACK_USER_AGENT,
      Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
    },
  ];

  let lastError: Error | null = null;

  for (const headers of headerProfiles) {
    try {
      const res = await expoFetch(params.url, {
        credentials: 'omit',
        headers,
        redirect: 'follow',
        signal: params.signal,
      });

      if (!res.ok) {
        const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
        const summarizedDetail = summarizeFetchErrorBody(
          detail,
          typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null,
        );
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${summarizedDetail ? `: ${summarizedDetail}` : ''}`,
        );
      }

      const contentType = res.headers.get('content-type') || '';
      const { text: rawText } = await readResponseText(res, {
        maxBytes: DEFAULT_FETCH_MAX_RESPONSE_BYTES,
      });

      if (contentType.includes('application/json')) {
        const { text, truncated } = truncateText(rawText, params.maxChars);
        return {
          content: text,
          truncated,
          charCount: rawText.length,
          resolvedUrl: typeof res.url === 'string' && res.url.trim() ? res.url : undefined,
        };
      }

      if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
        const { text, truncated } = truncateText(rawText, params.maxChars);
        return {
          content: text,
          truncated,
          charCount: rawText.length,
          resolvedUrl: typeof res.url === 'string' && res.url.trim() ? res.url : undefined,
        };
      }

      const { text: extractedText, title } = htmlToMarkdown(
        rawText,
        params.extractMode,
        typeof res.url === 'string' && res.url.trim() ? res.url : params.url,
      );
      const links = extractFetchedLinksFromHtml(
        rawText,
        typeof res.url === 'string' && res.url.trim() ? res.url : params.url,
      );
      const { text: truncatedText, truncated } = truncateText(extractedText, params.maxChars);
      return {
        content: truncatedText,
        title,
        ...(links ? { links } : {}),
        truncated,
        charCount: extractedText.length,
        resolvedUrl: typeof res.url === 'string' && res.url.trim() ? res.url : undefined,
      };
    } catch (error: unknown) {
      if (params.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(describeFetchError(error));
    }
  }

  throw lastError || new Error('Fetch failed');
}

export async function firecrawlFetch(params: {
  url: string;
  apiKey: string;
  maxChars: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  title?: string;
  links?: WebFetchLink[];
  truncated: boolean;
  charCount: number;
}> {
  const res = await expoFetch(`${DEFAULT_FIRECRAWL_BASE_URL}/v1/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      url: params.url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
    credentials: 'omit',
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Firecrawl failed: HTTP ${res.status}`);
  const data = await res.json();

  const markdown = data?.data?.markdown || '';
  const title = data?.data?.metadata?.title;
  const links = extractFetchedLinksFromMarkdown(markdown);
  const { text, truncated } = truncateText(markdown, params.maxChars);
  return {
    content: text,
    title,
    ...(links ? { links } : {}),
    truncated,
    charCount: markdown.length,
  };
}
