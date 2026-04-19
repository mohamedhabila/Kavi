import type { Attachment, Message, ToolCall } from '../types';
import {
  buildGeneratedImageAttachment,
  parseGeneratedImageResult,
} from '../services/media/imageGeneration';

const AUDIO_ATTACHMENT_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'ogg',
  'wav',
  'webm',
]);

function clampWaveformLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.18;
  }

  return Math.min(1, Math.max(0.08, value));
}

function getAttachmentExtension(attachment: Pick<Attachment, 'name' | 'uri'>): string {
  for (const candidate of [attachment.name, attachment.uri]) {
    const match = candidate
      ?.split(/[?#]/, 1)[0]
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
}

export function isAudioAttachment(
  attachment: Pick<Attachment, 'type' | 'mimeType' | 'name' | 'uri'>,
): boolean {
  if (attachment.type === 'audio') {
    return true;
  }

  const mimeType = attachment.mimeType?.trim().toLowerCase() || '';
  if (mimeType.startsWith('audio/')) {
    return true;
  }

  return AUDIO_ATTACHMENT_EXTENSIONS.has(getAttachmentExtension(attachment));
}

export function isTranscriptBackedAudioAttachment(
  attachment: Pick<Attachment, 'type' | 'mimeType' | 'name' | 'uri' | 'transcript'>,
): boolean {
  return (
    isAudioAttachment(attachment) &&
    typeof attachment.transcript === 'string' &&
    attachment.transcript.trim().length > 0
  );
}

export function isModelVisibleAttachment(
  attachment: Pick<Attachment, 'type' | 'mimeType' | 'name' | 'uri' | 'transcript'>,
): boolean {
  return !isTranscriptBackedAudioAttachment(attachment);
}

export function filterModelVisibleAttachments<
  T extends Pick<Attachment, 'type' | 'mimeType' | 'name' | 'uri' | 'transcript'>,
>(attachments?: T[]): T[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }

  const filtered = attachments.filter((attachment) => isModelVisibleAttachment(attachment));
  return filtered.length > 0 ? filtered : undefined;
}

export function hasModelVisibleAttachments(
  attachments?: Array<Pick<Attachment, 'type' | 'mimeType' | 'name' | 'uri' | 'transcript'>>,
): boolean {
  return Boolean(filterModelVisibleAttachments(attachments)?.length);
}

export function getPrimaryAudioAttachment(attachments?: Attachment[]): Attachment | undefined {
  return attachments?.find((attachment) => isAudioAttachment(attachment));
}

function cloneAttachment(attachment: Attachment): Attachment {
  return { ...attachment };
}

export function stripAttachmentPayload(attachment: Attachment): Attachment {
  return {
    id: attachment.id,
    type: attachment.type,
    uri: attachment.uri,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(attachment.workspacePath ? { workspacePath: attachment.workspacePath } : {}),
    ...(typeof attachment.durationMs === 'number' && Number.isFinite(attachment.durationMs)
      ? { durationMs: Math.max(0, Math.round(attachment.durationMs)) }
      : {}),
    ...(attachment.transcript?.trim() ? { transcript: attachment.transcript.trim() } : {}),
    ...(attachment.waveformLevels?.length
      ? {
          waveformLevels: attachment.waveformLevels
            .slice(0, 48)
            .map((value) => clampWaveformLevel(value)),
        }
      : {}),
  };
}

export function stripAttachmentPayloads(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }

  return attachments.map(stripAttachmentPayload);
}

export function cloneAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments?.length) {
    return undefined;
  }

  return attachments.map(cloneAttachment);
}

export function mergeAttachmentLists(
  existing: Attachment[] | undefined,
  incoming: Attachment[] | undefined,
): Attachment[] | undefined {
  if (!incoming?.length) {
    return existing?.length ? cloneAttachments(existing) : undefined;
  }

  const merged = cloneAttachments(existing) ?? [];
  for (const attachment of incoming) {
    const clonedAttachment = cloneAttachment(attachment);
    const existingIndex = merged.findIndex(
      (candidate) =>
        candidate.id === clonedAttachment.id ||
        (candidate.type === clonedAttachment.type &&
          candidate.uri === clonedAttachment.uri &&
          candidate.name === clonedAttachment.name),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = clonedAttachment;
    } else {
      merged.push(clonedAttachment);
    }
  }

  return merged.length ? merged : undefined;
}

export function extractToolCallAttachments(
  toolCall: Pick<ToolCall, 'id' | 'name' | 'status' | 'result'>,
): Attachment[] | undefined {
  if (toolCall.status !== 'completed' || !toolCall.result) {
    return undefined;
  }

  if (toolCall.name === 'image_generate' || toolCall.name === 'image_edit') {
    const generatedImage = parseGeneratedImageResult(toolCall.result);
    if (generatedImage) {
      return [buildGeneratedImageAttachment(toolCall.id, generatedImage)];
    }
  }

  return undefined;
}

function deriveAttachmentsFromToolCalls(
  message: Pick<Message, 'toolCalls'>,
): Attachment[] | undefined {
  if (!message.toolCalls?.length) {
    return undefined;
  }

  return message.toolCalls.reduce<Attachment[] | undefined>(
    (attachments, toolCall) =>
      mergeAttachmentLists(attachments, extractToolCallAttachments(toolCall)),
    undefined,
  );
}

export function resolveMessageAttachments(
  message: Pick<Message, 'attachments' | 'toolCalls' | 'subAgentEvent'>,
): Attachment[] | undefined {
  let attachments = cloneAttachments(message.attachments);
  attachments = mergeAttachmentLists(attachments, deriveAttachmentsFromToolCalls(message));
  attachments = mergeAttachmentLists(attachments, message.subAgentEvent?.snapshot.artifacts);
  return attachments;
}

export function collectResolvedAttachments(
  messages: ReadonlyArray<Pick<Message, 'attachments' | 'toolCalls' | 'subAgentEvent'>>,
): Attachment[] | undefined {
  return messages.reduce<Attachment[] | undefined>(
    (attachments, message) => mergeAttachmentLists(attachments, resolveMessageAttachments(message)),
    undefined,
  );
}
