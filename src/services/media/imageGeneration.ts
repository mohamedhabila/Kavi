import { Directory, File, Paths } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { Attachment, LlmProviderConfig, TokenUsage } from '../../types';
import { isVertexNativeGeminiBaseUrl } from '../../constants/api';
import { LlmService } from '../llm/LlmService';
import { generateId } from '../../utils/id';
import { buildImageAttachmentDataUri, readAttachmentBase64 } from './attachmentPayloads';

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  format?: 'png' | 'jpeg' | 'webp';
  background?: 'transparent' | 'opaque' | 'auto';
  style?: 'vivid' | 'natural';
  conversationId?: string;
}

export interface ImageEditSource {
  uri: string;
  name?: string;
  mimeType?: string;
  base64?: string;
}

export interface EditImageOptions {
  prompt: string;
  images: ImageEditSource[];
  mask?: ImageEditSource;
  model?: string;
  size?: string;
  quality?: string;
  format?: 'png' | 'jpeg' | 'webp';
  background?: 'transparent' | 'opaque' | 'auto';
  inputFidelity?: 'high' | 'low';
  moderation?: 'auto' | 'low';
  outputCompression?: number;
  conversationId?: string;
}

interface ProducedImageResultBase {
  model: string;
  providerId: string;
  mimeType: string;
  fileUri: string;
  fileName: string;
  size: number;
  workspacePath?: string;
  revisedPrompt?: string;
  remoteUrl?: string;
  usage?: TokenUsage;
}

export interface GeneratedImageResult extends ProducedImageResultBase {
  status: 'generated';
}

export interface EditedImageResult extends ProducedImageResultBase {
  status: 'edited';
  sourceCount: number;
  maskApplied?: boolean;
}

export type ProducedImageResult = GeneratedImageResult | EditedImageResult;

type GeneratedImageFormat = NonNullable<GenerateImageOptions['format']>;

interface PersistedGeneratedImageFile {
  fileUri: string;
  fileName: string;
  size: number;
  workspacePath?: string;
}

interface PreparedImageEditSource {
  uri: string;
  name: string;
  mimeType: string;
  dataUri?: string;
}

type ProducedImageStatus = ProducedImageResult['status'];

type ParsedProducedImageResult = Partial<ProducedImageResult> & {
  sourceCount?: number;
  maskApplied?: boolean;
  usage?: TokenUsage;
};

const MAX_IMAGE_EDIT_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_OPENAI_IMAGE_EDIT_SOURCES = 16;
const MAX_GEMINI_IMAGE_EDIT_SOURCES = 14;
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

const BASE64_LOOKUP = new Int16Array(256).fill(-1);

for (const [index, char] of Array.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
).entries()) {
  BASE64_LOOKUP[char.charCodeAt(0)] = index;
}

function inferImageModel(provider: LlmProviderConfig, requestedModel?: string): string {
  if (requestedModel) return requestedModel;
  const configured = (provider.model || '').trim();
  if (/gpt-image|dall-e/i.test(configured)) return configured;
  if (/gemini-.*image|imagen/i.test(configured)) return configured;
  const base = (provider.baseUrl || '').toLowerCase();
  if (base.includes('openai.com')) return 'gpt-image-2';
  if (
    base.includes('generativelanguage.googleapis.com') ||
    isVertexNativeGeminiBaseUrl(provider.baseUrl)
  ) {
    return 'gemini-3.1-flash-image-preview';
  }
  return configured || 'gpt-image-2';
}

function guessMimeType(format?: string): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'png':
    default:
      return 'image/png';
  }
}

function isGeminiImageProvider(provider: LlmProviderConfig, model: string): boolean {
  const base = (provider.baseUrl || '').toLowerCase();
  return (
    /gemini-.*image|imagen/i.test(model) ||
    base.includes('generativelanguage.googleapis.com') ||
    isVertexNativeGeminiBaseUrl(provider.baseUrl)
  );
}

function isSupportedOpenAIImageEditModel(model: string): boolean {
  return /^gpt-image/i.test(model) || /^chatgpt-image-latest$/i.test(model);
}

function isLocalFileUri(value: string): boolean {
  return /^file:/i.test(value);
}

function isRemoteOrDataUri(value: string): boolean {
  return /^(?:https?:\/\/|data:)/i.test(value);
}

function getFileExtension(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.split(/[?#]/, 1)[0] || value;
  const match = normalized.toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] || undefined;
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

async function validateImageEditMask(
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

async function prepareImageEditSource(
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

function normalizeImageFormat(value?: string | null): GeneratedImageFormat | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg';
    case 'png':
    case 'webp':
      return normalized;
    default:
      return undefined;
  }
}

function inferImageFormatFromMimeType(value?: string | null): GeneratedImageFormat | undefined {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return undefined;
  }
}

function inferImageFormatFromUrl(value?: string | null): GeneratedImageFormat | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return normalizeImageFormat(new URL(value).pathname.split('.').pop() || '');
  } catch {
    const withoutQuery = value.split(/[?#]/, 1)[0] || value;
    return normalizeImageFormat(withoutQuery.split('.').pop() || '');
  }
}

function inferOutputFormat(options: {
  requestedFormat?: string;
  outputFormat?: string;
  mimeType?: string | null;
  sourceUrl?: string;
}): GeneratedImageFormat {
  return (
    normalizeImageFormat(options.outputFormat) ||
    inferImageFormatFromMimeType(options.mimeType) ||
    normalizeImageFormat(options.requestedFormat) ||
    inferImageFormatFromUrl(options.sourceUrl) ||
    'png'
  );
}

function decodeBase64Image(base64Data: string): Uint8Array {
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

async function persistBase64Image(
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

async function persistRemoteImage(
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

function buildProducedImageResult(
  providerId: string,
  model: string,
  format: GeneratedImageFormat,
  persisted: PersistedGeneratedImageFile,
  revisedPrompt?: string,
  remoteUrl?: string,
  metadata?: {
    status?: ProducedImageStatus;
    sourceCount?: number;
    maskApplied?: boolean;
    usage?: TokenUsage;
  },
): ProducedImageResult {
  const base = {
    model,
    providerId,
    mimeType: guessMimeType(format),
    fileUri: persisted.fileUri,
    fileName: persisted.fileName,
    size: persisted.size,
    workspacePath: persisted.workspacePath,
    revisedPrompt,
    remoteUrl,
    usage: metadata?.usage,
  };

  if (metadata?.status === 'edited') {
    return {
      status: 'edited',
      ...base,
      sourceCount: Math.max(1, Math.round(metadata.sourceCount || 1)),
      ...(metadata.maskApplied ? { maskApplied: true } : {}),
    };
  }

  return {
    status: 'generated',
    ...base,
  };
}

function deriveGeneratedImageFileName(fileUri: string, remoteUrl?: string): string {
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

function deriveWorkspacePathFromFileUri(fileUri: string): string | undefined {
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

export function parseGeneratedImageResult(value: string): ProducedImageResult | null {
  try {
    const parsed = JSON.parse(value) as ParsedProducedImageResult | null;
    const status =
      parsed?.status === 'edited' ? 'edited' : parsed?.status === 'generated' ? 'generated' : null;
    if (
      !parsed ||
      !status ||
      typeof parsed.fileUri !== 'string' ||
      typeof parsed.mimeType !== 'string' ||
      typeof parsed.providerId !== 'string' ||
      typeof parsed.model !== 'string'
    ) {
      return null;
    }

    const base = {
      model: parsed.model,
      providerId: parsed.providerId,
      mimeType: parsed.mimeType,
      fileUri: parsed.fileUri,
      fileName:
        typeof parsed.fileName === 'string' && parsed.fileName.trim()
          ? parsed.fileName
          : deriveGeneratedImageFileName(parsed.fileUri, parsed.remoteUrl),
      size: typeof parsed.size === 'number' && Number.isFinite(parsed.size) ? parsed.size : 0,
      workspacePath:
        typeof parsed.workspacePath === 'string' && parsed.workspacePath.trim()
          ? parsed.workspacePath
          : deriveWorkspacePathFromFileUri(parsed.fileUri),
      revisedPrompt: typeof parsed.revisedPrompt === 'string' ? parsed.revisedPrompt : undefined,
      remoteUrl: typeof parsed.remoteUrl === 'string' ? parsed.remoteUrl : undefined,
      usage: normalizeParsedTokenUsage(parsed.usage, parsed.model),
    };

    if (status === 'edited') {
      return {
        status,
        ...base,
        sourceCount:
          typeof parsed.sourceCount === 'number' && Number.isFinite(parsed.sourceCount)
            ? Math.max(1, Math.round(parsed.sourceCount))
            : 1,
        ...(parsed.maskApplied === true ? { maskApplied: true } : {}),
      };
    }

    return {
      status,
      ...base,
    };
  } catch {
    return null;
  }
}

export function buildGeneratedImageAttachment(
  toolCallId: string,
  result: ProducedImageResult,
): Attachment {
  return {
    id: `generated-image-${toolCallId}`,
    type: 'image',
    uri: result.fileUri,
    name: result.fileName,
    mimeType: result.mimeType,
    size: result.size,
    workspacePath: result.workspacePath || deriveWorkspacePathFromFileUri(result.fileUri),
  };
}

function normalizeParsedTokenUsage(value: unknown, fallbackModel: string): TokenUsage | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const model = typeof usage.model === 'string' && usage.model.trim() ? usage.model : fallbackModel;
  const inputTokens = Number(usage.inputTokens);
  const outputTokens = Number(usage.outputTokens);
  const totalTokens = usage.totalTokens === undefined ? undefined : Number(usage.totalTokens);
  const cacheReadTokens =
    usage.cacheReadTokens === undefined ? undefined : Number(usage.cacheReadTokens);
  const cacheWriteTokens =
    usage.cacheWriteTokens === undefined ? undefined : Number(usage.cacheWriteTokens);

  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return undefined;
  }

  const tokenDetails =
    usage.tokenDetails && typeof usage.tokenDetails === 'object'
      ? {
          ...(Number.isFinite(
            Number((usage.tokenDetails as Record<string, unknown>).inputTextTokens),
          )
            ? {
                inputTextTokens: Math.max(
                  0,
                  Number((usage.tokenDetails as Record<string, unknown>).inputTextTokens),
                ),
              }
            : {}),
          ...(Number.isFinite(
            Number((usage.tokenDetails as Record<string, unknown>).inputImageTokens),
          )
            ? {
                inputImageTokens: Math.max(
                  0,
                  Number((usage.tokenDetails as Record<string, unknown>).inputImageTokens),
                ),
              }
            : {}),
          ...(Number.isFinite(
            Number((usage.tokenDetails as Record<string, unknown>).outputTextTokens),
          )
            ? {
                outputTextTokens: Math.max(
                  0,
                  Number((usage.tokenDetails as Record<string, unknown>).outputTextTokens),
                ),
              }
            : {}),
          ...(Number.isFinite(
            Number((usage.tokenDetails as Record<string, unknown>).outputImageTokens),
          )
            ? {
                outputImageTokens: Math.max(
                  0,
                  Number((usage.tokenDetails as Record<string, unknown>).outputImageTokens),
                ),
              }
            : {}),
          ...(Number.isFinite(
            Number((usage.tokenDetails as Record<string, unknown>).outputThinkingTokens),
          )
            ? {
                outputThinkingTokens: Math.max(
                  0,
                  Number((usage.tokenDetails as Record<string, unknown>).outputThinkingTokens),
                ),
              }
            : {}),
        }
      : undefined;

  return {
    model,
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    ...(cacheReadTokens !== undefined && Number.isFinite(cacheReadTokens)
      ? { cacheReadTokens: Math.max(0, cacheReadTokens) }
      : {}),
    ...(cacheWriteTokens !== undefined && Number.isFinite(cacheWriteTokens)
      ? { cacheWriteTokens: Math.max(0, cacheWriteTokens) }
      : {}),
    ...(totalTokens !== undefined && Number.isFinite(totalTokens)
      ? { totalTokens: Math.max(0, totalTokens) }
      : {}),
    ...(tokenDetails && Object.keys(tokenDetails).length > 0 ? { tokenDetails } : {}),
  };
}

async function persistGeneratedImagePayload(
  providerId: string,
  result: Awaited<ReturnType<LlmService['generateImage']>>,
  options: {
    requestedFormat?: string;
    conversationId?: string;
    status?: ProducedImageStatus;
    sourceCount?: number;
    maskApplied?: boolean;
    usage?: TokenUsage;
  },
): Promise<ProducedImageResult> {
  if (result.b64_json) {
    const format = inferOutputFormat({
      outputFormat: result.outputFormat,
      requestedFormat: options.requestedFormat,
      sourceUrl: result.url,
    });
    const persisted = await persistBase64Image(result.b64_json, format, options.conversationId);
    return buildProducedImageResult(
      providerId,
      result.model,
      format,
      persisted,
      result.revisedPrompt,
      result.url,
      {
        status: options.status,
        sourceCount: options.sourceCount,
        maskApplied: options.maskApplied,
        usage: options.usage,
      },
    );
  }

  if (result.url) {
    const downloaded = await persistRemoteImage(result.url, {
      requestedFormat: options.requestedFormat,
      conversationId: options.conversationId,
    });
    return {
      ...buildProducedImageResult(
        providerId,
        result.model,
        downloaded.format,
        downloaded.persisted,
        result.revisedPrompt,
        result.url,
        {
          status: options.status,
          sourceCount: options.sourceCount,
          maskApplied: options.maskApplied,
          usage: options.usage,
        },
      ),
      mimeType: downloaded.mimeType,
    };
  }

  throw new Error(
    `${options.status === 'edited' ? 'Image edit' : 'Image generation'} returned no image data`,
  );
}

async function generateOpenAICompatibleImage(
  provider: LlmProviderConfig,
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> {
  const llm = new LlmService(provider);
  const result = await llm.generateImage({
    prompt: options.prompt,
    model: inferImageModel(provider, options.model),
    size: options.size,
    quality: options.quality,
    format: options.format,
    background: options.background,
    style: options.style,
  });
  return (await persistGeneratedImagePayload(provider.id, result, {
    requestedFormat: options.format,
    conversationId: options.conversationId,
    status: 'generated',
    usage: result.usage,
  })) as GeneratedImageResult;
}

export async function generateImage(
  provider: LlmProviderConfig,
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> {
  const base = (provider.baseUrl || '').toLowerCase();
  if (base.includes('anthropic.com')) {
    throw new Error('Image generation is not supported by Anthropic in Kavi');
  }
  return generateOpenAICompatibleImage(provider, options);
}

export async function editImage(
  provider: LlmProviderConfig,
  options: EditImageOptions,
): Promise<EditedImageResult> {
  const base = (provider.baseUrl || '').toLowerCase();
  if (base.includes('anthropic.com')) {
    throw new Error('Image editing is not supported by Anthropic in Kavi');
  }

  const model = inferImageModel(provider, options.model);
  const usesGemini = isGeminiImageProvider(provider, model);
  if (!usesGemini && !isSupportedOpenAIImageEditModel(model)) {
    throw new Error('Image editing currently supports GPT Image and Gemini image models in Kavi');
  }

  if (!Array.isArray(options.images) || options.images.length === 0) {
    throw new Error('Image editing requires at least one input image');
  }

  const maxSourceCount = usesGemini ? MAX_GEMINI_IMAGE_EDIT_SOURCES : MAX_OPENAI_IMAGE_EDIT_SOURCES;
  if (options.images.length > maxSourceCount) {
    throw new Error(
      `Image editing supports up to ${maxSourceCount} input images with the active provider`,
    );
  }

  if (options.background === 'transparent' && options.format === 'jpeg') {
    throw new Error('Transparent background output requires PNG or WebP format');
  }

  if (
    typeof options.outputCompression === 'number' &&
    Number.isFinite(options.outputCompression) &&
    options.outputCompression >= 0 &&
    options.outputCompression <= 100 &&
    options.format !== 'jpeg' &&
    options.format !== 'webp'
  ) {
    throw new Error('outputCompression is only supported for JPEG or WebP output');
  }

  if (
    typeof options.outputCompression === 'number' &&
    (!Number.isFinite(options.outputCompression) ||
      options.outputCompression < 0 ||
      options.outputCompression > 100)
  ) {
    throw new Error('outputCompression must be between 0 and 100');
  }

  const preparedImages = await Promise.all(
    options.images.map((image, index) =>
      prepareImageEditSource(image, `Input image #${index + 1}`, {
        requireInlineData: usesGemini,
        requireUploadableFile: !usesGemini,
      }),
    ),
  );

  let preparedMask: PreparedImageEditSource | undefined;
  if (options.mask) {
    if (usesGemini) {
      throw new Error('Gemini image editing does not support explicit mask inputs in Kavi');
    }
    preparedMask = await prepareImageEditSource(options.mask, 'Mask image', {
      requireUploadableFile: true,
    });
    await validateImageEditMask(preparedImages[0], preparedMask, options.mask);
  }

  const llm = new LlmService(provider);
  const result = await llm.editImage({
    prompt: options.prompt,
    model,
    images: preparedImages,
    ...(preparedMask ? { mask: preparedMask } : {}),
    size: options.size,
    quality: options.quality,
    format: options.format,
    background: options.background,
    inputFidelity: options.inputFidelity,
    moderation: options.moderation,
    outputCompression: options.outputCompression,
  });

  return (await persistGeneratedImagePayload(provider.id, result, {
    requestedFormat: options.format,
    conversationId: options.conversationId,
    status: 'edited',
    sourceCount: preparedImages.length,
    maskApplied: Boolean(preparedMask),
    usage: result.usage,
  })) as EditedImageResult;
}
