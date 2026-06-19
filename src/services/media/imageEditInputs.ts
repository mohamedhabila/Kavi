import { File } from 'expo-file-system';
import type { ImageEditSource } from './imageGeneration';
import { generateId } from '../../utils/id';
import { buildImageAttachmentDataUri, readAttachmentBase64 } from './attachmentPayloads';
import {
  getFileExtension,
  inferImageFormatFromMimeType,
  inferImageFormatFromUrl,
} from './imageGenerationFormats';
import {
  decodeBase64Image,
  deriveGeneratedImageFileName,
} from './imageGenerationPersistence';

export interface PreparedImageEditSource {
  uri: string;
  name: string;
  mimeType: string;
  dataUri?: string;
}

export const MAX_OPENAI_IMAGE_EDIT_SOURCES = 16;
export const MAX_GEMINI_IMAGE_EDIT_SOURCES = 14;

const MAX_IMAGE_EDIT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function isLocalFileUri(value: string): boolean {
  return /^file:/i.test(value);
}

function isRemoteOrDataUri(value: string): boolean {
  return /^(?:https?:\/\/|data:)/i.test(value);
}

function inferInputImageMimeType(source: ImageEditSource): string {
  const explicit = source.mimeType?.split(';')[0]?.trim().toLowerCase();
  if (explicit?.startsWith('image/')) {
    return explicit;
  }

  for (const candidate of [source.name, source.uri]) {
    const extension = getFileExtension(candidate);
    if (extension && IMAGE_MIME_BY_EXTENSION[extension]) {
      return IMAGE_MIME_BY_EXTENSION[extension];
    }
  }

  return 'image/png';
}

function resolveImageEditSourceName(source: ImageEditSource, fallbackMimeType: string): string {
  const explicit = source.name?.trim();
  if (explicit) {
    return explicit;
  }

  const fromUri = deriveGeneratedImageFileName(source.uri || '');
  if (fromUri) {
    return fromUri;
  }

  const extension = fallbackMimeType.includes('jpeg')
    ? 'jpg'
    : fallbackMimeType.includes('webp')
      ? 'webp'
      : 'png';
  return `image-input-${generateId()}.${extension}`;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) {
    return 0;
  }

  return (
    ((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}

function matchesPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function pngDeclaresAlphaChannel(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || !matchesPngSignature(bytes)) {
    return false;
  }

  const ihdrLength = readUint32BigEndian(bytes, 8);
  const ihdrType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    return false;
  }

  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) {
    return true;
  }

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32BigEndian(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkLength;
    if (dataEnd + 4 > bytes.length) {
      break;
    }

    const chunkType = String.fromCharCode(
      bytes[typeOffset],
      bytes[typeOffset + 1],
      bytes[typeOffset + 2],
      bytes[typeOffset + 3],
    );
    if (chunkType === 'tRNS') {
      return true;
    }
    if (chunkType === 'IDAT' || chunkType === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  return false;
}

async function loadImageEditSourceBytes(source: ImageEditSource): Promise<Uint8Array | undefined> {
  const inlineBase64 = source.base64?.replace(/\s+/g, '');
  if (inlineBase64) {
    return decodeBase64Image(inlineBase64);
  }

  if (typeof source.uri === 'string') {
    const dataUriMatch = source.uri.match(/^data:[^;]+;base64,(.+)$/i);
    if (dataUriMatch?.[1]) {
      return decodeBase64Image(dataUriMatch[1]);
    }
  }

  const localBase64 = await readAttachmentBase64({
    uri: source.uri,
    base64: source.base64,
  });
  if (!localBase64) {
    return undefined;
  }

  return decodeBase64Image(localBase64);
}

export async function validateImageEditMask(
  baseImage: PreparedImageEditSource,
  mask: PreparedImageEditSource,
  source: ImageEditSource,
): Promise<void> {
  if (!/^image\/(png|webp)$/i.test(mask.mimeType)) {
    throw new Error(
      'Image edit masks must be PNG or WebP files. Transparent regions define the editable area.',
    );
  }

  const baseFormat =
    inferImageFormatFromMimeType(baseImage.mimeType) || inferImageFormatFromUrl(baseImage.name);
  const maskFormat =
    inferImageFormatFromMimeType(mask.mimeType) || inferImageFormatFromUrl(mask.name);
  if (baseFormat && maskFormat && baseFormat !== maskFormat) {
    throw new Error('Image edit mask must use the same format as the first input image');
  }

  if (/^image\/png$/i.test(mask.mimeType)) {
    const bytes = await loadImageEditSourceBytes(source);
    if (bytes && !pngDeclaresAlphaChannel(bytes)) {
      throw new Error('PNG image edit masks must include an alpha channel');
    }
  }
}

export async function prepareImageEditSource(
  source: ImageEditSource,
  label: string,
  options?: { requireInlineData?: boolean; requireUploadableFile?: boolean },
): Promise<PreparedImageEditSource> {
  const uri = (source.uri || '').trim();
  if (!uri) {
    throw new Error(`${label} is required`);
  }

  if (options?.requireUploadableFile && isRemoteOrDataUri(uri)) {
    throw new Error(`${label} must reference a local device file for the active provider`);
  }

  const mimeType = inferInputImageMimeType(source);
  if (!mimeType.startsWith('image/')) {
    throw new Error(`${label} must be an image file`);
  }

  const name = resolveImageEditSourceName(source, mimeType);
  if (isLocalFileUri(uri)) {
    const file = new File(uri);
    if (!file.exists) {
      throw new Error(`${label} file not found: ${name}`);
    }
    const size = Math.max(0, file.size || 0);
    if (size <= 0) {
      throw new Error(`${label} file is empty: ${name}`);
    }
    if (size > MAX_IMAGE_EDIT_FILE_SIZE_BYTES) {
      throw new Error(`${label} exceeds the 50 MB image edit limit: ${name}`);
    }
  }

  let dataUri: string | undefined;
  if (options?.requireInlineData) {
    dataUri = await buildImageAttachmentDataUri({
      uri,
      base64: source.base64,
      mimeType,
    });
    if (!dataUri || !/^data:/i.test(dataUri)) {
      throw new Error(`${label} must be a local or inline image for the active provider`);
    }
  }

  return {
    uri,
    name,
    mimeType,
    ...(dataUri ? { dataUri } : {}),
  };
}
