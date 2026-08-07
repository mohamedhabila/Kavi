// ---------------------------------------------------------------------------
// Kavi — Web Fetch Utils
// ---------------------------------------------------------------------------
// Pure regex-based HTML→Markdown (no DOM required).

import { buildHeadTailExcerpt } from '../../utils/headTailExcerpt';

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ''));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripHtmlComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '');
}

const MIN_MEANINGFUL_CONTENT_CHARS = 120;

function measureVisibleTextLength(html: string): number {
  const visibleHtml = stripStructuralChrome(html);
  const visibleText = normalizeWhitespace(stripTags(visibleHtml));
  return visibleText.length;
}

export function extractDocumentContentHtml(html: string): string {
  const normalizedHtml = stripHtmlComments(html);
  const candidates = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<([a-z0-9:-]+)\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/\1>/gi,
    /<body\b[^>]*>([\s\S]*?)<\/body>/gi,
  ];
  let bestFallbackCandidate: { content: string; textLength: number } | undefined;

  for (const pattern of candidates) {
    let bestPatternCandidate: { content: string; textLength: number } | undefined;

    for (const match of normalizedHtml.matchAll(pattern)) {
      const content = match[match.length - 1];
      if (typeof content !== 'string' || !content.trim()) {
        continue;
      }

      const textLength = measureVisibleTextLength(content);
      if (!bestPatternCandidate || textLength > bestPatternCandidate.textLength) {
        bestPatternCandidate = { content, textLength };
      }
    }

    if (bestPatternCandidate && bestPatternCandidate.textLength >= MIN_MEANINGFUL_CONTENT_CHARS) {
      return bestPatternCandidate.content;
    }

    if (
      bestPatternCandidate &&
      (!bestFallbackCandidate || bestPatternCandidate.textLength > bestFallbackCandidate.textLength)
    ) {
      bestFallbackCandidate = bestPatternCandidate;
    }
  }

  return bestFallbackCandidate?.content || normalizedHtml;
}

function stripStructuralChrome(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg|canvas)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|header|footer|aside|form|dialog|button)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<([a-z0-9:-]+)\b[^>]*\brole=["'](?:navigation|complementary|banner|contentinfo|search)["'][^>]*>[\s\S]*?<\/\1>/gi,
      '',
    )
    .replace(/<([a-z0-9:-]+)\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/\1>/gi, '');
}

export function htmlToMarkdown(
  html: string,
  extractMode: 'markdown' | 'text' = 'markdown',
  baseUrl?: string,
): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? normalizeWhitespace(stripTags(titleMatch[1])) : undefined;

  let text = stripStructuralChrome(extractDocumentContentHtml(html));

  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    const code = decodeEntities(body).trim();
    return code ? `\n\`\`\`\n${code}\n\`\`\`\n` : '';
  });

  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => {
    const code = normalizeWhitespace(decodeEntities(body));
    return code ? `\`${code}\`` : '';
  });

  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    let normalizedHref = href;
    if (baseUrl) {
      try {
        normalizedHref = new URL(href, baseUrl).toString();
      } catch {}
    }
    const label = normalizeWhitespace(stripTags(body));
    if (!label) return normalizedHref;
    return `[${label}](${normalizedHref})`;
  });

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const prefix = '#'.repeat(Math.max(1, Math.min(6, Number.parseInt(level, 10))));
    const label = normalizeWhitespace(stripTags(body));
    return `\n${prefix} ${label}\n`;
  });

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `\n- ${label}` : '';
  });

  text = text
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|table|tr|ul|ol|blockquote|pre)>/gi, '\n');

  text = stripTags(text);
  text = normalizeWhitespace(text);
  return { text: extractMode === 'text' ? markdownToText(text) : text, title };
}

export function markdownToText(markdown: string): string {
  let text = markdown;
  text = text.replace(/!\[[^\]]*]\([^)]+\)/g, '');
  text = text.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  text = text.replace(/```[\s\S]*?```/g, (block) =>
    block.replace(/```[^\n]*\n?/g, '').replace(/```/g, ''),
  );
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  return normalizeWhitespace(text);
}

export function truncateText(
  value: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  const excerpt = buildHeadTailExcerpt(value, maxChars);
  return {
    text: excerpt.length <= maxChars ? excerpt : value.slice(0, maxChars),
    truncated: true,
  };
}

/**
 * Returns a bounded window of a document plus the coordinates needed to ask for the
 * next one.
 *
 * A page longer than the budget used to come back as a head-and-tail excerpt with no
 * way to reach the middle. A model that needed a field which fell in the gap could
 * only re-fetch — the same URL, a different URL, a different API — and each attempt
 * cost a full model turn while returning the same excerpt. Traced on device as a run
 * that fetched three times and still could not read one infobox field.
 *
 * A window plus `nextOffset` makes continuation a first-class operation, which is the
 * offset/limit contract agent fetch tools converge on.
 */
/**
 * Returns the regions of a document that mention what the caller is looking for.
 *
 * A positional window is the wrong primitive for a targeted lookup. A model that needs
 * one field from a long page cannot know whether it sits at offset 20,000 or 120,000,
 * so guessing another URL is cheaper than guessing an offset — traced on device as
 * eight fetches across five sources hunting a single diameter, none of which read past
 * the first window of any page.
 *
 * Matching regions keep the surrounding text so the value stays interpretable, and are
 * merged when they overlap so the result reads as prose rather than fragments. An
 * empty result is meaningful: it says the term is absent from this document, which is
 * what tells the model to try a different source instead of guessing again.
 */
export function selectMatchingRegions(
  value: string,
  query: string,
  maxChars: number,
  contextChars = 600,
): { text: string; matchCount: number; totalChars: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { text: '', matchCount: 0, totalChars: value.length };
  }

  const haystack = value.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (ranges.length < 50) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    const start = Math.max(0, index - contextChars);
    const end = Math.min(value.length, index + needle.length + contextChars);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
    cursor = index + needle.length;
  }

  if (ranges.length === 0) {
    return { text: '', matchCount: 0, totalChars: value.length };
  }

  const segments: string[] = [];
  let used = 0;
  for (const range of ranges) {
    const segment = value.slice(range.start, range.end);
    if (used + segment.length > maxChars) {
      segments.push(segment.slice(0, Math.max(0, maxChars - used)));
      break;
    }
    segments.push(segment);
    used += segment.length;
  }

  return {
    text: segments.join('\n…\n'),
    matchCount: ranges.length,
    totalChars: value.length,
  };
}

export function sliceTextWindow(
  value: string,
  offset: number,
  maxChars: number,
): { text: string; truncated: boolean; totalChars: number; offset: number; nextOffset?: number } {
  const totalChars = value.length;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.min(Math.floor(offset), totalChars)) : 0;
  const end = Math.min(totalChars, safeOffset + maxChars);
  const text = value.slice(safeOffset, end);
  const truncated = end < totalChars;
  return {
    text,
    truncated,
    totalChars,
    offset: safeOffset,
    ...(truncated ? { nextOffset: end } : {}),
  };
}
