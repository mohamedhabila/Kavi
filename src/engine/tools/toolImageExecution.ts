import { File } from 'expo-file-system';
import { editImage, generateImage } from '../../services/media/imageGeneration';
import { resolveToolProviderContext } from './toolProviderContext';
import { getWorkspaceDir, sanitizeToolWorkspacePath } from './toolWorkspaceFiles';

export async function executeImageGenerate(
  args: {
    prompt: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    style?: 'vivid' | 'natural';
  },
  conversationId: string,
): Promise<string> {
  const provider = (await resolveToolProviderContext()).provider;
  if (!provider) {
    return JSON.stringify({
      status: 'error',
      message: 'No enabled provider configured for image generation.',
    });
  }

  try {
    const result = await generateImage(provider, { ...args, conversationId });
    return JSON.stringify(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', message });
  }
}

function normalizeImageEditInputPaths(args: Record<string, unknown>): string[] {
  const rawPaths: string[] = [];

  if (typeof args.imagePath === 'string' && args.imagePath.trim()) {
    rawPaths.push(args.imagePath.trim());
  } else if (typeof args.imagePath !== 'undefined' && args.imagePath !== null) {
    throw new Error('imagePath must be a string');
  }

  if (typeof args.imagePaths !== 'undefined') {
    if (!Array.isArray(args.imagePaths)) {
      throw new Error('imagePaths must be an array of strings');
    }

    for (let index = 0; index < args.imagePaths.length; index += 1) {
      const candidate = args.imagePaths[index];
      if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new Error(`imagePaths[${index}] must be a non-empty string`);
      }
      rawPaths.push(candidate.trim());
    }
  }

  return Array.from(new Set(rawPaths));
}

function buildWorkspaceImageEditSource(
  path: string,
  conversationId: string,
): {
  uri: string;
  name: string;
} {
  const safePath = sanitizeToolWorkspacePath(path);
  if (!safePath) {
    throw new Error(`Invalid workspace image path: ${path}`);
  }

  const file = new File(getWorkspaceDir(conversationId), safePath);
  return {
    uri: file.uri,
    name: safePath.split('/').pop() || safePath,
  };
}

export async function executeImageEdit(
  args: {
    prompt?: string;
    imagePath?: string;
    imagePaths?: string[];
    maskPath?: string;
    model?: string;
    size?: string;
    quality?: string;
    format?: 'png' | 'jpeg' | 'webp';
    background?: 'transparent' | 'opaque' | 'auto';
    inputFidelity?: 'high' | 'low';
    moderation?: 'auto' | 'low';
    outputCompression?: number;
  },
  conversationId: string,
): Promise<string> {
  const provider = (await resolveToolProviderContext()).provider;
  if (!provider) {
    return JSON.stringify({
      status: 'error',
      message: 'No enabled provider configured for image editing.',
    });
  }

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) {
    return JSON.stringify({ status: 'error', message: 'image_edit requires a non-empty prompt.' });
  }

  try {
    const imagePaths = normalizeImageEditInputPaths(args as Record<string, unknown>);
    if (imagePaths.length === 0) {
      return JSON.stringify({
        status: 'error',
        message: 'image_edit requires imagePath or imagePaths.',
      });
    }

    const images = imagePaths.map((path) => buildWorkspaceImageEditSource(path, conversationId));
    const mask =
      typeof args.maskPath === 'string' && args.maskPath.trim()
        ? buildWorkspaceImageEditSource(args.maskPath.trim(), conversationId)
        : undefined;

    const result = await editImage(
      provider,
      {
        prompt,
        images,
        ...(mask ? { mask } : {}),
        model: args.model,
        size: args.size,
        quality: args.quality,
        format: args.format,
        background: args.background,
        inputFidelity: args.inputFidelity,
        moderation: args.moderation,
        outputCompression: args.outputCompression,
        conversationId,
      },
    );
    return JSON.stringify(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: 'error', message });
  }
}
