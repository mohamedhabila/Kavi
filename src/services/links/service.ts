// ---------------------------------------------------------------------------
// Kavi — Link Understanding Service
// ---------------------------------------------------------------------------
// Instead of spawning a CLI process like Kavi, we reuse the existing
// web-fetch infrastructure (directFetch) which already handles SSRF,
// HTML→Markdown extraction, caching, and Firecrawl fallback.

import { extractLinksFromMessage, DEFAULT_MAX_LINKS } from './detect';
import { formatLinkUnderstandingBody, LinkExtractionResult } from './format';
import { executeWebFetch } from '../../engine/tools/web-fetch';

export interface LinkUnderstandingOptions {
  enabled: boolean;
  maxLinks?: number;
  timeoutMs?: number;
}

/**
 * Run link understanding on a user message.
 * Extracts URLs, fetches their content using the battle-tested web-fetch tool,
 * and returns the enriched message body.
 *
 * Returns the original body unchanged if:
 * - Feature is disabled
 * - No URLs found
 * - All extractions fail
 */
export async function runLinkUnderstanding(
  body: string,
  options: LinkUnderstandingOptions,
): Promise<{ enrichedBody: string; extractedCount: number }> {
  if (!options.enabled) {
    return { enrichedBody: body, extractedCount: 0 };
  }

  const links = extractLinksFromMessage(body, {
    maxLinks: options.maxLinks ?? DEFAULT_MAX_LINKS,
  });

  if (links.length === 0) {
    return { enrichedBody: body, extractedCount: 0 };
  }

  const outputs: LinkExtractionResult[] = await (async () => {
    try {
      const raw = await executeWebFetch({
        urls: links.map((link) => link.url),
        extractMode: 'markdown',
        maxChars: 8_000, // Keep per-link content concise for LLM context
      });

      const parsed = JSON.parse(raw) as {
        error?: string;
        fetches?: Array<{
          requestedUrl?: string;
          url?: string;
          title?: string;
          content?: string;
          error?: string;
        }>;
      };
      if (parsed.error) {
        return links.map((link) => ({ url: link.url, content: '', error: parsed.error }));
      }

      const fetches = Array.isArray(parsed.fetches) ? parsed.fetches : [];
      return links.map((link, index) => {
        const fetched = fetches[index];
        if (!fetched) {
          return { url: link.url, content: '', error: 'Missing fetch result' };
        }

        return {
          url: fetched.requestedUrl || fetched.url || link.url,
          title: fetched.title,
          content: fetched.content || '',
          ...(fetched.error ? { error: fetched.error } : {}),
        };
      });
    } catch (err: unknown) {
      return links.map((link) => ({
        url: link.url,
        content: '',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  })();

  const successCount = outputs.filter((o) => o.content && !o.error).length;
  const enrichedBody = formatLinkUnderstandingBody(body, outputs);

  return { enrichedBody, extractedCount: successCount };
}
