import {
  deriveSearchTitleFromUrl,
  normalizeSearchText,
  sanitizeSearchUrlText,
  truncateSearchText,
} from './resultText';
import { looksLikeTemplateUrl } from './resultUrlSignals';

export type WebSearchResultRow = {
  title: string;
  url: string;
  description: string;
};

export type ShallowWebSearchResultRecord = {
  query: string;
  results?: Array<Record<string, unknown>>;
  error?: string;
};

function splitBreadcrumbTitle(title: string): string[] {
  return title
    .split(/\s+\/\s+/)
    .map((segment) => normalizeSearchText(segment)?.toLowerCase())
    .filter((segment): segment is string => Boolean(segment));
}

function shouldPreferDerivedBreadcrumbTitle(title: string, derivedTitle: string): boolean {
  const titleSegments = splitBreadcrumbTitle(title);
  const derivedSegments = splitBreadcrumbTitle(derivedTitle);

  if (
    titleSegments.length < 2 ||
    derivedSegments.length <= titleSegments.length ||
    titleSegments[0] !== derivedSegments[0]
  ) {
    return false;
  }

  const titlePath = titleSegments.slice(1);
  const derivedPath = derivedSegments.slice(1);
  if (titlePath.length === 0 || derivedPath.length <= titlePath.length) {
    return false;
  }

  return titlePath.every(
    (segment, index) => derivedPath[derivedPath.length - titlePath.length + index] === segment,
  );
}

function titleLooksLikeBareDomain(title: string): boolean {
  const normalized = normalizeSearchText(title);
  if (!normalized) {
    return false;
  }

  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized);
}

function normalizeResultUrl(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeSearchText(sanitizeSearchUrlText(value));
  }

  return normalizeSearchText(value);
}

function normalizeResultRow(params: {
  result: { title?: unknown; url?: unknown; description?: unknown };
  fallbackDescription?: string;
}): WebSearchResultRow | undefined {
  const url = normalizeResultUrl(params.result.url);
  if (!url) {
    return undefined;
  }

  const normalizedTitle = normalizeSearchText(params.result.title);
  const derivedTitle = deriveSearchTitleFromUrl(url);
  const title =
    normalizedTitle && !titleLooksLikeBareDomain(normalizedTitle)
      ? shouldPreferDerivedBreadcrumbTitle(normalizedTitle, derivedTitle)
        ? derivedTitle
        : normalizedTitle
      : derivedTitle;
  const description = truncateSearchText(
    normalizeSearchText(params.result.description) || params.fallbackDescription || '',
  );

  return {
    title,
    url,
    description,
  };
}

function dropTemplateOnlyWhenConcreteResultsExist(
  results: WebSearchResultRow[],
): WebSearchResultRow[] {
  const hasConcreteUrl = results.some((result) => !looksLikeTemplateUrl(result.url));
  if (!hasConcreteUrl) {
    return results;
  }

  return results.filter((result) => !looksLikeTemplateUrl(result.url));
}

export function buildCitationBackfilledResults(params: {
  citations: string[];
  fallbackDescription?: string;
}): WebSearchResultRow[] {
  const fallbackDescription = normalizeSearchText(params.fallbackDescription);
  const results: WebSearchResultRow[] = [];
  const seenUrls = new Set<string>();

  for (const citation of params.citations) {
    const url = normalizeResultUrl(citation);
    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    results.push({
      title: deriveSearchTitleFromUrl(url),
      url,
      description: fallbackDescription ? truncateSearchText(fallbackDescription) : '',
    });
  }

  return results;
}

export function normalizeWebSearchResults(params: {
  citations?: string[];
  fallbackDescription?: string;
  results?: Array<{
    title?: unknown;
    url?: unknown;
    description?: unknown;
  }>;
}): {
  citations: string[];
  results: WebSearchResultRow[];
} {
  const fallbackDescription = normalizeSearchText(params.fallbackDescription);
  const normalizedResults: WebSearchResultRow[] = [];
  const seenUrls = new Set<string>();

  for (const rawResult of params.results || []) {
    const normalized = normalizeResultRow({
      result: rawResult,
      fallbackDescription,
    });
    if (!normalized || seenUrls.has(normalized.url)) {
      continue;
    }

    seenUrls.add(normalized.url);
    normalizedResults.push(normalized);
  }

  const results =
    normalizedResults.length > 0
      ? dropTemplateOnlyWhenConcreteResultsExist(normalizedResults)
      : buildCitationBackfilledResults({
          citations: params.citations || [],
          fallbackDescription,
        });

  return {
    citations: results.map((result) => result.url),
    results,
  };
}

export function normalizeShallowWebSearchResult(params: {
  maxResults: number;
  query: string;
  result: Record<string, unknown>;
}): ShallowWebSearchResultRecord {
  const rawResults = Array.isArray(params.result.results)
    ? params.result.results.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];

  const normalizedResults = rawResults
    .map((entry) => {
      const compacted: Record<string, unknown> = {};
      if (typeof entry.title === 'string') {
        compacted.title = entry.title;
      }
      if (typeof entry.url === 'string') {
        compacted.url = entry.url;
      }
      return compacted;
    })
    .filter((entry) => typeof entry.url === 'string' && entry.url.trim().length > 0);

  return {
    query: params.query,
    results: normalizedResults.slice(0, params.maxResults),
  };
}
