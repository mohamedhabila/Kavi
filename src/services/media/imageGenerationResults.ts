import type { Attachment } from '../../types/attachment';
import type { TokenUsage } from '../../types/usage';
import type { GeneratedImagePayload } from '../llm/LlmService';
import type { ProducedImageResult } from './imageGeneration';
import { guessMimeType, inferOutputFormat } from './imageGenerationFormats';
import type { GeneratedImageFormat } from './imageGenerationFormats';
import {
  deriveGeneratedImageFileName,
  deriveWorkspacePathFromFileUri,
  persistBase64Image,
  persistRemoteImage,
} from './imageGenerationPersistence';
import type { PersistedGeneratedImageFile } from './imageGenerationPersistence';

type ProducedImageStatus = ProducedImageResult['status'];

type ParsedProducedImageResult = Partial<ProducedImageResult> & {
  sourceCount?: number;
  maskApplied?: boolean;
  usage?: TokenUsage;
};

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

export async function persistGeneratedImagePayload(
  providerId: string,
  result: GeneratedImagePayload,
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
