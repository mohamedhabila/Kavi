import { decodeHtmlEntities } from './htmlEntityDecoding';

const DEFAULT_RESULT_DESCRIPTION_CHARS = 320;
const MAX_DERIVED_TITLE_PATH_SEGMENTS = 4;
const TRAILING_URL_ENCODED_PUNCTUATION_PATTERN =
  /(?:(?:%22|%27|%29|%2c|%3a|%3b|%3f|%5d|%60|%7d))+$/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[`'"\\)\]>},;:!?]+$/g;

export function normalizeSearchText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

export function truncateSearchText(
  value: string,
  maxChars = DEFAULT_RESULT_DESCRIPTION_CHARS,
): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function sanitizeSearchUrlText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(TRAILING_URL_ENCODED_PUNCTUATION_PATTERN, '')
    .replace(TRAILING_URL_PUNCTUATION_PATTERN, '');
}

export function normalizeSearchUrlPathCandidate(value: string | undefined): string | undefined {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return undefined;
  }

  const pathOnly = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const trimmed = pathOnly.replace(/\/+$/g, '');
  return trimmed || undefined;
}

export function deriveSearchTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const pathSegments = parsed.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (pathSegments.length === 0) {
      return hostname;
    }

    const descriptiveSegments = pathSegments
      .slice(-MAX_DERIVED_TITLE_PATH_SEGMENTS)
      .map((segment) =>
        decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim(),
      )
      .filter(Boolean);

    if (descriptiveSegments.length === 0) {
      return hostname;
    }

    return `${hostname} / ${descriptiveSegments.join(' / ')}`;
  } catch {
    return url;
  }
}

export function extractHttpUrlCandidatesFromText(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s)>\]]+/gi) || [];
  const normalizedUrls: string[] = [];
  const seenUrls = new Set<string>();

  for (const match of matches) {
    const trimmed = sanitizeSearchUrlText(match);
    try {
      const normalizedUrl = new URL(trimmed).toString();
      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        normalizedUrls.push(normalizedUrl);
      }
    } catch {
      // Ignore malformed URL fragments.
    }
  }

  return normalizedUrls;
}
