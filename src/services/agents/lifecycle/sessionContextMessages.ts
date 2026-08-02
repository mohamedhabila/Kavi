import type { Message, ToolCall } from '../../../types/message';
import { generateId } from '../../../utils/id';
import { stripAttachmentPayloads } from '../../../utils/messageAttachments';
import {
  parseReadFileContinuationResult,
  READ_FILE_CONTINUATION_TOOL,
} from '../../../utils/readFileContinuation';
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

type StoredSessionTranscript = {
  messages: Message[];
  retainedFromStart: boolean;
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

function buildDurableReadFileCheckpoint(content: string): string | undefined {
  const continuation = parseReadFileContinuationResult(content);
  if (!continuation) {
    return undefined;
  }

  return JSON.stringify({
    status: 'read_chunk',
    path: continuation.path,
    ...(continuation.sha256 ? { sha256: continuation.sha256 } : {}),
    content:
      '[Chunk content omitted from the durable worker checkpoint. Reread this exact chunk before relying on it.]',
    offset: continuation.offset,
    nextOffset: continuation.nextOffset,
    totalChars: continuation.totalChars,
    complete: continuation.complete,
    durableCheckpoint: {
      version: 1,
      contentRetained: false,
      rereadOffset: continuation.offset,
    },
    guidance:
      `Call read_file again with path ${JSON.stringify(continuation.path)} and offset ` +
      `${continuation.offset} to restore the omitted chunk before continuing.`,
  });
}

function sanitizeToolResultText(
  toolName: string | undefined,
  value: string | undefined,
  maxLength: number,
): string | undefined {
  if (
    toolName === READ_FILE_CONTINUATION_TOOL &&
    typeof value === 'string' &&
    value.length >= maxLength
  ) {
    const checkpoint = buildDurableReadFileCheckpoint(value);
    if (checkpoint) {
      return checkpoint;
    }
  }

  return truncateTranscriptText(value, maxLength);
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
    failureKind: toolCall.failureKind,
    startedAt: toolCall.startedAt,
    updatedAt: toolCall.updatedAt,
    completedAt: toolCall.completedAt,
    progressText: truncateTranscriptText(toolCall.progressText, 400),
    result: sanitizeToolResultText(toolCall.name, toolCall.result, 1800),
    error: truncateTranscriptText(toolCall.error, 800),
  };
}

function buildSanitizedContextMessage(message: Message, contentLimit: number): Message {
  const sanitizedAttachments = stripAttachmentPayloads(message.attachments);
  const matchingToolCall =
    message.role === 'tool'
      ? message.toolCalls?.find(
          (toolCall) => !message.toolCallId || toolCall.id === message.toolCallId,
        )
      : undefined;
  const sanitizedContent =
    message.role === 'tool'
      ? sanitizeToolResultText(matchingToolCall?.name, message.content, contentLimit)
      : truncateTranscriptText(message.content, contentLimit);

  return {
    id: message.id,
    role: message.role,
    content: sanitizedContent || '',
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

export function buildStoredSessionTranscript(
  messages: Message[],
  terminalOutput: string | undefined,
  options: StoredSessionMessageOptions,
): StoredSessionTranscript {
  const sanitized = messages.map((message) => sanitizeSessionContextMessage(message, options));
  const normalizedOutput = truncateTranscriptText(
    terminalOutput,
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

  const retainedFromStart = sanitized.length <= options.sessionContextMaxMessages;
  if (retainedFromStart) {
    return {
      messages: sanitized.map((message) => cloneStoredMessage(message)),
      retainedFromStart: true,
    };
  }

  const seedInstruction = sanitized.find(hasSeedUserInstruction);
  const tailCapacity = Math.max(0, options.sessionContextMaxMessages - (seedInstruction ? 1 : 0));
  const coherentTail = tailCapacity > 0 ? sanitized.slice(-tailCapacity) : [];
  // A bounded tail can begin in the middle of an assistant tool batch. Leading tool results no
  // longer have their declaring assistant message and cannot be replayed to providers safely.
  // Drop only that orphaned prefix; every later tool result remains paired because the tail is
  // otherwise contiguous.
  while (coherentTail[0]?.role === 'tool') {
    coherentTail.shift();
  }
  const retainedMessages =
    seedInstruction && !coherentTail.some((message) => message.id === seedInstruction.id)
      ? [seedInstruction, ...coherentTail]
      : coherentTail;

  return {
    messages: retainedMessages.map((message) => cloneStoredMessage(message)),
    retainedFromStart: false,
  };
}
