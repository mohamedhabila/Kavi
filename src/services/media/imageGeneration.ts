import { LlmProviderConfig } from '../../types/provider';
import { TokenUsage } from '../../types/usage';
import { LlmService } from '../llm/LlmService';
import {
  isGeminiImageProvider,
  isSupportedOpenAIImageEditModel,
  resolveImageModel,
} from '../llm/images/modelPolicy';
import {
  MAX_GEMINI_IMAGE_EDIT_SOURCES,
  MAX_OPENAI_IMAGE_EDIT_SOURCES,
  prepareImageEditSource,
  validateImageEditMask,
} from './imageEditInputs';
import type { PreparedImageEditSource } from './imageEditInputs';
import { persistGeneratedImagePayload } from './imageGenerationResults';

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

export {
  buildGeneratedImageAttachment,
  parseGeneratedImageResult,
} from './imageGenerationResults';

async function generateOpenAICompatibleImage(
  provider: LlmProviderConfig,
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> {
  const llm = new LlmService(provider);
  const result = await llm.generateImage({
    prompt: options.prompt,
    model: resolveImageModel(provider, options.model),
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
  if (provider.providerFamily === 'anthropic') {
    throw new Error('Image generation is not supported by Anthropic in Kavi');
  }
  return generateOpenAICompatibleImage(provider, options);
}

export async function editImage(
  provider: LlmProviderConfig,
  options: EditImageOptions,
): Promise<EditedImageResult> {
  if (provider.providerFamily === 'anthropic') {
    throw new Error('Image editing is not supported by Anthropic in Kavi');
  }

  const model = resolveImageModel(provider, options.model);
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
