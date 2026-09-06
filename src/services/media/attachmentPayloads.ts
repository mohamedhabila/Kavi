import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { Attachment } from '../../types/attachment';

const PDF_MIME_TYPE = 'application/pdf';

function normalizeBase64(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

function getAttachmentExtension(attachment: Pick<Attachment, 'name' | 'uri'>): string {
  for (const value of [attachment.name, attachment.uri]) {
    const normalized = value?.split(/[?#]/, 1)[0];
    const match = normalized?.toLowerCase().match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

/**
 * True for a PDF attachment, checked structurally: an `application/pdf` MIME type, or (when
 * the MIME type is missing or generic, e.g. `application/octet-stream` from a picker that
 * didn't resolve one) a `.pdf` file extension. Never inspects the file's natural-language
 * content or name text beyond that fixed extension comparison.
 */
export function isPdfAttachment(attachment: Pick<Attachment, 'name' | 'uri' | 'mimeType'>): boolean {
  return (
    attachment.mimeType?.trim().toLowerCase() === PDF_MIME_TYPE ||
    getAttachmentExtension(attachment) === 'pdf'
  );
}

export async function readAttachmentBase64(
  attachment: Pick<Attachment, 'uri' | 'base64'>,
): Promise<string | undefined> {
  const inline = normalizeBase64(attachment.base64);
  if (inline) {
    return inline;
  }

  if (!attachment.uri || /^https?:\/\//i.test(attachment.uri) || /^data:/i.test(attachment.uri)) {
    return undefined;
  }

  try {
    const base64 = await LegacyFileSystem.readAsStringAsync(attachment.uri, {
      encoding: LegacyFileSystem.EncodingType.Base64,
    } as any);
    return normalizeBase64(base64);
  } catch {
    return undefined;
  }
}

async function buildAttachmentDataUri(
  attachment: Pick<Attachment, 'uri' | 'base64' | 'mimeType'>,
  fallbackMimeType: string,
): Promise<string | undefined> {
  if (/^https?:\/\//i.test(attachment.uri) || /^data:/i.test(attachment.uri)) {
    return attachment.uri;
  }

  const base64 = await readAttachmentBase64(attachment);
  if (!base64) {
    return undefined;
  }

  return `data:${attachment.mimeType?.trim() || fallbackMimeType};base64,${base64}`;
}

export async function buildImageAttachmentDataUri(
  attachment: Pick<Attachment, 'uri' | 'base64' | 'mimeType'>,
): Promise<string | undefined> {
  return buildAttachmentDataUri(attachment, 'image/jpeg');
}

/** Same encoding path as {@link buildImageAttachmentDataUri}, for a PDF document attachment. */
export async function buildDocumentAttachmentDataUri(
  attachment: Pick<Attachment, 'uri' | 'base64' | 'mimeType'>,
): Promise<string | undefined> {
  return buildAttachmentDataUri(attachment, PDF_MIME_TYPE);
}
