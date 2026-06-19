import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { generateId } from '../../utils/id';
import { guessMimeType, inferOutputFormat } from './imageGenerationFormats';
import type { GeneratedImageFormat } from './imageGenerationFormats';

export interface PersistedGeneratedImageFile {
  fileUri: string;
  fileName: string;
  size: number;
  workspacePath?: string;
}

const BASE64_LOOKUP = new Int16Array(256).fill(-1);

for (const [index, char] of Array.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
).entries()) {
  BASE64_LOOKUP[char.charCodeAt(0)] = index;
}

export function decodeBase64Image(base64Data: string): Uint8Array {
  const sanitized = base64Data.replace(/\s+/g, '');
  if (!sanitized) {
    return new Uint8Array(0);
  }

  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((sanitized.length * 3) / 4) - padding;
  const output = new Uint8Array(byteLength);
  let outputIndex = 0;

  for (let index = 0; index < sanitized.length; index += 4) {
    const first = BASE64_LOOKUP[sanitized.charCodeAt(index)];
    const second = BASE64_LOOKUP[sanitized.charCodeAt(index + 1)];
    const thirdChar = sanitized[index + 2] || '=';
    const fourthChar = sanitized[index + 3] || '=';
    const third = thirdChar === '=' ? 0 : BASE64_LOOKUP[sanitized.charCodeAt(index + 2)];
    const fourth = fourthChar === '=' ? 0 : BASE64_LOOKUP[sanitized.charCodeAt(index + 3)];

    if (
      first < 0 ||
      second < 0 ||
      (thirdChar !== '=' && third < 0) ||
      (fourthChar !== '=' && fourth < 0)
    ) {
      throw new Error('Image generation returned invalid base64 image data');
    }

    const chunk = (first << 18) | (second << 12) | (third << 6) | fourth;
    output[outputIndex] = (chunk >> 16) & 0xff;
    outputIndex += 1;

    if (thirdChar !== '=' && outputIndex < output.length) {
      output[outputIndex] = (chunk >> 8) & 0xff;
      outputIndex += 1;
    }

    if (fourthChar !== '=' && outputIndex < output.length) {
      output[outputIndex] = chunk & 0xff;
      outputIndex += 1;
    }
  }

  return output;
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const candidate = response as Response & {
    bytes?: () => Promise<Uint8Array | ArrayBuffer>;
  };

  if (typeof candidate.bytes === 'function') {
    const bytes = await candidate.bytes();
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function ensureDirectory(dir: Directory): Promise<void> {
  await dir.create({ idempotent: true, intermediates: true });
}

function persistGeneratedImageBytes(file: File, bytes: Uint8Array, label: string): void {
  if (bytes.byteLength <= 0) {
    throw new Error(`${label} returned empty image data`);
  }

  file.write(bytes);

  if (!file.exists) {
    throw new Error(`${label} could not be persisted to local storage`);
  }

  const writtenSize = Math.max(0, file.size || 0);
  if (writtenSize !== bytes.byteLength) {
    throw new Error(`${label} could not be persisted completely`);
  }
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function buildGeneratedImageFileName(format: GeneratedImageFormat): string {
  const extension = format === 'jpeg' ? 'jpg' : format;
  return `generated-image-${generateId()}.${extension}`;
}

async function createGeneratedImageDestination(
  format: GeneratedImageFormat,
  conversationId?: string,
): Promise<{ file: File; fileName: string; workspacePath?: string }> {
  const directory = conversationId
    ? new Directory(Paths.document, 'workspace', conversationId)
    : Paths.cache;
  await ensureDirectory(directory);

  const fileName = buildGeneratedImageFileName(format);
  return {
    file: new File(directory, fileName),
    fileName,
    workspacePath: conversationId ? fileName : undefined,
  };
}

export async function persistBase64Image(
  base64Data: string,
  format: GeneratedImageFormat,
  conversationId?: string,
): Promise<PersistedGeneratedImageFile> {
  const bytes = decodeBase64Image(base64Data);
  const destination = await createGeneratedImageDestination(format, conversationId);
  persistGeneratedImageBytes(destination.file, bytes, 'Generated image');
  return {
    fileUri: destination.file.uri,
    fileName: destination.fileName,
    size: bytes.byteLength,
    workspacePath: destination.workspacePath,
  };
}

export async function persistRemoteImage(
  sourceUrl: string,
  options: { requestedFormat?: string; conversationId?: string },
): Promise<{
  persisted: PersistedGeneratedImageFile;
  format: GeneratedImageFormat;
  mimeType: string;
}> {
  const response = await expoFetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Image download error ${response.status}: ${response.statusText}`);
  }

  const mimeTypeHeader = response.headers.get('content-type');
  const mimeType = mimeTypeHeader?.split(';')[0]?.trim().toLowerCase();
  if (mimeType && !mimeType.startsWith('image/')) {
    throw new Error(`Image download returned non-image content-type: ${mimeType}`);
  }

  const expectedByteLength = parsePositiveInteger(response.headers.get('content-length'));
  const format = inferOutputFormat({
    requestedFormat: options.requestedFormat,
    mimeType,
    sourceUrl,
  });
  const bytes = await readResponseBytes(response);
  if (expectedByteLength !== undefined && expectedByteLength !== bytes.byteLength) {
    throw new Error(
      `Image download was truncated (${bytes.byteLength} of ${expectedByteLength} bytes received)`,
    );
  }
  const destination = await createGeneratedImageDestination(format, options.conversationId);
  persistGeneratedImageBytes(destination.file, bytes, 'Downloaded generated image');

  return {
    persisted: {
      fileUri: destination.file.uri,
      fileName: destination.fileName,
      size: bytes.byteLength,
      workspacePath: destination.workspacePath,
    },
    format,
    mimeType: mimeType || guessMimeType(format),
  };
}

export function deriveGeneratedImageFileName(fileUri: string, remoteUrl?: string): string {
  const candidate = fileUri || remoteUrl || '';
  if (!candidate) {
    return `generated-image-${generateId()}.png`;
  }

  try {
    const parsed = new URL(candidate);
    const fileName = parsed.pathname.split('/').pop();
    return fileName && fileName.trim() ? fileName : `generated-image-${generateId()}.png`;
  } catch {
    const normalized = candidate.split(/[?#]/, 1)[0] || candidate;
    const fileName = normalized.split('/').pop();
    return fileName && fileName.trim() ? fileName : `generated-image-${generateId()}.png`;
  }
}

export function deriveWorkspacePathFromFileUri(fileUri: string): string | undefined {
  if (!fileUri) {
    return undefined;
  }

  let normalizedPath = fileUri;
  try {
    normalizedPath = new URL(fileUri).pathname;
  } catch {
    normalizedPath = fileUri.replace(/^file:\/\//, '');
  }

  const workspaceMarker = '/workspace/';
  const markerIndex = normalizedPath.indexOf(workspaceMarker);
  if (markerIndex < 0) {
    return undefined;
  }

  const suffix = normalizedPath.slice(markerIndex + workspaceMarker.length);
  const parts = suffix.split('/').filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }

  try {
    return decodeURIComponent(parts.slice(1).join('/'));
  } catch {
    return parts.slice(1).join('/');
  }
}
