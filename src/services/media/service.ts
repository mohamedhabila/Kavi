// ---------------------------------------------------------------------------
// Kavi — Media Understanding Service
// ---------------------------------------------------------------------------
// Uses existing app infrastructure for:
//   - LlmService for vision (image description)
//   - transcribeAudio (Whisper) for audio transcription
//   - local file reading plus best-effort document summaries for documents

import { File } from 'expo-file-system';
import type { Attachment } from '../../types/attachment';
import type { LlmProviderConfig } from '../../types/provider';
import type { MediaUnderstandingOutput } from './types';
import { formatMediaUnderstandingBody } from './format';
import { buildImageAttachmentDataUri } from './attachmentPayloads';
import { LlmService } from '../llm/LlmService';
import { transcribeAudio } from '../voice/voice';
import {
  isAudioAttachment as isRenderableAudioAttachment,
  isModelVisibleAttachment,
} from '../../utils/messageAttachments';

export interface MediaUnderstandingOptions {
  enabled: boolean;
  provider: LlmProviderConfig;
  model: string;
}

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp']);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
};

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/m4a',
  'audio/aac',
  'audio/webm',
  'audio/flac',
  'audio/mp4',
]);

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'webm', 'flac', 'mp4']);

const TEXT_DOCUMENT_MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
]);

const TEXT_DOCUMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'toml',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'kt',
  'swift',
  'sql',
  'css',
  'html',
  'htm',
  'log',
  'ini',
  'conf',
  'sh',
  'zsh',
  'bash',
]);

const DOCUMENT_EXCERPT_MAX_CHARS = 12_000;

function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime.toLowerCase()) || mime.toLowerCase().startsWith('image/');
}

function isAudioMime(mime: string): boolean {
  return AUDIO_MIMES.has(mime.toLowerCase()) || mime.toLowerCase().startsWith('audio/');
}

function getAttachmentExtension(attachment: Pick<Attachment, 'name' | 'uri'>): string {
  for (const value of [attachment.name, attachment.uri]) {
    const normalized = value?.split(/[?#]/, 1)[0];
    const match = normalized?.toLowerCase().match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

function isImageAttachment(attachment: Attachment, mime: string): boolean {
  return (
    attachment.type === 'image' ||
    isImageMime(mime) ||
    IMAGE_EXTENSIONS.has(getAttachmentExtension(attachment))
  );
}

function isAudioAttachment(attachment: Attachment, mime: string): boolean {
  return (
    attachment.type === 'audio' ||
    isRenderableAudioAttachment(attachment) ||
    isAudioMime(mime) ||
    AUDIO_EXTENSIONS.has(getAttachmentExtension(attachment))
  );
}

function resolveImageMimeType(attachment: Attachment, mime: string): string {
  if (isImageMime(mime)) {
    return mime;
  }

  return IMAGE_MIME_BY_EXTENSION[getAttachmentExtension(attachment)] || 'image/jpeg';
}

function isPdfAttachment(attachment: Attachment, mime: string): boolean {
  return mime === 'application/pdf' || getAttachmentExtension(attachment) === 'pdf';
}

function isTextDocumentAttachment(attachment: Attachment, mime: string): boolean {
  if (mime.startsWith('text/')) {
    return true;
  }

  if (TEXT_DOCUMENT_MIMES.has(mime)) {
    return true;
  }

  return TEXT_DOCUMENT_EXTENSIONS.has(getAttachmentExtension(attachment));
}

function formatAttachmentSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function describeAttachment(attachment: Attachment): string {
  const label = attachment.name?.trim() || 'attached file';
  const metadata = [
    attachment.mimeType?.trim() || null,
    formatAttachmentSize(attachment.size),
  ].filter((value): value is string => Boolean(value));
  return metadata.length > 0 ? `${label} (${metadata.join(', ')})` : label;
}

function truncateDocumentText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= DOCUMENT_EXCERPT_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, DOCUMENT_EXCERPT_MAX_CHARS - 1)}…`;
}

async function readDocumentAttachmentText(attachment: Attachment): Promise<string> {
  if (/^https?:\/\//i.test(attachment.uri)) {
    const response = await fetch(attachment.uri);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  }

  return await new File(attachment.uri).text();
}

/**
 * Run media understanding on message attachments.
 * - Images → Vision LLM (describe the image)
 * - Audio → Whisper API (transcribe)
 * - Documents → Best-effort text extraction or attachment summary
 *
 * Returns the original body enriched with media context, or unchanged if
 * nothing was processed.
 */
export async function runMediaUnderstanding(
  body: string,
  attachments: Attachment[],
  options: MediaUnderstandingOptions,
): Promise<{ enrichedBody: string; processedCount: number }> {
  const modelVisibleAttachments = attachments.flatMap((attachment, index) =>
    isModelVisibleAttachment(attachment) ? [{ attachment, index }] : [],
  );

  if (!options.enabled || modelVisibleAttachments.length === 0) {
    return { enrichedBody: body, processedCount: 0 };
  }

  const tasks = modelVisibleAttachments.map(({ attachment, index }) =>
    processAttachment(attachment, index, options),
  );

  const results = await Promise.allSettled(tasks);

  const outputs: MediaUnderstandingOutput[] = results
    .filter(
      (r): r is PromiseFulfilledResult<MediaUnderstandingOutput | null> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map((r) => r.value!);

  const processedCount = outputs.filter((o) => o.text && !o.error).length;
  const enrichedBody = formatMediaUnderstandingBody(body, outputs);

  return { enrichedBody, processedCount };
}

async function processAttachment(
  attachment: Attachment,
  index: number,
  options: MediaUnderstandingOptions,
): Promise<MediaUnderstandingOutput | null> {
  const mime = (attachment.mimeType || '').toLowerCase();

  if (isImageAttachment(attachment, mime)) {
    return describeImage(attachment, index, options);
  }

  if (isAudioAttachment(attachment, mime)) {
    if (attachment.type === 'audio' && attachment.transcript?.trim()) {
      return null;
    }
    return transcribeAttachment(attachment, index);
  }

  return extractDocumentAttachment(attachment, index, mime);
}

/**
 * Use a vision-capable LLM to describe an image attachment.
 */
async function describeImage(
  attachment: Attachment,
  index: number,
  options: MediaUnderstandingOptions,
): Promise<MediaUnderstandingOutput> {
  try {
    // Check model has vision capability
    const caps = options.provider.modelCapabilities?.[options.model];
    if (!caps?.vision) {
      return {
        kind: 'image.description',
        attachmentIndex: index,
        text: '',
        error: 'No vision-capable model available',
      };
    }

    const dataUri = await buildImageAttachmentDataUri({
      ...attachment,
      mimeType: resolveImageMimeType(attachment, (attachment.mimeType || '').toLowerCase()),
    });

    if (!dataUri) {
      return {
        kind: 'image.description',
        attachmentIndex: index,
        text: '',
        error: 'Image payload not available',
      };
    }

    const llm = new LlmService(options.provider);

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image concisely. Focus on the key content, text visible in the image, and any relevant details. Keep the description under 200 words.',
          },
          {
            type: 'image_url',
            image_url: {
              url: dataUri,
            },
          },
        ],
      },
    ];

    const response = await llm.sendMessage(messages, {
      model: options.model,
      maxTokens: 512,
      temperature: 0.2,
    });

    const text = response?.choices?.[0]?.message?.content || response?.content?.[0]?.text || '';

    return {
      kind: 'image.description',
      attachmentIndex: index,
      text,
      provider: options.provider.name,
      model: options.model,
    };
  } catch (err: unknown) {
    return {
      kind: 'image.description',
      attachmentIndex: index,
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Use Whisper API to transcribe an audio attachment.
 */
async function transcribeAttachment(
  attachment: Attachment,
  index: number,
): Promise<MediaUnderstandingOutput> {
  try {
    const result = await transcribeAudio(attachment.uri);
    return {
      kind: 'audio.transcription',
      attachmentIndex: index,
      text: result.text,
      provider: 'openai',
      model: 'whisper-1',
    };
  } catch (err: unknown) {
    return {
      kind: 'audio.transcription',
      attachmentIndex: index,
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function extractDocumentAttachment(
  attachment: Attachment,
  index: number,
  mime: string,
): Promise<MediaUnderstandingOutput> {
  const descriptor = describeAttachment(attachment);

  if (isTextDocumentAttachment(attachment, mime)) {
    try {
      const extractedText = truncateDocumentText(await readDocumentAttachmentText(attachment));
      if (extractedText) {
        return {
          kind: 'document.extraction',
          attachmentIndex: index,
          text: `Attached document: ${descriptor}\n\n${extractedText}`,
        };
      }
    } catch {
      // Fall back to a summary below when best-effort extraction is unavailable.
    }

    return {
      kind: 'document.extraction',
      attachmentIndex: index,
      text: `Attached document: ${descriptor}\n\nAutomatic text extraction was unavailable on this device.`,
    };
  }

  if (isPdfAttachment(attachment, mime)) {
    return {
      kind: 'document.extraction',
      attachmentIndex: index,
      text: `Attached PDF: ${descriptor}\n\nDirect text extraction is limited for local PDFs on mobile, so only file metadata is available automatically.`,
    };
  }

  return {
    kind: 'document.extraction',
    attachmentIndex: index,
    text: `Attached file: ${descriptor}`,
  };
}
