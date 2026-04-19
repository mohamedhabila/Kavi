// ---------------------------------------------------------------------------
// Kavi — Media Understanding: Formatting
//
// ---------------------------------------------------------------------------

import type { MediaUnderstandingOutput } from './types';

/**
 * Format media understanding results and append them to the original message body.
 * Returns the enriched body that should be sent to the LLM.
 */
export function formatMediaUnderstandingBody(
  body: string,
  outputs: MediaUnderstandingOutput[],
): string {
  const normalizedBody = stripMediaContext(body);
  const successful = outputs.filter((o) => o.text && !o.error);
  if (successful.length === 0) return normalizedBody;

  const sections = successful.map((o) => {
    switch (o.kind) {
      case 'audio.transcription':
        return `[Audio Attachment #${o.attachmentIndex + 1}]\nTranscript:\n${o.text}`;
      case 'image.description':
        return `[Image Attachment #${o.attachmentIndex + 1}]\nDescription:\n${o.text}`;
      case 'document.extraction':
        return `[Document Attachment #${o.attachmentIndex + 1}]\nContent:\n${o.text}`;
      default:
        return `[Attachment #${o.attachmentIndex + 1}]\n${o.text}`;
    }
  });

  return `${normalizedBody}\n\n<media_context>\n${sections.join('\n\n---\n\n')}\n</media_context>`;
}

/**
 * Strip media context tags from a body (useful for re-processing).
 */
export function stripMediaContext(body: string): string {
  return body.replace(/<media_context>[\s\S]*?<\/media_context>/g, '').trim();
}
