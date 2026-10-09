import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { Attachment } from '../../types/attachment';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ComposerImage');

/**
 * Longest edge a chat photo is sent at. No provider reads more: OpenAI fits high-detail
 * images within 2048×2048 before tiling, Anthropic's high-resolution tier tops out near
 * 1,932 px a side (4,784 tokens of 28-px patches), and Gemini 3 budgets images by tokens.
 * A 12-megapixel phone photo sent whole costs upload time and memory every request that
 * carries it, for pixels the model never sees.
 */
export const COMPOSER_IMAGE_MAX_EDGE = 2048;

/** JPEG quality for a re-encoded photo; matches what the picker already applies. */
export const COMPOSER_IMAGE_JPEG_QUALITY = 0.8;

/** Formats not every provider accepts; re-encoding them makes the photo sendable anywhere. */
const REENCODED_MIME_TYPES = new Set(['image/heic', 'image/heif']);

/** Animated or vector images lose what makes them what they are when re-encoded. */
const PRESERVED_MIME_TYPES = new Set(['image/gif', 'image/svg+xml']);

export type PickedComposerImage = Readonly<{
  uri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}>;

function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

function originalAttachment(
  image: PickedComposerImage,
  id: string,
  fallbackName: string,
): Attachment {
  return {
    id,
    type: 'image',
    uri: image.uri,
    name: image.fileName || fallbackName,
    mimeType: image.mimeType || 'image/jpeg',
    size: image.fileSize || 0,
  };
}

/**
 * A picked photo as the composer attaches it: scaled so its long edge is at most
 * {@link COMPOSER_IMAGE_MAX_EDGE} and re-encoded when its format is not universally
 * accepted. A photo already within bounds is attached untouched. If the image cannot be
 * processed, the original is attached so the person can still send it.
 */
export async function prepareComposerImageAttachment(
  image: PickedComposerImage,
  id: string,
  fallbackName: string,
): Promise<Attachment> {
  const original = originalAttachment(image, id, fallbackName);
  const mimeType = original.mimeType.toLowerCase();
  if (PRESERVED_MIME_TYPES.has(mimeType)) return original;
  const longEdge = Math.max(image.width, image.height);
  const needsResize = Number.isFinite(longEdge) && longEdge > COMPOSER_IMAGE_MAX_EDGE;
  if (!needsResize && !REENCODED_MIME_TYPES.has(mimeType)) return original;

  const keepsTransparency = mimeType === 'image/png';
  try {
    const context = ImageManipulator.manipulate(image.uri);
    if (needsResize) {
      context.resize(
        image.width >= image.height
          ? { width: COMPOSER_IMAGE_MAX_EDGE, height: null }
          : { width: null, height: COMPOSER_IMAGE_MAX_EDGE },
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync(
      keepsTransparency
        ? { format: SaveFormat.PNG }
        : { format: SaveFormat.JPEG, compress: COMPOSER_IMAGE_JPEG_QUALITY },
    );
    return {
      ...original,
      uri: saved.uri,
      name: withExtension(original.name, keepsTransparency ? 'png' : 'jpg'),
      mimeType: keepsTransparency ? 'image/png' : 'image/jpeg',
      size: new File(saved.uri).size ?? 0,
    };
  } catch (error: unknown) {
    logger.warn('Attaching the photo at its original size; it could not be scaled.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return original;
  }
}
