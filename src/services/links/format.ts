// ---------------------------------------------------------------------------
// Kavi — Link Understanding: Formatting
//
// ---------------------------------------------------------------------------

export interface LinkExtractionResult {
  url: string;
  title?: string;
  content: string;
  error?: string;
}

/**
 * Format extracted link content and append it to the original message body.
 * Returns the enriched body that should be sent to the LLM.
 */
export function formatLinkUnderstandingBody(body: string, outputs: LinkExtractionResult[]): string {
  if (outputs.length === 0) return body;

  const sections = outputs
    .filter((o) => o.content || o.error)
    .map((o) => {
      if (o.error) {
        return `[Link: ${o.url}]\n(Failed to extract: ${o.error})`;
      }
      const header = o.title ? `[${o.title}](${o.url})` : `[Link: ${o.url}]`;
      return `${header}\n${o.content}`;
    });

  if (sections.length === 0) return body;

  return `${body}\n\n<link_context>\n${sections.join('\n\n---\n\n')}\n</link_context>`;
}
