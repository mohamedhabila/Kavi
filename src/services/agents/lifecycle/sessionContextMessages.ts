import type { Message, ToolCall } from '../../../types/message';
import { generateId } from '../../../utils/id';
import { stripAttachmentPayloads } from '../../../utils/messageAttachments';
import { normalizeFinalizationOutputText } from '../finalizationText';

type TranscriptSanitizationOptions = {
  finalizationMessageCharLimit: number;
  finalizationToolContentCharLimit: number;
};

type StoredSessionMessageOptions = {
  sessionContextMaxMessages: number;
  sessionContextMessageCharLimit: number;
  sessionContextToolContentCharLimit: number;
};

export function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeSubAgentPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== 'string') {
    return undefined;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function truncateTranscriptText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = normalizeFinalizationOutputText(value, maxLength);
  if (!normalized) {
    return undefined;
  }

  return normalized.length < maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function hasSeedUserInstruction(message: Message): boolean {
  return (
    message.role === 'user' &&
    (message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0)
  );
}

export function coerceToolCallStatus(
  status: unknown,
  fallback: ToolCall['status'],
): ToolCall['status'] {
  return status === 'pending' ||
    status === 'running' ||
    status === 'completed' ||
    status === 'failed'
    ? status
    : fallback;
}

function sanitizeTranscriptToolCall(toolCall: ToolCall): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: truncateTranscriptText(toolCall.arguments, 1200) || '{}',
    ...(toolCall.raw ? { raw: cloneJsonLike(toolCall.raw) } : {}),
    status: coerceToolCallStatus(toolCall.status, 'completed'),
    startedAt: toolCall.startedAt,
    updatedAt: toolCall.updatedAt,
    completedAt: toolCall.completedAt,
    progressText: truncateTranscriptText(toolCall.progressText, 400),
    result: truncateTranscriptText(toolCall.result, 1800),
    error: truncateTranscriptText(toolCall.error, 800),
  };
}

function buildSanitizedContextMessage(message: Message, contentLimit: number): Message {
  const sanitizedAttachments = stripAttachmentPayloads(message.attachments);

  return {
    id: message.id,
    role: message.role,
    content: truncateTranscriptText(message.content, contentLimit) || '',
    timestamp: message.timestamp,
    ...(message.enrichedContent
      ? { enrichedContent: truncateTranscriptText(message.enrichedContent, contentLimit) }
      : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(sanitizedAttachments ? { attachments: sanitizedAttachments } : {}),
    ...(message.providerReplay ? { providerReplay: cloneJsonLike(message.providerReplay) } : {}),
    ...(message.assistantMetadata ? { assistantMetadata: { ...message.assistantMetadata } } : {}),
    ...(message.toolCalls?.length
      ? { toolCalls: message.toolCalls.map((toolCall) => sanitizeTranscriptToolCall(toolCall)) }
      : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}

export function sanitizeTranscriptMessage(
  message: Message,
  options: TranscriptSanitizationOptions,
): Message {
  const contentLimit =
    message.role === 'tool'
      ? options.finalizationToolContentCharLimit
      : options.finalizationMessageCharLimit;

  return buildSanitizedContextMessage(message, contentLimit);
}

function sanitizeSessionContextMessage(
  message: Message,
  options: Pick<
    StoredSessionMessageOptions,
    'sessionContextMessageCharLimit' | 'sessionContextToolContentCharLimit'
  >,
): Message {
  const contentLimit =
    message.role === 'tool'
      ? options.sessionContextToolContentCharLimit
      : options.sessionContextMessageCharLimit;

  return buildSanitizedContextMessage(message, contentLimit);
}

function cloneStoredMessage(message: Message): Message {
  const candidate = (message && typeof message === 'object' ? message : {}) as Partial<Message>;
  const role =
    candidate.role === 'system' ||
    candidate.role === 'user' ||
    candidate.role === 'assistant' ||
    candidate.role === 'tool'
      ? candidate.role
      : 'assistant';
  const timestamp =
    typeof candidate.timestamp === 'number' && Number.isFinite(candidate.timestamp)
      ? candidate.timestamp
      : Date.now();
  const id =
    typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id
      : generateId();

  return {
    ...candidate,
    id,
    role,
    content: typeof candidate.content === 'string' ? candidate.content : '',
    timestamp,
    ...(typeof candidate.enrichedContent === 'string'
      ? { enrichedContent: candidate.enrichedContent }
      : {}),
    ...(Array.isArray(candidate.toolCalls)
      ? {
          toolCalls: candidate.toolCalls.map((toolCall) => ({
            ...toolCall,
            ...(toolCall.raw ? { raw: cloneJsonLike(toolCall.raw) } : {}),
          })),
        }
      : {}),
    ...(Array.isArray(candidate.attachments)
      ? { attachments: candidate.attachments.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(candidate.providerReplay
      ? { providerReplay: cloneJsonLike(candidate.providerReplay) }
      : {}),
    ...(candidate.assistantMetadata
      ? { assistantMetadata: { ...candidate.assistantMetadata } }
      : {}),
  };
}

export function cloneStoredMessages(messages?: Message[]): Message[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const cloned: Message[] = [];
  for (const message of messages) {
    try {
      cloned.push(cloneStoredMessage(message));
    } catch {
      // Ignore malformed entries so valid siblings still survive recovery.
    }
  }

  return cloned;
}

export function buildStoredSessionMessages(
  messages: Message[],
  finalOutput: string | undefined,
  options: StoredSessionMessageOptions,
): Message[] {
  const sanitized = messages.map((message) => sanitizeSessionContextMessage(message, options));
  const normalizedOutput = truncateTranscriptText(
    finalOutput,
    options.sessionContextMessageCharLimit,
  );
  const lastMessage = sanitized[sanitized.length - 1];

  if (
    normalizedOutput &&
    (lastMessage?.role !== 'assistant' || lastMessage.content !== normalizedOutput)
  ) {
    sanitized.push({
      id: generateId(),
      role: 'assistant',
      content: normalizedOutput,
      timestamp: Date.now(),
    });
  }

  return sanitized
    .slice(-options.sessionContextMaxMessages)
    .map((message) => cloneStoredMessage(message));
}
