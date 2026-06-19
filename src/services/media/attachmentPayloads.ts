import * as LegacyFileSystem from 'expo-file-system/legacy';
import type { Attachment } from '../../types/attachment';

function normalizeBase64(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, '');
  return normalized.length > 0 ? normalized : undefined;
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

export async function buildImageAttachmentDataUri(
  attachment: Pick<Attachment, 'uri' | 'base64' | 'mimeType'>,
): Promise<string | undefined> {
  if (/^https?:\/\//i.test(attachment.uri) || /^data:/i.test(attachment.uri)) {
    return attachment.uri;
  }

  const base64 = await readAttachmentBase64(attachment);
  if (!base64) {
    return undefined;
  }

  return `data:${attachment.mimeType?.trim() || 'image/jpeg'};base64,${base64}`;
}
