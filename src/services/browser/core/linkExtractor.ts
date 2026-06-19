import { decodeHtmlEntities } from './htmlEntityDecoding';
import { deriveSearchTitleFromUrl } from './resultText';

export type WebFetchLink = {
  title: string;
  url: string;
};

const DEFAULT_MAX_FETCH_LINKS = 8;
const GENERIC_LINK_TEXT_PATTERN =
  /^(?:read more|learn more|see more|more|here|click here|open|view|details)$/i;
const MIN_MEANINGFUL_SCOPE_CHARS = 120;

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ''));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractAnchorHref(attributes: string): string | undefined {
  const match = attributes.match(/\bhref=["']([^"']+)["']/i);
  return typeof match?.[1] === 'string' ? match[1] : undefined;
}

function extractAnchorTitle(attributes: string): string | undefined {
  const match = attributes.match(/\b(?:title|aria-label)=["']([^"']+)["']/i);
  const title = normalizeWhitespace(stripTags(match?.[1] || ''));
  return title || undefined;
}

function normalizeAnchorTitle(content: string, fallbackTitle?: string): string | undefined {
  const title = normalizeWhitespace(stripTags(content));
  if (title) {
    return title;
  }
  return fallbackTitle;
}

function normalizeHttpUrl(rawHref: string, baseUrl: string): string | undefined {
  const trimmed = rawHref.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^javascript:/i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    /^tel:/i.test(trimmed)
  ) {
    return undefined;
  }

  try {
    const normalized = new URL(trimmed, baseUrl);
    if (!/^https?:$/i.test(normalized.protocol)) {
      return undefined;
    }
    normalized.hash = '';
    return normalized.toString();
  } catch {
    return undefined;
  }
}

function extractLinkScopeHtml(html: string): string {
  const candidates = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<([a-z0-9:-]+)\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/\1>/gi,
    /<body\b[^>]*>([\s\S]*?)<\/body>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
  ];

  let bestFallbackCandidate: { content: string; textLength: number } | undefined;

  for (const pattern of candidates) {
    let bestPatternCandidate: { content: string; textLength: number } | undefined;

    for (const match of html.matchAll(pattern)) {
      const content = match[match.length - 1];
      if (typeof content !== 'string' || !content.trim()) {
        continue;
      }

      const textLength = normalizeWhitespace(stripTags(content)).length;
      if (!bestPatternCandidate || textLength > bestPatternCandidate.textLength) {
        bestPatternCandidate = { content, textLength };
      }
    }

    if (bestPatternCandidate && bestPatternCandidate.textLength >= MIN_MEANINGFUL_SCOPE_CHARS) {
      return bestPatternCandidate.content;
    }

    if (
      bestPatternCandidate &&
      (!bestFallbackCandidate || bestPatternCandidate.textLength > bestFallbackCandidate.textLength)
    ) {
      bestFallbackCandidate = bestPatternCandidate;
    }
  }

  return bestFallbackCandidate?.content || html;
}

function getPathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .map((segment) =>
      decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(),
    )
    .filter(Boolean);
}

function countSharedPathPrefix(a: URL, b: URL): number {
  const left = getPathSegments(a);
  const right = getPathSegments(b);
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) {
    count += 1;
  }
  return count;
}

function scoreCandidate(baseUrl: URL, candidateUrl: URL, title: string): number {
  const titleWordCount = title.split(/\s+/).filter(Boolean).length;
  const pathDepth = getPathSegments(candidateUrl).length;
  const sharedPrefix = countSharedPathPrefix(baseUrl, candidateUrl);
  const sameOrigin = baseUrl.origin === candidateUrl.origin;
  const sameHost = baseUrl.hostname === candidateUrl.hostname;
  const looksGenericText = GENERIC_LINK_TEXT_PATTERN.test(title);
  const hasQuery = Boolean(candidateUrl.search);

  let score = 0;
  if (sameHost) {
    score += 20;
  } else if (sameOrigin) {
    score += 16;
  }

  score += Math.min(pathDepth, 6) * 3;
  score += sharedPrefix * 4;

  if (title.length >= 8 && title.length <= 96) {
    score += 8;
  }
  if (titleWordCount >= 2) {
    score += 4;
  }
  if (!hasQuery) {
    score += 2;
  }
  if (looksGenericText) {
    score -= 10;
  }

  return score;
}

function dedupeAndRankLinks(
  links: WebFetchLink[],
  baseUrl: string,
  maxLinks: number,
): WebFetchLink[] {
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    return links.slice(0, maxLinks);
  }

  const seen = new Map<string, { link: WebFetchLink; score: number }>();

  for (const link of links) {
    try {
      const parsedLinkUrl = new URL(link.url);
      if (parsedLinkUrl.toString() === parsedBaseUrl.toString()) {
        continue;
      }
      const score = scoreCandidate(parsedBaseUrl, parsedLinkUrl, link.title);
      const existing = seen.get(link.url);
      if (!existing || score > existing.score) {
        seen.set(link.url, { link, score });
      }
    } catch {
      continue;
    }
  }

  return [...seen.values()]
    .sort((left, right) => right.score - left.score || left.link.url.localeCompare(right.link.url))
    .slice(0, maxLinks)
    .map((entry) => entry.link);
}

export function extractFetchedLinksFromHtml(
  html: string,
  baseUrl: string,
  maxLinks = DEFAULT_MAX_FETCH_LINKS,
): WebFetchLink[] | undefined {
  const scopeHtml = extractLinkScopeHtml(html);
  const candidates: WebFetchLink[] = [];

  for (const match of scopeHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] || '';
    const content = match[2] || '';
    const rawHref = extractAnchorHref(attributes);
    if (!rawHref) {
      continue;
    }

    const normalizedUrl = normalizeHttpUrl(rawHref, baseUrl);
    if (!normalizedUrl) {
      continue;
    }

    const fallbackTitle = extractAnchorTitle(attributes);
    const title =
      normalizeAnchorTitle(content, fallbackTitle) || deriveSearchTitleFromUrl(normalizedUrl);

    candidates.push({ title, url: normalizedUrl });
  }

  const ranked = dedupeAndRankLinks(candidates, baseUrl, maxLinks);
  return ranked.length > 0 ? ranked : undefined;
}

export function extractFetchedLinksFromMarkdown(
  markdown: string,
  maxLinks = DEFAULT_MAX_FETCH_LINKS,
): WebFetchLink[] | undefined {
  const candidates: WebFetchLink[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const title = normalizeWhitespace(match[1] || '');
    const url = (match[2] || '').trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    candidates.push({
      title: title || deriveSearchTitleFromUrl(url),
      url,
    });
  }

  const unique = candidates.slice(0, maxLinks);
  return unique.length > 0 ? unique : undefined;
}
