// ---------------------------------------------------------------------------
// Kavi — Link Understanding: URL Detection
//
// ---------------------------------------------------------------------------

import { isAllowedUrl } from '../../services/security/ssrf';

/** Matches markdown-style links: [text](https://...) */
const MARKDOWN_LINK_RE = /\[[^\]]*]\((https?:\/\/\S+?)\)/gi;

/** Matches bare URLs */
const BARE_LINK_RE = /https?:\/\/\S+/gi;

export const DEFAULT_MAX_LINKS = 3;
export const DEFAULT_LINK_TIMEOUT_MS = 30_000;

export interface ExtractedLink {
  url: string;
  source: 'markdown' | 'bare';
}

/**
 * Extract URLs from a message body, applying SSRF validation and de-duplication.
 */
export function extractLinksFromMessage(
  body: string,
  opts: { maxLinks?: number } = {},
): ExtractedLink[] {
  const maxLinks = opts.maxLinks ?? DEFAULT_MAX_LINKS;
  const seen = new Set<string>();
  const results: ExtractedLink[] = [];

  // 1. Extract markdown links
  let match: RegExpExecArray | null;
  MARKDOWN_LINK_RE.lastIndex = 0;
  while ((match = MARKDOWN_LINK_RE.exec(body)) !== null) {
    const url = cleanUrl(match[1]);
    if (url && !seen.has(url) && isAllowedUrl(url)) {
      seen.add(url);
      results.push({ url, source: 'markdown' });
    }
    if (results.length >= maxLinks) return results;
  }

  // 2. Strip markdown links from body so bare URL regex doesn't re-match them
  const stripped = body.replace(MARKDOWN_LINK_RE, '');

  // 3. Extract bare URLs
  BARE_LINK_RE.lastIndex = 0;
  while ((match = BARE_LINK_RE.exec(stripped)) !== null) {
    const url = cleanUrl(match[0]);
    if (url && !seen.has(url) && isAllowedUrl(url)) {
      seen.add(url);
      results.push({ url, source: 'bare' });
    }
    if (results.length >= maxLinks) return results;
  }

  return results;
}

/** Clean trailing punctuation that isn't part of the URL. */
function cleanUrl(raw: string): string {
  // Remove trailing ), ], ., , that are commonly part of surrounding prose
  return raw.replace(/[)}\].,;:!?'"]+$/, '');
}
