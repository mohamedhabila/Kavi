import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { NativeActionError } from './types';
import { normalizeOptionalString, validateFileUri } from './validators';

const MIME_TYPE_REGEX = /^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/i;

export interface ResolvedLocalFile {
  file: File;
  fileUri: string;
  contentUri?: string;
  mimeType?: string;
}

export function normalizeOptionalMimeType(value: unknown, fieldName: string): string | undefined {
  const normalized = normalizeOptionalString(value, fieldName);
  if (!normalized) {
    return undefined;
  }

  if (!MIME_TYPE_REGEX.test(normalized)) {
    throw new NativeActionError(
      'invalid_mime_type',
      `${fieldName} must be a valid MIME type such as image/png.`,
    );
  }

  return normalized.toLowerCase();
}

export function resolveLocalFile(
  uri: string,
  fieldName: string,
  options?: { allowContentUri?: boolean },
): ResolvedLocalFile {
  const normalized = validateFileUri(uri, fieldName, options);

  if (normalized.startsWith('content://')) {
    return {
      file: new File(normalized),
      fileUri: normalized,
      contentUri: normalized,
    };
  }

  const file = new File(normalized);
  if (!file.exists) {
    throw new NativeActionError(
      'file_not_found',
      `${fieldName} does not exist or is not readable.`,
      'failed',
      { uri: normalized },
    );
  }

  return {
    file,
    fileUri: normalized,
    contentUri: Platform.OS === 'android' ? file.contentUri : undefined,
    mimeType: file.type || undefined,
  };
}

export function resolveMailAttachmentUri(uri: string, fieldName: string): string {
  return resolveLocalFile(uri, fieldName).fileUri;
}

export function resolveSmsAttachmentUri(uri: string, fieldName: string): string {
  const resolved = resolveLocalFile(uri, fieldName, { allowContentUri: true });
  if (resolved.fileUri.startsWith('content://')) {
    return resolved.fileUri;
  }

  if (Platform.OS === 'android') {
    if (!resolved.contentUri) {
      throw new NativeActionError(
        'invalid_sms_attachment_uri',
        'SMS attachments on Android must resolve to content:// URIs.',
      );
    }

    return resolved.contentUri;
  }

  return resolved.fileUri;
}
