import { isVertexNativeGeminiBaseUrl } from '../../../constants/api';
import { normalizeUsage } from '../../usage/tracker';
import { PRIMARY_GEMINI_IMAGE_MODEL, normalizeImageModelId } from './modelPolicy';
import type { GeneratedImagePayload, ImageEditRequest, ImageGenerationRequest } from './types';

type GeminiImageSizeValue = '512' | '1K' | '2K' | '4K';

const GEMINI_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
]);

const GEMINI_IMAGE_SIZE_VALUES = new Set<GeminiImageSizeValue>(['512', '1K', '2K', '4K']);

export async function generateGeminiImage(args: {
  baseUrl: string;
  headers: Record<string, string>;
  defaultModel?: string;
  options: ImageGenerationRequest;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<GeneratedImagePayload> {
  const model =
    normalizeImageModelId(args.options.model || args.defaultModel || PRIMARY_GEMINI_IMAGE_MODEL) ||
    PRIMARY_GEMINI_IMAGE_MODEL;
  const response = await args.performFetch(buildGeminiGenerateContentUrl(args.baseUrl, model), {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify(buildGeminiImageRequestBody(args.options)),
    signal: args.options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(
      `Gemini image generation error ${response.status}: ${extractGeminiApiErrorMessage(errorText)}`,
    );
  }

  const json = (await response.json()) as any;
  return extractGeminiImagePayload(json, model);
}

export async function editGeminiImage(args: {
  baseUrl: string;
  headers: Record<string, string>;
  defaultModel?: string;
  options: Pick<ImageEditRequest, 'prompt' | 'images' | 'size' | 'signal' | 'model'>;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<GeneratedImagePayload> {
  const model =
    normalizeImageModelId(args.options.model || args.defaultModel || PRIMARY_GEMINI_IMAGE_MODEL) ||
    PRIMARY_GEMINI_IMAGE_MODEL;
  const response = await args.performFetch(buildGeminiGenerateContentUrl(args.baseUrl, model), {
    method: 'POST',
    headers: args.headers,
    body: JSON.stringify(buildGeminiImageEditRequestBody(args.options)),
    signal: args.options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(
      `Gemini image editing error ${response.status}: ${extractGeminiApiErrorMessage(errorText)}`,
    );
  }

  const json = (await response.json()) as any;
  return extractGeminiImagePayload(json, model);
}

function buildGeminiGenerateContentUrl(baseUrl: string, model: string): string {
  const geminiModel = model
    .replace(/^models\//i, '')
    .replace(/^publishers\/[^/]+\/models\//i, '')
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//i, '')
    .trim();
  const modelPath = isVertexNativeGeminiBaseUrl(baseUrl)
    ? `publishers/google/models/${encodeURIComponent(geminiModel)}`
    : `models/${encodeURIComponent(geminiModel)}`;
  return `${baseUrl}/${modelPath}:generateContent`;
}

function buildGeminiImageRequestBody(options: Pick<ImageGenerationRequest, 'prompt' | 'size'>): Record<string, any> {
  return {
    contents: [{
      role: 'user',
      parts: [{ text: options.prompt }],
    }],
    generationConfig: buildGeminiImageGenerationConfig(options.size),
  };
}

function buildGeminiImageEditRequestBody(
  options: Pick<ImageEditRequest, 'prompt' | 'images' | 'size'>,
): Record<string, any> {
  const parts: any[] = options.images.map((source, index) => {
    const inlineData = parseGeminiInlineDataUrl(source.dataUri || source.uri);
    if (!inlineData) {
      throw new Error(`Gemini image editing requires inline image data for source ${index + 1}`);
    }

    return {
      inlineData: {
        mimeType: inlineData.mimeType,
        data: inlineData.data,
      },
    };
  });

  parts.push({ text: options.prompt });

  return {
    contents: [{ role: 'user', parts }],
    generationConfig: buildGeminiImageGenerationConfig(options.size),
  };
}

function buildGeminiImageGenerationConfig(size?: string): Record<string, any> {
  const generationConfig: Record<string, any> = {
    responseModalities: ['IMAGE'],
  };
  const imageConfig: Record<string, any> = {};
  const aspectRatio = normalizeGeminiImageAspectRatio(size);
  const imageSize = normalizeGeminiImageOutputSize(size);

  if (aspectRatio) {
    imageConfig.aspectRatio = aspectRatio;
  }
  if (imageSize) {
    imageConfig.imageSize = imageSize;
  }
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }

  return generationConfig;
}

function parseGeminiInlineDataUrl(value: unknown): { mimeType: string; data: string } | null {
  const url = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
      ? (value as { url: string }).url
      : '';

  if (!url) {
    return null;
  }

  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1].trim(),
    data: match[2].replace(/\s+/g, ''),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a || 1;
}

function normalizeGeminiImageAspectRatio(size?: string): string | undefined {
  const normalized = (size || '').trim();
  if (!normalized) {
    return undefined;
  }

  const upper = normalized.toUpperCase();
  if (GEMINI_IMAGE_SIZE_VALUES.has(upper as GeminiImageSizeValue)) {
    return undefined;
  }

  const ratioMatch = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
  if (ratioMatch) {
    const width = Number.parseInt(ratioMatch[1], 10);
    const height = Number.parseInt(ratioMatch[2], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }
    const divisor = greatestCommonDivisor(width, height);
    const ratio = `${width / divisor}:${height / divisor}`;
    return GEMINI_IMAGE_ASPECT_RATIOS.has(ratio) ? ratio : undefined;
  }

  const dimensionMatch = normalized.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!dimensionMatch) {
    return undefined;
  }

  const width = Number.parseInt(dimensionMatch[1], 10);
  const height = Number.parseInt(dimensionMatch[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  const divisor = greatestCommonDivisor(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return GEMINI_IMAGE_ASPECT_RATIOS.has(ratio) ? ratio : undefined;
}

function normalizeGeminiImageOutputSize(size?: string): GeminiImageSizeValue | undefined {
  const normalized = (size || '').trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }

  if (GEMINI_IMAGE_SIZE_VALUES.has(normalized as GeminiImageSizeValue)) {
    return normalized as GeminiImageSizeValue;
  }

  const dimensionMatch = normalized.match(/^(\d+)\s*X\s*(\d+)$/);
  if (!dimensionMatch) {
    return undefined;
  }

  const width = Number.parseInt(dimensionMatch[1], 10);
  const height = Number.parseInt(dimensionMatch[2], 10);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width !== height
  ) {
    return undefined;
  }

  if (width === 512) return '512';
  if (width === 1024) return '1K';
  if (width === 2048) return '2K';
  if (width === 4096) return '4K';
  return undefined;
}

function normalizeGeminiFinishReason(finishReason: unknown): string {
  const normalized = typeof finishReason === 'string' ? finishReason.toUpperCase() : '';

  switch (normalized) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'RECITATION':
    case 'IMAGE_SAFETY':
    case 'IMAGE_PROHIBITED_CONTENT':
    case 'IMAGE_RECITATION':
      return 'content_filter';
    default:
      return normalized ? normalized.toLowerCase() : 'stop';
  }
}

function extractGeminiApiErrorMessage(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: string; status?: string } };
    const message = typeof parsed.error?.message === 'string' ? parsed.error.message.trim() : '';
    const status = typeof parsed.error?.status === 'string' ? parsed.error.status.trim() : '';
    if (message && status) {
      return `${message} (${status})`;
    }
    if (message) {
      return message;
    }
    if (status) {
      return status;
    }
  } catch {
    // Keep the original text when the Gemini API returned plain text.
  }

  const trimmed = errorText.trim();
  return trimmed || 'Unknown Gemini API error';
}

function extractGeminiImagePayload(json: any, model: string): GeneratedImagePayload {
  const blockReason =
    typeof json?.promptFeedback?.blockReason === 'string'
      ? json.promptFeedback.blockReason.trim()
      : '';
  if (blockReason) {
    throw new Error(`Gemini image prompt blocked: ${blockReason}`);
  }

  const candidates = Array.isArray(json?.candidates)
    ? json.candidates.filter((candidate: unknown): candidate is Record<string, any> => Boolean(candidate && typeof candidate === 'object'))
    : [];
  if (candidates.length === 0) {
    throw new Error('Gemini image generation returned no candidates');
  }

  let latestFinishReason = '';

  for (const candidate of candidates) {
    const finishReason = normalizeGeminiFinishReason(candidate.finishReason);
    if (finishReason && finishReason !== 'stop') {
      latestFinishReason = finishReason;
    }

    const parts = Array.isArray(candidate.content?.parts)
      ? candidate.content.parts.filter((part: unknown): part is Record<string, any> => Boolean(part && typeof part === 'object'))
      : [];

    for (const part of parts) {
      const inline =
        part.inlineData && typeof part.inlineData === 'object'
          ? part.inlineData
          : part.inline_data && typeof part.inline_data === 'object'
            ? part.inline_data
            : undefined;
      const data = typeof inline?.data === 'string' ? inline.data.trim() : '';
      if (!data) {
        continue;
      }

      const mimeType =
        typeof inline?.mimeType === 'string'
          ? inline.mimeType
          : typeof inline?.mime_type === 'string'
            ? inline.mime_type
            : 'image/png';

      return {
        model,
        b64_json: data,
        outputFormat: mimeType.includes('jpeg')
          ? 'jpeg'
          : mimeType.includes('webp')
            ? 'webp'
            : 'png',
        usage: normalizeGeneratedImageUsage(json?.usageMetadata, model),
      };
    }
  }

  if (latestFinishReason === 'content_filter') {
    throw new Error('Gemini image generation was blocked by safety filters');
  }
  if (latestFinishReason) {
    throw new Error(
      `Gemini image generation returned no image data (finish reason: ${latestFinishReason})`,
    );
  }

  throw new Error('Gemini image generation returned no image data');
}

function normalizeGeneratedImageUsage(usage: unknown, model: string) {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return undefined;
  }

  return {
    ...normalizedUsage,
    model,
  };
}
